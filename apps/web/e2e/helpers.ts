// Helpers compartilhados dos testes E2E do Portaria Parque.
// Isolamento: cada teste do Playwright roda num contexto de navegador novo, então localStorage e sessionStorage
// já começam vazios e o app semeia o "banco" de demonstração do zero (relógio simulado: sexta 09/10/2026 14:32).
import { expect, type Locator, type Page } from '@playwright/test';

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

/** Abre /login, escolhe o perfil de demonstração e entra (sem 2FA). */
export async function entrarComo(page: Page, perfil: Perfil) {
  await page.goto('/login');
  await page.getByRole('button', { name: perfil, exact: true }).click();
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(ROTA_INICIAL[perfil]);
  await expect(page.getByText(NOME_PERFIL[perfil], { exact: true }).first()).toBeVisible();
}

/** Encerra a sessão atual pelo botão "Sair". */
export async function sair(page: Page) {
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** Troca de usuário na mesma sessão de navegador (mantém o localStorage com os dados criados). */
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
