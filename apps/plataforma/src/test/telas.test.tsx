// Telas do app do Master com uma API falsa (sem rede): login em um envio, troca obrigatória, lista, criação com a senha
// do síndico mostrada uma vez, módulos e papel suporte.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, criarCliente } from '../api/cliente';
import type { ApiPlataforma, CondominioPlataforma, UsuarioPlataforma } from '../api/plataforma';
import { App, novoQueryClient } from '../App';
import { paraEntrada } from '../telas/NovoCondominio';

const MASTER: UsuarioPlataforma = { id: 'u1', nome: 'Master de Exemplo', email: 'master@exemplo.test', papel: 'master', deveTrocarSenha: false };
const SESSAO = { expiraEm: '2026-10-23T20:00:00Z', inatividadeMin: 15 };
const PILOTO: CondominioPlataforma = {
  id: 'c1', codigo: 'parque', nome: 'Residencial do Parque', cidade: 'São Paulo', uf: 'SP', plano: 'piloto', situacao: 'ativo',
  modulos: ['encomendas', 'ocorrencias', 'autorizacoes_previas', 'importacao', 'veiculos', 'funcionarios', 'relatorios'], criadoEm: '2026-10-01T00:00:00Z',
};

function apiFalsa(o: Partial<ApiPlataforma> = {}): ApiPlataforma {
  return {
    cliente: criarCliente('/api/v1'),
    login: vi.fn(async () => ({ usuario: MASTER, sessao: SESSAO })),
    me: vi.fn(async () => { throw new ApiError(401, 'NAO_AUTENTICADO', 'x'); }),
    logout: vi.fn(async () => undefined),
    trocarSenha: vi.fn(async () => ({ ...MASTER, deveTrocarSenha: false })),
    condominios: vi.fn(async () => [PILOTO]),
    criarCondominio: vi.fn(),
    modulos: vi.fn(),
    ...o,
  };
}

const iniciar = (api: ApiPlataforma) => render(<App api={api} queryClient={novoQueryClient()} />);
const logado = (u: UsuarioPlataforma = MASTER) => vi.fn(async () => ({ usuario: u, sessao: SESSAO }));

afterEach(() => { cleanup(); window.history.pushState({}, '', '/'); });

describe('login', () => {
  it('envia e-mail, senha e código num único envio e mostra a lista', async () => {
    const api = apiFalsa();
    iniciar(api);
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: ' master@exemplo.test ' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'uma-senha-longa' } });
    fireEvent.change(screen.getByLabelText('Código do autenticador'), { target: { value: '12a3456' } });
    expect((screen.getByLabelText('Código do autenticador') as HTMLInputElement).value).toBe('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await screen.findByRole('heading', { name: 'Licenças' });
    expect(api.login).toHaveBeenCalledWith('master@exemplo.test', 'uma-senha-longa', '123456');
    expect(await screen.findByRole('heading', { name: 'Residencial do Parque' })).toBeTruthy();
  });

  it('erro único da API e o código limpo para o próximo envio', async () => {
    const api = apiFalsa({ login: vi.fn(async () => { throw new ApiError(401, 'CREDENCIAIS_INVALIDAS', 'E-mail, senha ou código inválidos.'); }) });
    iniciar(api);
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'x@exemplo.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'errada' } });
    fireEvent.change(screen.getByLabelText('Código do autenticador'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('E-mail, senha ou código inválidos.');
    expect((screen.getByLabelText('Código do autenticador') as HTMLInputElement).value).toBe('');
  });

  it('código com menos de 6 dígitos nem vai à API', async () => {
    const api = apiFalsa();
    iniciar(api);
    fireEvent.change(await screen.findByLabelText('Código do autenticador'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await screen.findByRole('alert');
    expect(api.login).not.toHaveBeenCalled();
  });
});

describe('troca de senha obrigatória', () => {
  it('sessão com troca pendente vai para a troca; confirmação diferente não envia; depois da troca, a lista', async () => {
    const api = apiFalsa({ me: logado({ ...MASTER, deveTrocarSenha: true }) });
    iniciar(api);
    await screen.findByRole('heading', { name: 'Troque a senha provisória' });
    fireEvent.change(screen.getByLabelText('Senha atual (temporária)'), { target: { value: 'temp' } });
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'uma-senha-nova-longa' } });
    fireEvent.change(screen.getByLabelText('Confirme a nova senha'), { target: { value: 'outra-coisa-qualquer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    await screen.findByText('A confirmação não confere com a nova senha.');
    expect(api.trocarSenha).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Confirme a nova senha'), { target: { value: 'uma-senha-nova-longa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    await screen.findByRole('heading', { name: 'Licenças' });
    expect(api.trocarSenha).toHaveBeenCalledWith('temp', 'uma-senha-nova-longa');
  });
});

describe('licenças e módulos', () => {
  it('busca e filtro; módulos: PATCH com a lista marcada, na ordem do domain', async () => {
    const modulos = vi.fn(async (_id: string, m: CondominioPlataforma['modulos']) => ({ ...PILOTO, modulos: m }));
    const api = apiFalsa({ me: logado(), modulos, condominios: vi.fn(async () => [PILOTO, { ...PILOTO, id: 'c2', codigo: 'outro', nome: 'Outro Lugar', situacao: 'suspenso' as const }]) });
    iniciar(api);
    await screen.findByRole('heading', { name: 'Outro Lugar' });
    fireEvent.change(screen.getByLabelText('Buscar por nome ou código'), { target: { value: 'parq' } });
    expect(screen.queryByRole('heading', { name: 'Outro Lugar' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Buscar por nome ou código'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'suspenso' } });
    expect(screen.queryByRole('heading', { name: 'Residencial do Parque' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: 'Módulos de Residencial do Parque' }));
    const dialogo = await screen.findByRole('dialog');
    fireEvent.click(within(dialogo).getByLabelText('Veículos'));
    fireEvent.click(within(dialogo).getByLabelText('Encomendas'));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar módulos' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(modulos).toHaveBeenCalledWith('c1', ['ocorrencias', 'autorizacoes_previas', 'importacao', 'funcionarios', 'relatorios']);
  });

  it('suporte não vê "Novo condomínio" nem "Módulos"', async () => {
    iniciar(apiFalsa({ me: logado({ ...MASTER, papel: 'suporte' }) }));
    await screen.findByRole('heading', { name: 'Residencial do Parque' });
    expect(screen.queryByRole('link', { name: 'Novo condomínio' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Módulos de/ })).toBeNull();
  });
});

describe('novo condomínio', () => {
  it('converte o formulário no JSON da CLI', () => {
    const e = paraEntrada({
      codigo: ' Vila-Sul ', nome: ' Vila Sul ', cidade: 'Santos', uf: 'SP', plano: '', agrupamento: 'Torre', blocos: '1, 2', andares: '0 1', finais: '1,2',
      ausentes: 'a-01', areas: 'Piscina\n\n Salão ', sindicoNome: 'Síndico Fictício', sindicoLogin: 'Sindico.Vila',
    });
    expect(e).toEqual({
      codigo: 'vila-sul', nome: 'Vila Sul', cidade: 'Santos', uf: 'SP', plano: 'padrao',
      estrutura: { agrupamento: 'Torre', blocos: ['1', '2'], andares: [0, 1], finais: [1, 2], ausentes: ['A-01'] },
      areasComuns: ['Piscina', 'Salão'], sindico: { nome: 'Síndico Fictício', login: 'sindico.vila' },
    });
  });

  it('prévia de unidades, código inválido bloqueia, e a senha do síndico aparece uma vez e some ao fechar', async () => {
    window.history.pushState({}, '', '/novo');
    let soltar!: () => void;
    const criarCondominio = vi.fn(async () => {
      await new Promise<void>((ok) => { soltar = ok; });
      return { situacao: 'provisionado' as const, condominio: { ...PILOTO, id: 'c9', codigo: 'vila-sul', nome: 'Vila Sul' }, sindico: { login: 'sindico.vila', senhaTemporaria: 'abcd-efgh-jkmn-pqrs', expiraEm: '2026-10-26T12:00:00Z' } };
    });
    iniciar(apiFalsa({ me: logado(), criarCondominio }));
    await screen.findByRole('heading', { name: 'Novo condomínio' });
    expect(screen.getByText('24 unidades')).toBeTruthy(); // padrão: A, B x 3 andares x 4 finais
    fireEvent.change(screen.getByLabelText('Unidades que não existem (opcional)'), { target: { value: '9-99' } });
    expect((await screen.findAllByRole('alert'))[0]!.textContent).toMatch(/ausente/);
    fireEvent.change(screen.getByLabelText('Unidades que não existem (opcional)'), { target: { value: '' } });

    fireEvent.change(screen.getByLabelText('Código do condomínio'), { target: { value: '1ruim' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar condomínio' }));
    await screen.findByText(/começando por letra\./);
    expect(criarCondominio).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Código do condomínio'), { target: { value: 'vila-sul' } });
    fireEvent.change(screen.getByLabelText('Nome exibido'), { target: { value: 'Vila Sul' } });
    fireEvent.change(screen.getByLabelText('Cidade'), { target: { value: 'Santos' } });
    fireEvent.change(screen.getByLabelText('Nome do síndico'), { target: { value: 'Síndico Fictício' } });
    fireEvent.change(screen.getByLabelText('Login do síndico'), { target: { value: 'sindico.vila' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar condomínio' }));
    await screen.findByText(/Provisionando/);
    fireEvent.click(screen.getByRole('button', { name: /Criar condomínio/ })); // duplo clique não reenvia
    await act(async () => { soltar(); });
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByTestId('senha-sindico').textContent).toBe('abcd-efgh-jkmn-pqrs');
    expect(criarCondominio).toHaveBeenCalledTimes(1);
    const fechar = within(dialogo).getByRole('button', { name: 'Já copiei, fechar' });
    expect(document.activeElement).toBe(fechar);
    fireEvent.click(fechar);
    await screen.findByRole('heading', { name: 'Licenças' });
    expect(screen.queryByText('abcd-efgh-jkmn-pqrs')).toBeNull();
  });

  it('ja_provisionado: avisa, sem senha', async () => {
    window.history.pushState({}, '', '/novo');
    const criarCondominio = vi.fn(async () => ({ situacao: 'ja_provisionado' as const, condominio: PILOTO, sindico: null }));
    iniciar(apiFalsa({ me: logado(), criarCondominio }));
    await screen.findByRole('heading', { name: 'Novo condomínio' });
    fireEvent.change(screen.getByLabelText('Código do condomínio'), { target: { value: 'parque' } });
    fireEvent.change(screen.getByLabelText('Nome exibido'), { target: { value: 'Residencial do Parque' } });
    fireEvent.change(screen.getByLabelText('Cidade'), { target: { value: 'São Paulo' } });
    fireEvent.change(screen.getByLabelText('Nome do síndico'), { target: { value: 'Síndico Fictício' } });
    fireEvent.change(screen.getByLabelText('Login do síndico'), { target: { value: 'sindico.parque' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar condomínio' }));
    expect((await screen.findByText(/já estava provisionado/)).textContent).toMatch(/nenhuma senha/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
