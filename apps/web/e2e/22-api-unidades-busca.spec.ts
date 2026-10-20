// E2E contra a API real (servidor de e2e sobre PGlite; banco semeado no início da spec): catálogo e badge no Layout, busca do topo por nome e por unidade, detalhe da
// unidade com moradores e veículos da API e as demais seções "em breve", e o CRUD de unidade (criar e desativar).
// Depende do seed de dev com as pessoas fictícias, que o servidor de e2e carrega.
// Unidade de teste: bloco Z, número aleatório, desativada no fim.
import { expect, test, type Page } from '@playwright/test';
import { SENHA_E2E, resetarBanco } from './helpers';


async function entrar(page: Page, login: string, senha: string) {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill(login);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

const SENHA = SENHA_E2E;
const NUMERO = String(1000 + Math.floor(Math.random() * 9000));
const CODIGO = `Z-${NUMERO}`;

test.describe.serial('API real: catálogo, badge, busca e unidades', () => {
  test.beforeAll(async ({ request }) => {
    await resetarBanco(request); // banco semeado; os testes desta spec compartilham o estado (serial)
  });

  test('administração vê o catálogo na grade de unidades e o badge de vínculos pendentes', async ({ page }) => {
    await entrar(page, 'paula.nogueira', SENHA!);
    await expect(page).toHaveURL(/\/vinculos$/); // rota inicial da administração
    // Badge: o número vem da API (mesma sessão do navegador)
    const r = await page.request.get('/api/v1/vinculos/contagem?status=pendente');
    expect(r.status()).toBe(200);
    const total = ((await r.json()) as { data: { total: number } }).data.total;
    expect(total).toBeGreaterThan(0); // seed: 3 pendentes
    await expect(page.getByRole('link', { name: /Vínculos pendentes/ }).getByLabel(`${total} pendentes`)).toBeVisible();

    await page.getByRole('link', { name: 'Unidades', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Bloco D · Apartamento 32' })).toBeVisible();
    const blocos = page.getByRole('radiogroup', { name: 'Bloco' });
    for (const b of ['A', 'E', 'I']) await expect(blocos.getByRole('radio', { name: b, exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Unidades do bloco D' }).getByRole('button', { name: 'Apartamento 32' })).toBeVisible();
  });

  test('busca do topo por nome abre a ficha; por unidade leva ao detalhe com todas as seções vindas da API', async ({ page }) => {
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
    await busca.fill('D-32');
    const opcao = resultados.getByRole('option', { name: /D-32.*Unidade/ });
    await expect(opcao).toBeVisible();
    await expect(resultados.getByRole('option', { name: /Ana Ribeiro/ })).toBeVisible(); // moradores da unidade
    await opcao.click();
    await expect(page).toHaveURL(/\/unidades\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: 'Bloco D · Apartamento 32' })).toBeVisible();
    await expect(page.getByText('FKR-2C41')).toBeVisible(); // veículos vêm da API (exibidos com hífen)
    await expect(page.getByText('Ana Ribeiro', { exact: true }).first()).toBeVisible(); // moradores (vínculos) vêm da API
    // Autorizações, restrições e acessos já têm API (lote de registro de acesso): nenhuma seção "em breve"
    await expect(page.getByRole('note', { name: /disponível em breve/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Solicitar vínculo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova restrição' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova autorização prévia' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Desativar unidade' })).toBeVisible();
  });

  test("síndico cria uma unidade no bloco Z e a desativa; a busca a mostra como desativada", async ({ page }) => {
    await entrar(page, 'roberto.faria', SENHA!);
    await expect(page).toHaveURL(/\/painel$/); // login concluído antes de navegar
    await page.goto('/unidades');
    await page.getByRole('button', { name: 'Nova unidade' }).click();
    const modal = page.getByRole('dialog', { name: 'Nova unidade' });
    await modal.getByLabel('Bloco').fill('Z');
    await modal.getByLabel('Apartamento').fill(NUMERO);
    await modal.getByRole('button', { name: 'Cadastrar unidade' }).click();
    await expect(page.getByRole('region', { name: 'Notificações' }).getByText(`Unidade ${CODIGO} cadastrada.`)).toBeVisible();
    await expect(page.getByRole('heading', { name: `Bloco Z · Apartamento ${NUMERO}` })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Bloco' }).getByRole('radio', { name: 'Z', exact: true })).toBeVisible();

    // duplicata: a regra vem da API
    await page.getByRole('button', { name: 'Nova unidade' }).click();
    const dup = page.getByRole('dialog', { name: 'Nova unidade' });
    await dup.getByLabel('Bloco').fill('z');
    await dup.getByLabel('Apartamento').fill(NUMERO);
    await dup.getByRole('button', { name: 'Cadastrar unidade' }).click();
    await expect(dup.getByRole('alert')).toContainText('Já existe a unidade');
    await dup.getByRole('button', { name: 'Cancelar' }).click();

    await page.getByRole('button', { name: 'Desativar unidade' }).click();
    await expect(page.getByRole('region', { name: 'Notificações' }).getByText(/desativada\. O histórico continua disponível/)).toBeVisible();
    await expect(page.getByText(/Unidade desativada: não aparece para nova entrada/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reativar unidade' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Unidades do bloco Z' }).getByRole('button', { name: `Apartamento ${NUMERO} (desativada)` })).toBeVisible();

    await page.getByLabel('Buscar por nome, documento, unidade ou placa').fill(CODIGO);
    await expect(page.getByRole('listbox', { name: 'Resultados da busca' }).getByRole('option', { name: /Unidade \(desativada\)/ })).toBeVisible();
  });

  test('porteiro consulta unidades mas não vê as ações de edição', async ({ page }) => {
    await entrar(page, 'joao.lima', SENHA!);
    await expect(page).toHaveURL(/\/painel$/);
    await page.goto('/unidades/D-32');
    await expect(page.getByRole('heading', { name: 'Bloco D · Apartamento 32' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova unidade' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Desativar unidade' })).toHaveCount(0);
    expect((await page.request.post('/api/v1/unidades', { data: { bloco: 'Z', numero: '01' } })).status()).toBe(403);
  });
});
