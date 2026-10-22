// E2E do código do condomínio no login (docs/05_arquitetura_saas.md SAAS-05, §6.2) contra a API real sobre PGlite.
// O servidor de e2e registra o piloto com o código CODIGO_PILOTO_E2E (apps/api/test/e2e/servidor.ts) e a transição
// ligada (SAAS_PILOTO_PADRAO): login sem código cai no piloto.
import { expect, test, LOGIN_PERFIL, NOME_PERFIL, SENHA_E2E, sair } from './helpers';
import type { Page, Request } from '@playwright/test';

/** Mesmo valor de CODIGO_PILOTO_E2E na API de e2e. */
const CODIGO = 'parque';
/** Nome do piloto no servidor de e2e (test/helpers/saas.ts), mostrado no cabeçalho do layout. */
const NOME_CONDOMINIO = 'Condomínio de teste';

async function entrar(page: Page, codigo: string | null, login: string, senha = SENHA_E2E) {
  await page.goto('/login');
  if (codigo !== null) await page.getByLabel('Código do condomínio').fill(codigo);
  await page.getByLabel('Usuário').fill(login);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

/** Toda requisição à API com o valor do X-Condominio (ou null). */
function gravarRequisicoes(page: Page) {
  const vistas: { url: string; metodo: string; condominio: string | null }[] = [];
  page.on('request', (r: Request) => {
    if (!r.url().includes('/api/v1/')) return;
    vistas.push({ url: new URL(r.url()).pathname, metodo: r.method(), condominio: r.headers()['x-condominio'] ?? null });
  });
  return vistas;
}

test('com o código do piloto entra, o cabeçalho mostra o nome do condomínio e X-Condominio só vai no login', async ({ page }) => {
  const vistas = gravarRequisicoes(page);
  await entrar(page, CODIGO, LOGIN_PERFIL['Síndico']);
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByText(NOME_PERFIL['Síndico'], { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('banner').getByText(NOME_CONDOMINIO, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Últimas movimentações' })).toBeVisible();

  const login = vistas.filter((v) => v.url.endsWith('/auth/login'));
  expect(login).toEqual([{ url: '/api/v1/auth/login', metodo: 'POST', condominio: CODIGO }]);
  const outras = vistas.filter((v) => !v.url.endsWith('/auth/login'));
  expect(outras.length).toBeGreaterThan(0);
  expect(outras.filter((v) => v.condominio !== null)).toEqual([]);

  // Lembrado como preferência: depois de sair, o campo volta preenchido.
  await sair(page);
  await expect(page.getByLabel('Código do condomínio')).toHaveValue(CODIGO);
});

test('código inexistente: a mesma mensagem genérica da senha errada', async ({ page }) => {
  await entrar(page, 'nao-existe-aqui', LOGIN_PERFIL['Síndico']);
  await expect(page.getByRole('alert')).toHaveText('Usuário ou senha inválidos.');
  await expect(page).toHaveURL(/\/login$/);

  await entrar(page, CODIGO, 'fulano.inexistente', 'senha-qualquer-errada');
  await expect(page.getByRole('alert')).toHaveText('Usuário ou senha inválidos.');

  // Código com erro de digitação nunca é lembrado.
  await page.goto('/login');
  await expect(page.getByLabel('Código do condomínio')).toHaveValue('');
});

test('sem código (transição): entra no piloto e passa a lembrar o código que a API devolveu', async ({ page }) => {
  const vistas = gravarRequisicoes(page);
  await entrar(page, null, LOGIN_PERFIL['Porteiro']);
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByText(NOME_PERFIL['Porteiro'], { exact: true }).first()).toBeVisible();
  expect(vistas.filter((v) => v.condominio !== null)).toEqual([]);
  await sair(page);
  await expect(page.getByLabel('Código do condomínio')).toHaveValue(CODIGO);
});
