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

test('criar condomínio pelo assistente com lista colada: senha do síndico uma vez; depois, desligar um módulo', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const sufixo = Date.now().toString(36);
  const nome = `Condomínio E2E ${sufixo}`;
  await entrar(page);
  await page.getByRole('link', { name: 'Novo condomínio' }).click();

  // 1. Condomínio: o código sai do nome (sem "Condomínio").
  await page.getByRole('button', { name: 'Avançar' }).click();
  await expect(page.getByText('Informe o nome do condomínio.')).toBeVisible();
  await page.getByLabel('Nome do condomínio').fill(nome);
  await expect(page.getByLabel('Código do condomínio')).toHaveValue(`e2e-${sufixo}`);
  await page.getByLabel('Cidade').fill('Campinas');
  await page.getByLabel('UF').selectOption('SP');
  await page.getByRole('button', { name: 'Avançar' }).click();

  // 2. Unidades: lista colada com uma linha ruim, removida na prévia.
  await expect(page.getByRole('heading', { level: 2, name: 'Unidades' })).toBeFocused();
  await page.getByLabel('Unidades (uma por linha)').fill('A-101\nA-102\nBloco B 1\nxyz');
  await expect(page.getByText(/^3 unidades em 2 blocos · 1 linha com problema/)).toBeVisible();
  await page.getByRole('button', { name: 'Remover a linha 4' }).click();
  await expect(page.getByRole('region', { name: 'Bloco A: 2 unidades' })).toBeVisible();
  await page.getByRole('button', { name: 'Remover Casa de máquinas' }).click();
  await page.getByRole('button', { name: 'Avançar' }).click();

  // 3. Síndico: login sugerido.
  await page.getByLabel('Nome do síndico').fill('Síndico Fictício');
  await expect(page.getByLabel('Login do síndico')).toHaveValue('sindico.ficticio');
  await page.getByRole('button', { name: 'Avançar' }).click();

  // 4. Revisar: provisionador ligado (PGlite) + confirmação explícita.
  await expect(page.getByText('Provisionador ligado: pronto para criar.')).toBeVisible();
  await expect(page.getByText('Bloco A: 2')).toBeVisible();
  const criar = page.getByRole('button', { name: 'Criar condomínio' });
  await expect(criar).toBeDisabled();
  await page.getByLabel(/Conferi os dados/).check();
  await criar.click();

  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible({ timeout: 45_000 });
  await expect(dialogo.getByTestId('senha-sindico')).toHaveText(/^\S{12,}$/);
  await dialogo.getByRole('button', { name: 'Copiar tudo' }).click();
  await expect(dialogo.getByText('Texto para o síndico copiado.')).toBeVisible();
  const copiado = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiado).toContain('https://tccgestaoacesso.vercel.app/login');
  expect(copiado).toContain(`Código do condomínio: e2e-${sufixo}`);
  expect(copiado).toContain('Login: sindico.ficticio');
  await dialogo.getByRole('button', { name: 'Já copiei, fechar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: nome })).toBeVisible();
  await expect(page.getByText(`${nome} criado`)).toBeVisible();

  await page.getByRole('button', { name: `Módulos de ${nome}` }).click();
  await page.getByRole('dialog').getByLabel('Veículos').uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar módulos' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: nome }) });
  await expect(card).toContainText('Módulos ligados (6)');
  await expect(card).not.toContainText('Veículos');
});
