import { expect, test, type Page } from '@playwright/test';
import { API_E2E, MASTER, NOVO_MASTER, SENHA_E2E } from './ambiente';

// O reset do servidor de e2e devolve os usuários da plataforma ao estado semeado (senha, troca pendente) e zera os
// limites de login: cada teste começa do mesmo lugar.
test.beforeEach(async ({ request }) => {
  expect((await request.post(`${API_E2E}/__e2e/reset`)).ok()).toBe(true);
});

async function entrar(page: Page, email = MASTER, senha = SENHA_E2E) {
  await page.goto('/admin/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test('login com e-mail e senha (sem código) mostra as licenças com o piloto', async ({ page }) => {
  await page.goto('/admin/');
  await expect(page.getByLabel(/código/i)).toHaveCount(0);
  await entrar(page);
  await expect(page.getByRole('heading', { name: 'Licenças' })).toBeVisible();
  await expect(page.getByText('parque', { exact: true }).first()).toBeVisible();
  // O cookie da plataforma é só do caminho /api/v1/plataforma e HttpOnly.
  const c = (await page.context().cookies()).find((x) => x.name === 'portaria_plataforma');
  expect(c).toMatchObject({ path: '/api/v1/plataforma', httpOnly: true, sameSite: 'Strict' });
});

test('senha errada: mensagem única', async ({ page }) => {
  await entrar(page, MASTER, 'senha-errada-qualquer');
  await expect(page.getByRole('alert')).toHaveText(/E-mail ou senha inválidos\./);
});

test('troca de senha obrigatória antes da lista', async ({ page }) => {
  await entrar(page, NOVO_MASTER);
  await expect(page.getByRole('heading', { name: 'Troque a senha provisória' })).toBeVisible();
  await page.getByLabel('Senha atual (temporária)').fill(SENHA_E2E);
  await page.getByLabel('Nova senha', { exact: true }).fill('uma-senha-nova-do-e2e-longa');
  await page.getByLabel('Confirme a nova senha').fill('uma-senha-nova-do-e2e-longa');
  await page.getByRole('button', { name: 'Trocar senha' }).click();
  await expect(page.getByRole('heading', { name: 'Licenças' })).toBeVisible();
});

test('criar condomínio: senha do síndico uma vez; depois, desligar um módulo', async ({ page }) => {
  const codigo = `e2e-${Date.now().toString(36)}`;
  await entrar(page);
  await page.getByRole('link', { name: 'Novo condomínio' }).click();
  await page.getByLabel('Código do condomínio').fill(codigo);
  await page.getByLabel('Nome exibido').fill(`Condomínio ${codigo}`);
  await page.getByLabel('Cidade').fill('Campinas');
  await page.getByLabel('Nome do síndico').fill('Síndico Fictício');
  await page.getByLabel('Login do síndico').fill('sindico.e2e');
  await expect(page.getByText('24 unidades')).toBeVisible();
  await page.getByRole('button', { name: 'Criar condomínio' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible({ timeout: 45_000 });
  await expect(dialogo.getByTestId('senha-sindico')).toHaveText(/^\S{12,}$/);
  await dialogo.getByRole('button', { name: 'Já copiei, fechar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: `Condomínio ${codigo}` })).toBeVisible();

  await page.getByRole('button', { name: `Módulos de Condomínio ${codigo}` }).click();
  await page.getByRole('dialog').getByLabel('Veículos').uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar módulos' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `Condomínio ${codigo}` }) });
  await expect(card).toContainText('Módulos ligados (6)');
  await expect(card).not.toContainText('Veículos');
});
