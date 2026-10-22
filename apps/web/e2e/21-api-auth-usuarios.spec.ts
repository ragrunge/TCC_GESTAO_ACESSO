// E2E contra a API real (servidor de e2e sobre PGlite; banco semeado no início da spec). Fluxo: login do síndico, listar usuários, criar um usuário de teste (senha
// temporária mostrada uma vez), login dele com troca obrigatória, logout, 401 depois do logout e sessão expirada.
// Não toca na senha dos usuários do seed: a troca obrigatória é exercida num usuário criado aqui, desativado no fim.
// Senha: a dos usuários do e2e (SENHA_E2E).
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { API_E2E, SENHA_E2E, resetarBanco } from './helpers';

const API = `${API_E2E}/api/v1`;

async function entrar(page: Page, login: string, senha: string) {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill(login);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

const SENHA = SENHA_E2E;
const sufixo = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const LOGIN_TESTE = `e2e.${sufixo}`;
const NOME_TESTE = `Teste E2E ${sufixo}`;

test.describe.serial('API real: login, sessão e usuários', () => {
  let idTeste: string | null = null;

  test.beforeAll(async ({ request }) => {
    await resetarBanco(request); // banco semeado; os testes desta spec compartilham o estado (serial)
  });

  test.afterAll(async ({ playwright }) => {
    // Limpeza: desativa o usuário de teste (não há exclusão; o histórico fica na trilha).
    if (!idTeste || !SENHA) return;
    const ctx = await playwright.request.newContext();
    const r = await ctx.post(`${API}/auth/login`, { data: { login: 'roberto.faria', senha: SENHA } });
    if (r.ok()) {
      await ctx.post(`${API}/usuarios/${idTeste}/desativar`);
      await ctx.post(`${API}/auth/logout`);
    }
    await ctx.dispose();
  });

  test('tela de login não tem atalhos de demonstração; credencial errada dá mensagem única', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Usuário')).toHaveValue('');
    await expect(page.getByText('Perfil de demonstração')).toHaveCount(0);
    await expect(page.getByText(/qualquer senha/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Porteiro', exact: true })).toHaveCount(0);
    await entrar(page, 'fulano.inexistente', 'senha-qualquer-errada');
    await expect(page.getByRole('alert')).toHaveText('Usuário ou senha inválidos.');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('síndico entra, as telas operacionais carregam da API, lista e cria usuário (senha temporária uma vez)', async ({ page }) => {
    await entrar(page, 'roberto.faria', SENHA!);
    await expect(page).toHaveURL(/\/painel$/);
    // Painel, encomendas e ocorrências têm API real (desde o lote de encomendas e ocorrências): nada de "em breve"
    await expect(page.getByRole('heading', { name: 'Últimas movimentações' })).toBeVisible();
    for (const rota of ['/encomendas', '/ocorrencias']) {
      await page.goto(rota);
      await expect(page.getByRole('tablist').first()).toBeVisible();
      await expect(page.getByText('Disponível em breve na API real')).toHaveCount(0);
    }
    await page.goto('/painel');

    // sessão sobrevive ao reload (cookie HttpOnly + /auth/me)
    await page.reload();
    await expect(page).toHaveURL(/\/painel$/);

    await page.getByRole('link', { name: 'Usuários' }).click();
    await expect(page).toHaveURL(/\/usuarios$/);
    await expect(page.getByText('paula.nogueira', { exact: true })).toBeVisible();
    await expect(page.getByText('joao.lima', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Novo usuário' }).click();
    const modal = page.getByRole('dialog', { name: 'Novo usuário' });
    await modal.getByLabel('Nome completo').fill(NOME_TESTE);
    await modal.getByLabel('Login').fill(LOGIN_TESTE);
    await modal.getByRole('radio', { name: 'Porteiro' }).click();
    const resposta = page.waitForResponse((r) => r.url().endsWith('/api/v1/usuarios') && r.request().method() === 'POST');
    await modal.getByRole('button', { name: 'Criar usuário' }).click();
    idTeste = ((await (await resposta).json()) as { data: { usuario: { id: string } } }).data.usuario.id;

    const aviso = page.getByRole('dialog', { name: `Usuário ${NOME_TESTE} criado` });
    await expect(aviso.getByText('Copie agora.')).toBeVisible();
    const temporaria = (await aviso.locator('output').textContent())?.trim() ?? '';
    expect(temporaria.length).toBeGreaterThanOrEqual(12);
    await aviso.getByRole('button', { name: 'Já copiei, fechar' }).click();
    await expect(aviso).toHaveCount(0);
    await expect(page.getByText(temporaria)).toHaveCount(0); // some ao fechar
    await expect(page.getByText(LOGIN_TESTE, { exact: true })).toBeVisible(); // lista invalidada

    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    // depois do logout o cookie não vale mais
    expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);

    // usuário novo: troca obrigatória antes de qualquer rota
    await entrar(page, LOGIN_TESTE, temporaria);
    await expect(page).toHaveURL(/\/trocar-senha$/);
    await expect(page.getByText('Troca obrigatória')).toBeVisible();
    await page.goto('/usuarios');
    await expect(page).toHaveURL(/\/trocar-senha$/);
    await page.goto('/painel');
    await expect(page).toHaveURL(/\/trocar-senha$/);

    const nova = `Nova-${randomBytes(9).toString('base64url')}`;
    await page.getByLabel('Senha atual').fill(temporaria);
    await page.getByLabel('Nova senha', { exact: true }).fill('curta');
    await page.getByLabel('Confirmar nova senha').fill('curta');
    await page.getByRole('button', { name: 'Trocar senha' }).click();
    await expect(page.getByRole('alert')).toContainText('pelo menos 12');

    await page.getByLabel('Nova senha', { exact: true }).fill(nova);
    await page.getByLabel('Confirmar nova senha').fill(nova);
    await page.getByRole('button', { name: 'Trocar senha' }).click();
    await expect(page).toHaveURL(/\/painel$/);
    await expect(page.getByText(NOME_TESTE, { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('sessão encerrada por fora: o próximo 401 leva ao login com aviso, uma vez só', async ({ page }) => {
    await entrar(page, 'roberto.faria', SENHA!);
    await expect(page).toHaveURL(/\/painel$/);
    // encerra a sessão do mesmo cookie sem passar pela UI (como expiração ou revogação no servidor)
    expect((await page.request.post('/api/v1/auth/logout')).status()).toBe(204);
    // Uma consulta em segundo plano do painel pode receber o 401 antes do clique e já ter levado ao login (o link some):
    // as duas ordens são o comportamento esperado.
    await page.getByRole('link', { name: 'Usuários' }).click({ timeout: 5_000 }).catch(() => undefined);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Sua sessão expirou. Entre novamente.')).toHaveCount(1);
  });
});
