// E2E contra a API real (servidor de e2e sobre PGlite; banco semeado no início da spec): LGPD e selo da cadeia pela tela. A administração cadastra (por API) um visitante
// com CPF fictício aleatório; o síndico abre a ficha dele pela busca, exporta os dados do titular (o JSON não traz o
// HMAC do CPF nem o telefone completo), anonimiza com a confirmação dupla e vê o que fica retido; aplica a retenção na
// seção de Usuários e vê a última execução; no Histórico, sela a cadeia e vê o último selo e o status da âncora.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { API_E2E, SENHA_E2E, resetarBanco } from './helpers';

const API = `${API_E2E}/api/v1`;

function cpfAleatorio(): string {
  const d = Array.from({ length: 9 }, (_, i) => (i === 0 ? 1 + Math.floor(Math.random() * 9) : Math.floor(Math.random() * 10)));
  const dv = (n: number[]) => { const s = n.reduce((a, x, i) => a + x * (n.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(d);
  return [...d, d1, dv([...d, d1])].join('');
}
const toast = (page: Page, texto: string | RegExp) => page.getByRole('region', { name: 'Notificações' }).getByText(texto);

async function entrar(page: Page, login: string, senha: string) {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill(login);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/); // espera o cookie antes do próximo goto
}

const SENHA = SENHA_E2E;
const SUFIXO = Math.random().toString(36).slice(2, 7);
const NOME = `Titular Lgpd ${SUFIXO}`;
const CPF = cpfAleatorio();
const TELEFONE = '11955557777';

test.describe.serial('API real: LGPD e selo da cadeia', () => {
  test.beforeAll(async ({ request, playwright }) => {
    await resetarBanco(request); // banco semeado; os testes desta spec compartilham o estado (serial)
    const ctx = await playwright.request.newContext();
    try {
      expect((await ctx.post(`${API}/auth/login`, { data: { login: 'paula.nogueira', senha: SENHA } })).ok()).toBe(true);
      const r = await ctx.post(`${API}/pessoas`, { data: { nome: NOME, documento: CPF, telefone: TELEFONE, categoria: 'visitante' } });
      expect(r.status()).toBe(201);
    } finally { await ctx.dispose(); }
  });

  test('síndico exporta os dados do titular sem HMAC nem telefone completo e anonimiza com confirmação dupla', async ({ page }) => {
    await entrar(page, 'roberto.faria', SENHA!);
    await page.getByLabel('Buscar por nome, documento, unidade ou placa').fill(NOME);
    await page.getByRole('listbox', { name: 'Resultados da busca' }).getByRole('option', { name: new RegExp(NOME) }).first().click();
    const ficha = page.getByRole('dialog', { name: 'Ficha da pessoa' });
    await expect(ficha.getByText(NOME, { exact: true })).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), ficha.getByRole('button', { name: 'Exportar dados (LGPD)' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^lgpd-.*\.json$/);
    const texto = readFileSync((await download.path())!, 'utf8');
    const json = JSON.parse(texto);
    expect(json.tipo).toBe('gestao-acesso/lgpd-exportacao');
    expect(json.titular.nome).toBe(NOME);
    expect(json.titular.cpf).toMatch(/^\d{3}\.\d{2}\*\.\*\*\*-\*\*$/); // cadastro novo: máscara com os 5 primeiros
    expect(texto).not.toContain(CPF);
    expect(texto).not.toContain(TELEFONE);
    expect(texto).not.toMatch(/documentoBusca|documento_busca/);
    expect(texto).not.toMatch(/[0-9a-f]{64}/); // nenhum HMAC (nem hash) no arquivo do titular
    await expect(toast(page, /Dados exportados/)).toBeVisible();

    await ficha.getByRole('button', { name: 'Anonimizar…' }).click();
    await expect(ficha.getByText(/Não há como desfazer/)).toBeVisible();
    await ficha.getByRole('button', { name: 'Confirmar anonimização' }).click();
    await expect(toast(page, /Pessoa anonimizada/)).toBeVisible();
    await expect(ficha.getByText('Pessoa anonimizada', { exact: true })).toBeVisible();
    await expect(ficha.getByText('O que fica retido')).toBeVisible();
    await expect(ficha.getByText(/evento de acesso desta pessoa fica retido|evento\(s\) de acesso ficam retidos/)).toBeVisible();
    await ficha.getByRole('button', { name: 'Fechar' }).click();

    // A pessoa anonimizada some da busca
    await page.getByLabel('Buscar por nome, documento, unidade ou placa').fill(NOME);
    await expect(page.getByRole('listbox', { name: 'Resultados da busca' }).getByRole('option', { name: new RegExp(NOME) })).toHaveCount(0);

    // Privacidade (LGPD) → Pedidos do titular: a exportação e a anonimização aparecem, sem o nome da pessoa
    await page.goto('/privacidade');
    const anon = page.getByRole('table', { name: 'Anonimizações feitas' }).getByRole('row');
    // Outros testes da suíte também anonimizam: basta haver registros
    await expect(anon.filter({ hasText: 'Motivo:' }).first()).toBeVisible();
    await expect(page.getByRole('table', { name: 'Anonimizações feitas' })).not.toContainText(NOME);
    await page.getByRole('radio', { name: 'Exportações' }).click();
    await expect(page.getByRole('table', { name: 'Exportações feitas' }).getByRole('row').filter({ hasText: 'Entregue:' }).first()).toBeVisible();
  });

  test('síndico aplica a retenção em Privacidade (LGPD) e vê a última execução', async ({ page }) => {
    await entrar(page, 'roberto.faria', SENHA!);
    await page.goto('/privacidade?aba=retencao');
    const secao = page.getByRole('region', { name: 'Retenção (LGPD)' });
    await expect(secao).toBeVisible();
    await secao.getByRole('button', { name: 'Aplicar retenção agora' }).click();
    await secao.getByRole('button', { name: 'Confirmar retenção' }).click();
    await expect(toast(page, /Retenção aplicada/)).toBeVisible();
    await expect(secao.getByText(/Última execução: .*, por Roberto Faria\./)).toBeVisible();
    await expect(secao.getByText('Anexos de ocorrência', { exact: true })).toBeVisible();
    await secao.getByText(/Ver os \d+ itens sem alteração/).click();
    await expect(secao.getByText('Entradas e saídas com mais de 3 anos apagadas')).toBeVisible();
  });

  test('síndico sela a cadeia no Histórico e vê o último selo e o status da âncora', async ({ page }) => {
    await entrar(page, 'roberto.faria', SENHA!);
    await page.goto('/historico');
    const painel = page.getByRole('region', { name: 'Selo e âncora externa' });
    await expect(painel).toBeVisible();
    await painel.getByRole('button', { name: 'Selar agora' }).click();
    await expect(toast(page, /Cadeia selada|Nada novo para selar/)).toBeVisible();
    const ultimo = painel.getByRole('status', { name: 'Último selo' });
    await expect(ultimo.getByText(/Último selo: .* seq \d+/)).toBeVisible();
    await expect(ultimo.getByText(/Âncora enviada para|Envio da âncora pendente|Sem destino configurado/)).toBeVisible();
  });
});
