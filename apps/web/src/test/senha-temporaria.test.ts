// Senha temporária (spec §5.1: vale 72 h): textos da tela de Usuários (mensagem copiada e aviso da lista). A validade
// em si (login recusado depois de 72 h, redefinir renova, troca zera) é testada na API: senha-temporaria.test.ts.
import { describe, expect, it } from 'vitest';
import { brt, HORA } from '@portaria/domain/time';
import type { UsuarioSistema } from '@portaria/domain/types';
import { avisoSenhaTemporaria, mensagemAcesso } from '../features/usuarios/senhaTemporaria';

// Prazo fixo para os textos: 12/10/2026 14:32 (São Paulo).
const FIM = brt(2026, 10, 12, 14, 32);
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
