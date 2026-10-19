// Helpers compartilhados dos testes E2E do Portaria Parque, contra a API de teste sobre PGlite (playwright.config.ts).
// Isolamento: `test` daqui volta o banco ao estado semeado ANTES de cada teste (POST /__e2e/reset, rota que só existe
// no servidor de e2e), como o antigo mock fazia com o localStorage. Specs com estado entre testes (describe.serial)
// usam `resetarBanco` uma vez no beforeAll. Datas relativas à hora real (não há relógio simulado).
import { test as base, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { API_E2E, SENHA_E2E } from './ambiente';

export { expect };
export { API_E2E, SENHA_E2E };

/** Volta o banco da API de e2e ao estado semeado (dados de apps/api/test/e2e/dados.ts). */
export async function resetarBanco(request: APIRequestContext) {
  const r = await request.post(`${API_E2E}/__e2e/reset`);
  expect(r.ok(), await r.text()).toBe(true);
}

/** `test` com banco limpo a cada teste. */
export const test = base.extend<{ bancoLimpo: void }>({
  bancoLimpo: [async ({ request }, usar) => { await resetarBanco(request); await usar(); }, { auto: true }],
});

export type Perfil = 'Porteiro' | 'Administração' | 'Síndico' | 'Auditor';

export const NOME_PERFIL: Record<Perfil, string> = {
  Porteiro: 'João Lima',
  Administração: 'Paula Nogueira',
  Síndico: 'Roberto Faria',
  Auditor: 'Luíza Campos',
};

/** Rota inicial esperada de cada perfil (rbac.rotaInicial). */
export const ROTA_INICIAL: Record<Perfil, RegExp> = {
  Porteiro: /\/painel$/,
  Administração: /\/vinculos$/,
  Síndico: /\/painel$/,
  Auditor: /\/historico$/,
};

export const LOGIN_PERFIL: Record<Perfil, string> = {
  Porteiro: 'joao.lima',
  Administração: 'paula.nogueira',
  Síndico: 'roberto.faria',
  Auditor: 'luiza.campos',
};

/** Preenche usuário e senha em /login e envia. */
export async function preencherLogin(page: Page, login: string, senha = SENHA_E2E) {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill(login);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

/** Entra com o usuário do perfil (sem 2FA) e espera a rota inicial. */
export async function entrarComo(page: Page, perfil: Perfil) {
  await preencherLogin(page, LOGIN_PERFIL[perfil]);
  await expect(page).toHaveURL(ROTA_INICIAL[perfil]);
  await expect(page.getByText(NOME_PERFIL[perfil], { exact: true }).first()).toBeVisible();
}

/** Encerra a sessão atual pelo botão "Sair". */
export async function sair(page: Page) {
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** Troca de usuário na mesma página (os dados criados ficam no banco da API de e2e). */
export async function trocarPara(page: Page, perfil: Perfil) {
  await sair(page);
  await entrarComo(page, perfil);
}

// ---------------------------------------------------------------------------------------------
// Tela /entrada
// ---------------------------------------------------------------------------------------------

/** Busca a pessoa pelo texto e clica no resultado cujo nome contém `nome`. */
export async function escolherPessoa(page: Page, busca: string, nome = busca) {
  await page.getByRole('combobox', { name: /Buscar por nome/ }).fill(busca);
  await page.getByRole('option', { name: new RegExp(nome) }).first().click();
  await expect(page.getByRole('button', { name: 'Trocar', exact: true })).toBeVisible();
}

/** Escolhe a unidade pelo seletor de bloco (botões A–I) e campo de apartamento. Ex.: "D-32". */
export async function escolherUnidade(page: Page, unidade: string) {
  const m = /^([A-Z0-9]{1,3})-(\d{2,4})$/.exec(unidade);
  if (!m) throw new Error(`Unidade inválida: ${unidade}`);
  await page.getByRole('radio', { name: m[1], exact: true }).click();
  await page.getByLabel('Ou digite o apartamento', { exact: false }).fill(m[2]);
  await expect(page.getByRole('button', { name: 'Alterar', exact: true })).toBeVisible();
}

/** Clica num meio de autorização. Os radios são sr-only, então o clique vai no texto do rótulo. */
export async function escolherMeio(page: Page, meio: 'Interfone' | 'Morador presente' | 'Autorização prévia' | 'Exceção do porteiro' | 'Escala') {
  await page.getByRole('group', { name: 'Meio de autorização' }).getByText(meio, { exact: true }).click();
}

/** Escolhe o morador que autorizou (interfone / morador presente). */
export async function escolherMorador(page: Page, nome: string) {
  await page.getByRole('radiogroup', { name: /Morador que autorizou/ }).getByText(nome, { exact: true }).click();
}

export const botaoConfirmarEntrada = (page: Page) => page.getByRole('button', { name: /^Confirmar entrada/ });

/** Linha da tabela de eventos (Histórico) que contém todos os textos dados. */
export function linhaEvento(page: Page, ...textos: (string | RegExp)[]): Locator {
  let l = page.getByRole('table', { name: 'Eventos de acesso' }).getByRole('row', { name: /^Abrir evento/ });
  for (const t of textos) l = l.filter({ hasText: t });
  return l;
}

/** No Histórico, filtra pela pessoa (campo "Pessoa") e devolve a tabela filtrada. */
export async function filtrarHistoricoPorPessoa(page: Page, nome: string) {
  await page.goto('/historico');
  await page.getByLabel('Pessoa', { exact: true }).fill(nome);
}

/** Toast (região de notificações) com o texto dado. */
export const toast = (page: Page, texto: string | RegExp) => page.getByRole('region', { name: 'Notificações' }).getByText(texto);

// ---------------------------------------------------------------------------------------------
// Datas e horas em São Paulo (UTC-3 fixo, como @portaria/domain/time), relativas à hora real
// ---------------------------------------------------------------------------------------------
const BRT_MS = 3 * 3600_000;
const iso = (ms: number) => new Date(ms - BRT_MS).toISOString();
/** "AAAA-MM-DD" de hoje + `dias` (campos type=date). */
export const diaSP = (dias = 0) => iso(Date.now() + dias * 86_400_000).slice(0, 10);
/** "HH:MM" do instante (campos type=time). */
export const horaSP = (ms: number) => iso(ms).slice(11, 16);
/** "DD/MM/AAAA" do instante (como a tela mostra). */
export const dataBR = (ms: number) => { const d = iso(ms); return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`; };
/** Minutos desde a meia-noite em São Paulo. */
export const minutosHojeSP = () => { const d = iso(Date.now()); return Number(d.slice(11, 13)) * 60 + Number(d.slice(14, 16)); };
