// Telas do app do Master com uma API falsa (sem rede): login em um envio, troca obrigatória, lista, o assistente de
// criação (passos, validação, sugestões, prévia, provisionador desligado, senha do síndico uma vez), módulos e suporte.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, criarCliente } from '../api/cliente';
import type { ApiPlataforma, CondominioPlataforma, UsuarioPlataforma } from '../api/plataforma';
import { App, novoQueryClient } from '../App';
import { lerListaUnidades } from '@portaria/domain/units';
import { comCodigo, comNome, montarEntrada, RASCUNHO_VAZIO, semLinhas } from '../telas/novo/rascunho';
import { URL_LOGIN_PORTARIA } from '../telas/SenhaSindicoModal';

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
    saudeProvisionador: vi.fn(async () => ({ disponivel: true })),
    modulos: vi.fn(),
    ...o,
  };
}

// jsdom não tem ResizeObserver; o Checkbox do Radix dentro de <form> mede o controle com ele.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const iniciar = (api: ApiPlataforma) => render(<App api={api} queryClient={novoQueryClient()} />);
const logado = (u: UsuarioPlataforma = MASTER) => vi.fn(async () => ({ usuario: u, sessao: SESSAO }));

beforeEach(() => { window.history.pushState({}, '', '/admin/'); });
afterEach(() => { cleanup(); window.history.pushState({}, '', '/admin/'); });

describe('login', () => {
  it('envia só e-mail e senha (sem campo de código) e mostra a lista', async () => {
    const api = apiFalsa();
    iniciar(api);
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: ' master@exemplo.test ' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'uma-senha-longa' } });
    expect(screen.queryByLabelText(/código/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await screen.findByRole('heading', { name: 'Licenças' });
    expect(api.login).toHaveBeenCalledWith('master@exemplo.test', 'uma-senha-longa');
    expect(await screen.findByRole('heading', { name: 'Residencial do Parque' })).toBeTruthy();
  });

  it('erro único da API', async () => {
    const api = apiFalsa({ login: vi.fn(async () => { throw new ApiError(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha inválidos.'); }) });
    iniciar(api);
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'x@exemplo.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('E-mail ou senha inválidos.');
  });
});

describe('troca de senha obrigatória', () => {
  it('sessão com troca pendente vai para a troca; confirmação diferente não envia; depois da troca, a lista', async () => {
    const api = apiFalsa({ me: logado({ ...MASTER, deveTrocarSenha: true }) });
    iniciar(api);
    await screen.findByRole('heading', { name: 'Troque a senha provisória' });
    fireEvent.change(screen.getByLabelText('Senha atual (temporária)'), { target: { value: 'temp' } });
    // 15 caracteres: o mínimo do Master é 16 (o do condomínio é 12); nem vai à API.
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'frase-de-15-car' } });
    fireEvent.change(screen.getByLabelText('Confirme a nova senha'), { target: { value: 'frase-de-15-car' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    await screen.findByText('A senha precisa ter pelo menos 16 caracteres.');
    expect(api.trocarSenha).not.toHaveBeenCalled();
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

describe('novo condomínio: regras do rascunho', () => {
  it('monta o corpo da API com a lista explícita (sem estrutura) e o plano padrão', () => {
    let r = comNome(RASCUNHO_VAZIO, ' Residencial Vila Sul ');
    r = { ...r, cidade: ' Santos ', uf: 'RJ', agrupamento: 'Torre', textoLista: 'b 2\nA-101\n', areas: ['Piscina', ' Salão '], sindicoNome: ' Maria Souza ', sindicoLogin: 'maria.souza' };
    expect(montarEntrada(r, lerListaUnidades(r.textoLista))).toEqual({
      codigo: 'vila-sul', nome: 'Residencial Vila Sul', cidade: 'Santos', uf: 'RJ', plano: 'padrao', agrupamento: 'Torre',
      unidades: [{ bloco: 'A', numero: '101' }, { bloco: 'B', numero: '02' }],
      areasComuns: ['Piscina', 'Salão'], sindico: { nome: 'Maria Souza', login: 'maria.souza' },
    });
  });

  it('código: sugerido até ser editado; apagado volta à sugestão. Remover linha: some da lista, fica em branco na planilha', () => {
    let r = comNome(RASCUNHO_VAZIO, 'Condomínio Jardim');
    expect(r.codigo).toBe('jardim');
    r = comNome(comCodigo(r, ' Meu-Codigo '), 'Outro');
    expect([r.codigo, r.codigoEditado]).toEqual(['meu-codigo', true]);
    expect(comCodigo(r, '').codigo).toBe('outro');
    expect(semLinhas({ ...r, textoLista: 'a\nb\nc' }, [2]).textoLista).toBe('a\nc');
    expect(semLinhas({ ...r, fonte: 'planilha', textoPlanilha: 'a\nb\nc' }, [2, 3]).textoPlanilha).toBe('a\n\n');
  });
});

describe('novo condomínio: assistente', () => {
  const NOVO: CondominioPlataforma = { ...PILOTO, id: 'c9', codigo: 'vila-sul', nome: 'Residencial Vila Sul', cidade: 'Santos', plano: 'padrao' };
  const mudar = (rotulo: string | RegExp, valor: string) => fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
  const avancar = () => fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
  const titulo = (nome: string) => screen.findByRole('heading', { level: 2, name: nome });

  async function abrir(o: Partial<ApiPlataforma> = {}) {
    window.history.pushState({}, '', '/admin/novo');
    const api = apiFalsa({ me: logado(), ...o });
    iniciar(api);
    await screen.findByRole('heading', { name: 'Novo condomínio' });
    return api;
  }

  async function ateRevisao() {
    mudar('Nome do condomínio', 'Residencial Vila Sul');
    mudar('Cidade', 'Santos');
    avancar();
    await titulo('Unidades');
    mudar('Unidades (uma por linha)', 'A-101\nA-102\nB-1');
    avancar();
    await titulo('Síndico');
    mudar('Nome do síndico', 'Maria José da Souza');
    avancar();
    await titulo('Revisar e criar');
  }

  it('passo 1: valida antes de avançar (foco no primeiro erro), sugere o código, foca o título do passo e Voltar preserva tudo', async () => {
    await abrir();
    expect(screen.getByRole('navigation', { name: 'Etapas' }).querySelector('[aria-current="step"]')!.textContent).toContain('Condomínio');
    avancar();
    expect(await screen.findByText('Informe o nome do condomínio.')).toBeTruthy();
    expect(screen.getByText(/^3 a 31 caracteres/)).toBeTruthy();
    expect(screen.getByText('Informe a cidade.')).toBeTruthy();
    const nome = screen.getByLabelText('Nome do condomínio');
    await waitFor(() => expect(document.activeElement).toBe(nome));
    expect(nome.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(nome.getAttribute('aria-describedby')!)!.textContent).toBe('Informe o nome do condomínio.');

    mudar('Nome do condomínio', 'Residencial Vila Sul');
    expect((screen.getByLabelText('Código do condomínio') as HTMLInputElement).value).toBe('vila-sul');
    expect(screen.getByText(/não muda depois/)).toBeTruthy();
    mudar('Código do condomínio', 'Vila-Sul-2');
    mudar('Nome do condomínio', 'Residencial Vila Sul II');
    expect((screen.getByLabelText('Código do condomínio') as HTMLInputElement).value).toBe('vila-sul-2');
    expect(screen.queryByLabelText(/Plano/)).toBeNull();
    mudar('Cidade', 'Santos');
    mudar('UF', 'RJ');
    avancar();
    const h = await titulo('Unidades');
    await waitFor(() => expect(document.activeElement).toBe(h));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    await titulo('Condomínio');
    expect((screen.getByLabelText('Nome do condomínio') as HTMLInputElement).value).toBe('Residencial Vila Sul II');
    expect((screen.getByLabelText('Código do condomínio') as HTMLInputElement).value).toBe('vila-sul-2');
    expect((screen.getByLabelText('UF') as HTMLSelectElement).value).toBe('RJ');
  });

  it('passo 2: nada pré-preenchido; prévia por bloco; inválidas e repetidas com o motivo e remoção; agrupamento; áreas como etiquetas', async () => {
    await abrir();
    mudar('Nome do condomínio', 'Vila Sul');
    mudar('Cidade', 'Santos');
    avancar();
    await titulo('Unidades');
    expect((screen.getByLabelText('Unidades (uma por linha)') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText('Nenhuma unidade ainda. Cole a lista ou envie a planilha.')).toBeTruthy();
    avancar();
    expect(await screen.findByText('Cole ao menos uma unidade.')).toBeTruthy();

    mudar('Unidades (uma por linha)', 'A-101\na 101\nxyz\nB 2\nA-102');
    expect(screen.getByText(/^3 unidades em 2 blocos · 2 linhas com problema/)).toBeTruthy();
    const problemas = screen.getByRole('list', { name: 'Linhas com problema' });
    expect(problemas.textContent).toContain('Repetida: A-101 já está na linha 1.');
    expect(problemas.textContent).toMatch(/Linha 3: "xyz"\. Falta o número/);
    avancar();
    expect(await screen.findByText('Há 2 linhas com problema: corrija ou remova antes de avançar.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remover a linha 3' }));
    expect((screen.getByLabelText('Unidades (uma por linha)') as HTMLTextAreaElement).value).toBe('A-101\na 101\nB 2\nA-102');
    fireEvent.click(screen.getByRole('button', { name: 'Remover todas as linhas com problema' }));
    expect(screen.queryByRole('list', { name: 'Linhas com problema' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Bloco A: 2 unidades' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remover B-02' }));
    expect(screen.queryByRole('region', { name: /^Bloco B/ })).toBeNull();
    expect((screen.getByLabelText('Unidades (uma por linha)') as HTMLTextAreaElement).value).toBe('A-101\nA-102');
    mudar('Como o condomínio chama o agrupamento', 'Torre');
    expect(screen.getByRole('region', { name: 'Torre A: 2 unidades' })).toBeTruthy();

    const areas = screen.getByRole('list', { name: 'Áreas comuns escolhidas' });
    expect(within(areas).getAllByRole('listitem').length).toBe(7);
    fireEvent.click(screen.getByRole('button', { name: 'Remover Piscina' }));
    mudar('Nova área comum', 'Churrasqueira');
    fireEvent.keyDown(screen.getByLabelText('Nova área comum'), { key: 'Enter' });
    expect(within(areas).getByText('Churrasqueira')).toBeTruthy();
    expect(within(areas).queryByText('Piscina')).toBeNull();
    mudar('Nova área comum', 'churrasqueira');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(screen.getByText('"churrasqueira" já está na lista.')).toBeTruthy();
    avancar();
    await titulo('Síndico');
  });

  it('passo 2: planilha CSV (aba própria), com a numeração das linhas do arquivo', async () => {
    await abrir();
    mudar('Nome do condomínio', 'Vila Sul');
    mudar('Cidade', 'Santos');
    avancar();
    await titulo('Unidades');
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Enviar planilha/ }));
    const arquivo = new File(['Bloco;Unidade\nA;101\nA;102\n\nA;101\nB;'], 'unidades.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText('Arquivo CSV ou XLSX'), { target: { files: [arquivo] } });
    expect(await screen.findByText('unidades.csv')).toBeTruthy();
    expect(screen.getByText(/^2 unidades em 1 bloco · 2 linhas com problema/)).toBeTruthy();
    const problemas = screen.getByRole('list', { name: 'Linhas com problema' });
    expect(problemas.textContent).toContain('Linha da planilha 5: "A 101". Repetida: A-101 já está na linha 2.');
    expect(problemas.textContent).toContain('Linha da planilha 6: "B". Falta o número do apartamento (ex.: A-101).');
    fireEvent.click(screen.getByRole('button', { name: 'Remover a linha 5' }));
    expect(screen.getByRole('list', { name: 'Linhas com problema' }).textContent).toContain('Linha da planilha 6');
    fireEvent.change(screen.getByLabelText('Arquivo CSV ou XLSX'), { target: { files: [new File(['x'], 'u.pdf')] } });
    expect(await screen.findByText('Formato não aceito: envie um arquivo .csv ou .xlsx.')).toBeTruthy();
  });

  it('passo 3: login sugerido do nome (minúsculo, sem acento), editável', async () => {
    await abrir();
    mudar('Nome do condomínio', 'Vila Sul');
    mudar('Cidade', 'Santos');
    avancar();
    await titulo('Unidades');
    mudar('Unidades (uma por linha)', 'A-1');
    avancar();
    await titulo('Síndico');
    avancar();
    expect(await screen.findByText('Informe o nome do síndico (3 caracteres ou mais).')).toBeTruthy();
    mudar('Nome do síndico', 'Ângela Maria da Conceição');
    expect((screen.getByLabelText('Login do síndico') as HTMLInputElement).value).toBe('angela.conceicao');
    mudar('Login do síndico', 'Sindica.Vila');
    mudar('Nome do síndico', 'Ângela Conceição');
    expect((screen.getByLabelText('Login do síndico') as HTMLInputElement).value).toBe('sindica.vila');
    mudar('Login do síndico', '1abc');
    avancar();
    expect(await screen.findByText(/^3 a 40 caracteres: letras minúsculas/)).toBeTruthy();
  });

  it('revisão: provisionador desligado bloqueia com o comando; verificar de novo; confirmação; senha uma vez com "copiar tudo"; lista com destaque', async () => {
    const saude = vi.fn().mockResolvedValueOnce({ disponivel: false }).mockResolvedValue({ disponivel: true });
    let soltar!: () => void;
    const criarCondominio = vi.fn(async () => {
      await new Promise<void>((ok) => { soltar = ok; });
      return { situacao: 'provisionado' as const, condominio: NOVO, sindico: { login: 'maria.souza', senhaTemporaria: 'abcd-efgh-jkmn-pqrs', expiraEm: '2026-10-26T12:00:00Z' } };
    });
    const condominios = vi.fn(async () => [PILOTO, NOVO]);
    const escrever = vi.fn(async (_texto: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escrever }, configurable: true });
    await abrir({ saudeProvisionador: saude, criarCondominio, condominios });
    await ateRevisao();

    expect(await screen.findByText('docker compose --profile provisionar up -d provisionador')).toBeTruthy();
    const criar = screen.getByRole('button', { name: 'Criar condomínio' }) as HTMLButtonElement;
    fireEvent.click(screen.getByLabelText(/Conferi os dados/));
    expect(criar.disabled).toBe(true); // confirmado, mas o provisionador está desligado
    fireEvent.click(screen.getByRole('button', { name: 'Verificar de novo' }));
    expect(await screen.findByText('Provisionador ligado: pronto para criar.')).toBeTruthy();
    expect(criar.disabled).toBe(false);
    fireEvent.click(screen.getByLabelText(/Conferi os dados/));
    expect(criar.disabled).toBe(true); // sem a confirmação
    fireEvent.click(screen.getByLabelText(/Conferi os dados/));

    expect(screen.getByText('Bloco A: 2')).toBeTruthy();
    expect(screen.getByText('Bloco B: 1')).toBeTruthy();
    expect(screen.getByText('maria.souza')).toBeTruthy();
    fireEvent.click(criar);
    await screen.findByText(/Provisionando/);
    fireEvent.click(screen.getByRole('button', { name: /Criar condomínio/ })); // duplo clique não reenvia
    await act(async () => { soltar(); });
    const dialogo = await screen.findByRole('dialog');
    expect(criarCondominio).toHaveBeenCalledTimes(1);
    expect(criarCondominio).toHaveBeenCalledWith({
      codigo: 'vila-sul', nome: 'Residencial Vila Sul', cidade: 'Santos', uf: 'SP', plano: 'padrao', agrupamento: 'Bloco',
      unidades: [{ bloco: 'A', numero: '101' }, { bloco: 'A', numero: '102' }, { bloco: 'B', numero: '01' }],
      areasComuns: ['Salão de festas', 'Piscina', 'Quadra', 'Academia', 'Administração', 'Casa de máquinas', 'Jardins'],
      sindico: { nome: 'Maria José da Souza', login: 'maria.souza' },
    });
    expect(within(dialogo).getByTestId('senha-sindico').textContent).toBe('abcd-efgh-jkmn-pqrs');
    const fechar = within(dialogo).getByRole('button', { name: 'Já copiei, fechar' });
    await waitFor(() => expect(document.activeElement).toBe(fechar));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Copiar tudo' }));
    await within(dialogo).findByText('Texto para o síndico copiado.');
    const texto = escrever.mock.calls[0]![0] as string;
    for (const parte of [URL_LOGIN_PORTARIA, 'Código do condomínio: vila-sul', 'Login: maria.souza', 'Senha temporária: abcd-efgh-jkmn-pqrs']) expect(texto).toContain(parte);
    expect(texto).not.toContain('/admin');
    expect(within(dialogo).getByText(/troca a senha no primeiro acesso/)).toBeTruthy();
    fireEvent.click(fechar);
    await screen.findByRole('heading', { name: 'Licenças' });
    expect(screen.queryByText('abcd-efgh-jkmn-pqrs')).toBeNull();
    expect(await screen.findByText(/Residencial Vila Sul criado/)).toBeTruthy();
    expect(screen.getByText('Novo')).toBeTruthy();
  });

  it('503 na criação: o aviso do provisionador volta e o botão desabilita; ja_provisionado avisa sem senha', async () => {
    const criarCondominio = vi.fn()
      .mockRejectedValueOnce(new ApiError(503, 'PROVISIONADOR_INDISPONIVEL', 'O provisionador está desligado. Na VPS: docker compose --profile provisionar up -d provisionador'))
      .mockResolvedValueOnce({ situacao: 'ja_provisionado' as const, condominio: NOVO, sindico: null });
    await abrir({ criarCondominio });
    await ateRevisao();
    await screen.findByText('Provisionador ligado: pronto para criar.');
    fireEvent.click(screen.getByLabelText(/Conferi os dados/));
    fireEvent.click(screen.getByRole('button', { name: 'Criar condomínio' }));
    expect(await screen.findByText('docker compose --profile provisionar up -d provisionador')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Criar condomínio' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Verificar de novo' }));
    await screen.findByText('Provisionador ligado: pronto para criar.');
    fireEvent.click(screen.getByRole('button', { name: 'Criar condomínio' }));
    expect((await screen.findByText(/já estava provisionado/)).textContent).toMatch(/nenhuma senha/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
