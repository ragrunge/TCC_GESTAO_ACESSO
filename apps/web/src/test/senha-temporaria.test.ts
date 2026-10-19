// Senha temporária (spec §5.1: vale 72 h): textos da tela de Usuários (mensagem copiada e aviso da lista) e a
// reprodução da validade no mock, pelo relógio simulado.
import { SENHA_TEMPORARIA_VALIDADE_MS } from '@portaria/domain/rules';
import { HORA, INICIO_SIMULADO, relogio } from '@portaria/domain/time';
import type { UsuarioSistema } from '@portaria/domain/types';
import { avisoSenhaTemporaria, mensagemAcesso } from '../features/usuarios/senhaTemporaria';
import { entrarComo, esperaErro, novaApi } from './helpers';

// Relógio simulado: 09/10/2026 14:32 (São Paulo); + 72 h = 12/10 14:32.
const FIM = INICIO_SIMULADO + SENHA_TEMPORARIA_VALIDADE_MS;
const BASE: UsuarioSistema = { id: 'u-9', nome: 'Marina Couto', login: 'marina.couto', papel: 'porteiro', ativo: true, ultimoAcesso: null };

describe('textos da senha temporária', () => {
  it('a mensagem copiada inclui "Válida até dd/mm às HH:MM" logo depois da senha', () => {
    const m = mensagemAcesso({ login: 'marina.couto', senhaTemporaria: 'abcd-efgh-ijkm-npqr', expiraEm: FIM, origem: 'https://portaria.exemplo' });
    expect(m).toBe('Acesso ao sistema da portaria\nLogin: marina.couto\nSenha temporária: abcd-efgh-ijkm-npqr\n'
      + 'Válida até 12/10 às 14:32\nEntre em https://portaria.exemplo e troque a senha no primeiro acesso.');
  });

  it('sem prazo informado, a mensagem não inventa validade', () => {
    expect(mensagemAcesso({ login: 'x', senhaTemporaria: 's', expiraEm: null, origem: 'o' })).not.toContain('Válida até');
  });

  it('aviso da lista: vence em / vencida — redefina; nada sem troca pendente ou para inativo', () => {
    const pendente = { ...BASE, deveTrocarSenha: true, senhaTemporariaExpiraEm: FIM };
    expect(avisoSenhaTemporaria(pendente, FIM - 1)).toEqual({ texto: 'Senha temporária vence em 12/10 14:32', vencida: false });
    expect(avisoSenhaTemporaria(pendente, FIM)).toEqual({ texto: 'Senha temporária vencida — redefina', vencida: true });
    expect(avisoSenhaTemporaria({ ...pendente, senhaTemporariaExpiraEm: null }, FIM - HORA)?.vencida).toBe(true); // sem prazo: falha fechada
    expect(avisoSenhaTemporaria({ ...BASE, deveTrocarSenha: false, senhaTemporariaExpiraEm: null }, FIM)).toBeNull();
    expect(avisoSenhaTemporaria({ ...pendente, ativo: false }, FIM)).toBeNull();
  });
});

describe('mock: validade da senha temporária no relógio simulado', () => {
  it('criar grava o prazo; depois de 72 h o login é recusado com SENHA_TEMPORARIA_EXPIRADA; redefinir renova', async () => {
    const api = novaApi();
    await entrarComo(api, 'roberto.faria');
    const { usuario } = await api.usuarios.criar({ nome: 'Helena Dias', login: 'helena.dias', papel: 'porteiro' });
    expect(usuario).toMatchObject({ deveTrocarSenha: true, senhaTemporariaExpiraEm: FIM });
    expect((await api.usuarios.listar()).find((u) => u.id === usuario.id)?.senhaTemporariaExpiraEm).toBe(FIM);
    await api.auth.logout();

    relogio.congelar(FIM - 1);
    await api.auth.login({ login: 'helena.dias', senha: 'qualquer' });
    await api.auth.logout();
    relogio.congelar(FIM);
    expect(await esperaErro(api.auth.login({ login: 'helena.dias', senha: 'qualquer' }))).toMatchObject({
      status: 401, code: 'SENHA_TEMPORARIA_EXPIRADA', message: 'Senha temporária vencida. Peça a redefinição à administração.',
    });

    await entrarComo(api, 'roberto.faria');
    const red = await api.usuarios.redefinirAcesso(usuario.id);
    expect(red.usuario.senhaTemporariaExpiraEm).toBe(FIM + SENHA_TEMPORARIA_VALIDADE_MS);
    await api.auth.logout();
    await api.auth.login({ login: 'helena.dias', senha: 'qualquer' });
  });

  it('a troca de senha zera o prazo', async () => {
    const api = novaApi();
    await entrarComo(api, 'roberto.faria');
    const { usuario } = await api.usuarios.criar({ nome: 'Helena Dias', login: 'helena.dias', papel: 'porteiro' });
    await api.auth.logout();
    await api.auth.login({ login: 'helena.dias', senha: 'qualquer' });
    await api.auth.trocarSenha({ senhaAtual: 'qualquer', novaSenha: 'uma senha nova e longa' });
    await api.auth.logout();
    await entrarComo(api, 'roberto.faria');
    expect((await api.usuarios.listar()).find((u) => u.id === usuario.id)).toMatchObject({ deveTrocarSenha: false, senhaTemporariaExpiraEm: null });
    relogio.congelar(FIM + HORA);
    await api.auth.logout();
    await api.auth.login({ login: 'helena.dias', senha: 'qualquer' });
  });
});
