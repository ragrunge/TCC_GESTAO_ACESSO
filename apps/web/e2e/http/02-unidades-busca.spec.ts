// E2E contra a API real (Docker local): catálogo e badge no Layout, busca do topo por nome e por unidade, detalhe da
// unidade com seções "em breve" e o CRUD de unidade (criar e desativar). Depende do seed de dev com as pessoas fictícias
// (docker compose exec api node dist/cli/seed-dev.js). A senha do seed vem de SEED_SENHA_DEV e nunca é impressa.
// Unidade de teste: torre 99, número aleatório, desativada no fim (não há exclusão: as inativas se acumulam na torre 99;
// para limpar, docker compose down -v).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:3000/api/v1';

function senhaSeed(): string | undefined {
  if (process.env.SEED_SENHA_DEV) return process.env.SEED_SENHA_DEV;
  try {
    const env = readFileSync(resolve(process.cwd(), '../../.env'), 'utf8');
    const m = /^SEED_SENHA_DEV=(.*)$/m.exec(env);
    return m?.[1]?.trim().replace(/^['"]|['"]$/g, '') || undefined;
  } catch { return undefined; }
}

async function apiDePe(request: APIRequestContext) {
  try { return (await request.get(`${API}/saude`, { timeout: 3_000 })).ok(); } catch { return false; }
}

async function entrar(page: Page, login: string, senha: string) {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill(login);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

const SENHA = senhaSeed();
const NUMERO = String(1000 + Math.floor(Math.random() * 9000));
const CODIGO = `T99-${NUMERO}`;

test.describe.serial('API real: catálogo, badge, busca e unidades', () => {
  test.beforeAll(async ({ request }) => {
    test.skip(!(await apiDePe(request)), 'API local fora do ar (docker compose up)');
    test.skip(!SENHA, 'SEED_SENHA_DEV ausente');
  });

  test('administração vê o catálogo na grade de unidades e o badge de vínculos pendentes', async ({ page }) => {
    await entrar(page, 'paula.nogueira', SENHA!);
    await expect(page).toHaveURL(/\/vinculos$/); // rota inicial da administração (módulo ainda "em breve")
    // Badge: o número vem da API (mesma sessão do navegador)
    const r = await page.request.get('/api/v1/vinculos/contagem?status=pendente');
    expect(r.status()).toBe(200);
    const total = ((await r.json()) as { data: { total: number } }).data.total;
    expect(total).toBeGreaterThan(0); // seed: 3 pendentes
    await expect(page.getByRole('link', { name: /Vínculos pendentes/ }).getByLabel(`${total} pendentes`)).toBeVisible();

    await page.getByRole('link', { name: 'Unidades', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Torre 4 · Apartamento 32' })).toBeVisible();
    const torres = page.getByRole('radiogroup', { name: 'Torre' });
    for (const t of ['1', '5', '9']) await expect(torres.getByRole('radio', { name: t, exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Unidades da torre 4' }).getByRole('button', { name: 'Apartamento 32' })).toBeVisible();
  });

  test('busca do topo por nome abre a ficha; por unidade leva ao detalhe com as seções sem API "em breve"', async ({ page }) => {
    await entrar(page, 'roberto.faria', SENHA!);
    await expect(page).toHaveURL(/\/painel$/);
    const busca = page.getByLabel('Buscar por nome, documento, unidade ou placa');
    const resultados = page.getByRole('listbox', { name: 'Resultados da busca' });

    // Nome (sem acento): o termo vai no corpo do POST, nunca na URL
    const pedido = page.waitForRequest((r) => r.url().includes('/api/v1/busca'));
    await busca.fill('lucia rib');
    const req = await pedido;
    expect(req.method()).toBe('POST');
    expect(new URL(req.url()).search).toBe('');
    await expect(resultados.getByRole('option', { name: /Lúcia Ribeiro/ })).toBeVisible();

    // Unidade pelo código
    await busca.fill('T4-32');
    const opcao = resultados.getByRole('option', { name: /T4-32.*Unidade/ });
    await expect(opcao).toBeVisible();
    await expect(resultados.getByRole('option', { name: /Ana Ribeiro/ })).toBeVisible(); // moradores da unidade
    await opcao.click();
    await expect(page).toHaveURL(/\/unidades\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: 'Torre 4 · Apartamento 32' })).toBeVisible();
    await expect(page.getByText('FKR2C41')).toBeVisible(); // veículos já vêm da API
    await expect(page.getByRole('note', { name: 'Moradores: disponível em breve' })).toBeVisible();
    await expect(page.getByRole('note', { name: 'Restrições: disponível em breve' })).toBeVisible();
    await expect(page.getByRole('note', { name: 'Histórico recente de acessos: disponível em breve' })).toBeVisible();
    // ações de módulos sem API não aparecem (não dariam 501)
    await expect(page.getByRole('button', { name: 'Solicitar vínculo' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Nova restrição' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Desativar unidade' })).toBeVisible();
  });

  test("síndico cria uma unidade na torre 99 e a desativa; a busca a mostra como desativada", async ({ page }) => {
    await entrar(page, 'roberto.faria', SENHA!);
    await expect(page).toHaveURL(/\/painel$/); // login concluído antes de navegar
    await page.goto('/unidades');
    await page.getByRole('button', { name: 'Nova unidade' }).click();
    const modal = page.getByRole('dialog', { name: 'Nova unidade' });
    await modal.getByLabel('Torre').fill('99');
    await modal.getByLabel('Apartamento').fill(NUMERO);
    await modal.getByRole('button', { name: 'Cadastrar unidade' }).click();
    await expect(page.getByRole('region', { name: 'Notificações' }).getByText(`Unidade ${CODIGO} cadastrada.`)).toBeVisible();
    await expect(page.getByRole('heading', { name: `Torre 99 · Apartamento ${NUMERO}` })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Torre' }).getByRole('radio', { name: '99' })).toBeVisible();

    // duplicata: a regra vem da API
    await page.getByRole('button', { name: 'Nova unidade' }).click();
    const dup = page.getByRole('dialog', { name: 'Nova unidade' });
    await dup.getByLabel('Torre').fill('99');
    await dup.getByLabel('Apartamento').fill(NUMERO);
    await dup.getByRole('button', { name: 'Cadastrar unidade' }).click();
    await expect(dup.getByRole('alert')).toContainText('Já existe a unidade');
    await dup.getByRole('button', { name: 'Cancelar' }).click();

    await page.getByRole('button', { name: 'Desativar unidade' }).click();
    await expect(page.getByRole('region', { name: 'Notificações' }).getByText(/desativada\. O histórico continua disponível/)).toBeVisible();
    await expect(page.getByText(/Unidade desativada: não aparece para nova entrada/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reativar unidade' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Unidades da torre 99' }).getByRole('button', { name: `Apartamento ${NUMERO} (desativada)` })).toBeVisible();

    await page.getByLabel('Buscar por nome, documento, unidade ou placa').fill(CODIGO);
    await expect(page.getByRole('listbox', { name: 'Resultados da busca' }).getByRole('option', { name: /Unidade \(desativada\)/ })).toBeVisible();
  });

  test('porteiro consulta unidades mas não vê as ações de edição', async ({ page }) => {
    await entrar(page, 'joao.lima', SENHA!);
    await expect(page).toHaveURL(/\/painel$/);
    await page.goto('/unidades/T4-32');
    await expect(page.getByRole('heading', { name: 'Torre 4 · Apartamento 32' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova unidade' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Desativar unidade' })).toHaveCount(0);
    expect((await page.request.post('/api/v1/unidades', { data: { torre: 99, numero: '1' } })).status()).toBe(403);
  });
});
