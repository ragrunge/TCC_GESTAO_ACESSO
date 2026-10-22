// E2E contra a API real (servidor de e2e sobre PGlite; banco semeado no início da spec): registro de acesso pela tela da portaria. Entrada por interfone, recusa do
// morador, exceção do porteiro, negado por restrição (gravado uma vez, com o código), lançamento retroativo com saída
// retroativa, "pessoas no condomínio" com saída, verificação de integridade e exportação de um evento.
// Visitantes novos com nome e CPF fictícios aleatórios, cadastrados pela API.
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
/** Dia de ontem em São Paulo (AAAA-MM-DD): o retroativo de ontem às 10:00 é sempre "antes de agora". */
const ontemSP = () => new Date(Date.now() - 3 * 3600_000 - 86_400_000).toISOString().slice(0, 10);

const toast = (page: Page, texto: string | RegExp) => page.getByRole('region', { name: 'Notificações' }).getByText(texto);

async function entrar(page: Page, login: string, senha: string, rota: RegExp) {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill(login);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(rota); // espera o cookie antes do próximo goto
}
async function escolherPessoa(page: Page, nome: string) {
  await page.getByRole('combobox', { name: /Buscar por nome/ }).fill(nome);
  await page.getByRole('option', { name: new RegExp(nome) }).first().click();
  await expect(page.getByRole('button', { name: 'Trocar', exact: true })).toBeVisible();
}
async function escolherUnidade(page: Page, bloco: string, apto: string) {
  await page.getByRole('radio', { name: bloco, exact: true }).click();
  await page.getByLabel('Ou digite o apartamento', { exact: false }).fill(apto);
  await expect(page.getByRole('button', { name: 'Alterar', exact: true })).toBeVisible();
}
const escolherMeio = (page: Page, meio: string) => page.getByRole('group', { name: 'Meio de autorização' }).getByText(meio, { exact: true }).click();
const escolherMorador = (page: Page, nome: string) => page.getByRole('radiogroup', { name: /Morador que autorizou/ }).getByText(nome, { exact: true }).click();
const confirmar = (page: Page) => page.getByRole('button', { name: /^Confirmar entrada/ });
const linhaHistorico = (page: Page, texto: string) => page.getByRole('table', { name: 'Eventos de acesso' }).getByRole('row', { name: /^Abrir evento/ }).filter({ hasText: texto });

const SENHA = SENHA_E2E;
const SUFIXO = Math.random().toString(36).slice(2, 7);
const V = { interfone: `Visita Ponta ${SUFIXO} Um`, excecao: `Visita Ponta ${SUFIXO} Dois`, restrita: `Visita Ponta ${SUFIXO} Tres`, retro: `Visita Ponta ${SUFIXO} Quatro` };

test.describe.serial('API real: registro de acesso na portaria', () => {
  test.beforeAll(async ({ request, playwright }) => {
    await resetarBanco(request); // banco semeado; os testes desta spec compartilham o estado (serial)
    // Cadastros pela API (administração): os quatro visitantes e a restrição do terceiro na D-32, a pedido da Ana
    const ctx = await playwright.request.newContext();
    try {
      expect((await ctx.post(`${API}/auth/login`, { data: { login: 'paula.nogueira', senha: SENHA } })).ok()).toBe(true);
      const ids: Record<string, string> = {};
      for (const nome of Object.values(V)) {
        const r = await ctx.post(`${API}/pessoas`, { data: { nome, documento: cpfAleatorio(), telefone: '11955550000', categoria: 'visitante' } });
        expect(r.status()).toBe(201);
        ids[nome] = (await r.json()).data.id;
      }
      const ana = (await (await ctx.post(`${API}/pessoas/busca`, { data: { q: 'Ana Ribeiro' } })).json()).data.pessoas[0];
      const t432 = (await (await ctx.get(`${API}/unidades/D-32`)).json()).data.unidade.id;
      const validaAte = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      const rest = await ctx.post(`${API}/restricoes`, { data: { pessoaId: ids[V.restrita], unidadeId: t432, motivo: 'Morador não autoriza visitas', validaAte, solicitadaPorPessoaId: ana.id } });
      expect(rest.status()).toBe(201);
      await ctx.post(`${API}/auth/logout`);
    } finally { await ctx.dispose(); }
  });

  test('porteiro: entrada por interfone aparece no painel (React Query) e em "Pessoas no condomínio"', async ({ page }) => {
    await entrar(page, 'joao.lima', SENHA!, /\/painel$/);
    await page.goto('/entrada');
    await escolherPessoa(page, V.interfone);
    await escolherUnidade(page, 'D', '32');
    await escolherMeio(page, 'Interfone');
    await escolherMorador(page, 'Ana Ribeiro');
    await confirmar(page).click();
    await expect(toast(page, 'Entrada registrada').first()).toBeVisible();
    await expect(page).toHaveURL(/\/painel$/);
    await expect(page.getByRole('table', { name: 'Últimas movimentações de acesso' }).getByText(V.interfone)).toBeVisible();
    await page.getByRole('link', { name: /Presentes agora/ }).first().click();
    const linha = page.getByRole('table', { name: 'Pessoas atualmente no condomínio' }).getByRole('row').filter({ hasText: V.interfone });
    await expect(linha).toHaveCount(1);
    await expect(linha).toContainText('Ana Ribeiro');
    // Já dentro: a segunda entrada é recusada pela API (409)
    await page.goto('/entrada');
    await escolherPessoa(page, V.interfone);
    await escolherUnidade(page, 'D', '32');
    await escolherMeio(page, 'Interfone');
    await escolherMorador(page, 'Ana Ribeiro');
    await confirmar(page).click();
    await expect(page.getByRole('alert').filter({ hasText: /já consta como dentro/ })).toBeVisible();
  });

  test('recusa do morador e exceção do porteiro', async ({ page }) => {
    await entrar(page, 'joao.lima', SENHA!, /\/painel$/);
    await page.goto('/entrada');
    await escolherPessoa(page, V.excecao);
    await escolherUnidade(page, 'D', '32');
    await escolherMeio(page, 'Interfone');
    await escolherMorador(page, 'Ana Ribeiro');
    await page.getByRole('button', { name: 'Morador recusou' }).click();
    await expect(toast(page, 'Recusa registrada')).toBeVisible();
    await expect(page.getByRole('combobox', { name: /Buscar por nome/ })).toBeVisible();

    await escolherPessoa(page, V.excecao);
    await escolherUnidade(page, 'D', '32');
    await escolherMeio(page, 'Exceção do porteiro');
    await page.getByLabel(/Justificativa \(obrigatória/).fill('Morador não atende o interfone');
    await confirmar(page).click();
    await expect(toast(page, 'Entrada registrada').first()).toBeVisible();
    await page.goto('/historico');
    await page.getByLabel('Pessoa', { exact: true }).fill(V.excecao);
    await expect(linhaHistorico(page, V.excecao)).toHaveCount(2); // recusa + entrada
    await page.getByLabel('Somente exceções').check();
    await expect(linhaHistorico(page, V.excecao)).toHaveCount(1);
    await expect(linhaHistorico(page, V.excecao)).toContainText('Exceção');
  });

  test('negado por restrição: o alerta aparece antes do registro e a tentativa vai para a trilha uma vez', async ({ page }) => {
    await entrar(page, 'joao.lima', SENHA!, /\/painel$/);
    await page.goto('/entrada');
    await escolherPessoa(page, V.restrita);
    await escolherUnidade(page, 'D', '32');
    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Entrada não permitida para D-32');
    await expect(modal).toContainText('Morador não autoriza visitas');
    await expect(modal.getByRole('button')).toHaveText([/Registrar ocorrência/, /Cancelar/]); // não há como liberar
    await modal.getByRole('button', { name: 'Cancelar' }).click();
    await expect(toast(page, /Entrada negada/)).toBeVisible();
    await expect(toast(page, /Tentativa gravada na trilha \(EV-\d{6}\)/)).toBeVisible();
    await page.goto('/historico');
    await page.getByLabel('Pessoa', { exact: true }).fill(V.restrita);
    await expect(linhaHistorico(page, V.restrita)).toHaveCount(1);
    await expect(linhaHistorico(page, V.restrita)).toContainText(/Negad/);
  });

  test('retroativo: entrada de ontem com formulário e saída retroativa em "Pessoas no condomínio"', async ({ page }) => {
    await entrar(page, 'joao.lima', SENHA!, /\/painel$/);
    await page.goto('/entrada?retroativo=1');
    await escolherPessoa(page, V.retro);
    await escolherUnidade(page, 'D', '32');
    await escolherMeio(page, 'Interfone');
    await escolherMorador(page, 'Ana Ribeiro');
    await page.getByLabel('Data real do acesso').fill(ontemSP());
    await page.getByLabel('Hora real do acesso').fill('10:00');
    await page.getByLabel(/Nº do formulário de papel/).fill(`F-${SUFIXO}`);
    await page.getByRole('button', { name: 'Confirmar lançamento' }).click();
    await expect(toast(page, 'Lançamento retroativo registrado')).toBeVisible();

    await page.goto('/pessoas');
    const linha = page.getByRole('table', { name: 'Pessoas atualmente no condomínio' }).getByRole('row').filter({ hasText: V.retro });
    await expect(linha).toHaveCount(1);
    await linha.getByRole('button', { name: 'Saída retroativa' }).click();
    const modal = page.getByRole('dialog', { name: new RegExp(`Saída retroativa · ${V.retro}`) });
    await modal.getByLabel('Data real da saída').fill(ontemSP());
    await modal.getByLabel('Hora real da saída').fill('11:30');
    await modal.getByLabel(/Nº do formulário de papel/).fill(`F-${SUFIXO}-S`);
    await page.getByRole('button', { name: 'Registrar saída retroativa' }).click();
    await expect(toast(page, new RegExp(`Saída retroativa de ${V.retro} registrada`))).toBeVisible();
    await expect(linha).toHaveCount(0);

    // A saída comum do visitante do interfone, pela mesma tela
    const outro = page.getByRole('table', { name: 'Pessoas atualmente no condomínio' }).getByRole('row').filter({ hasText: V.interfone });
    await outro.getByRole('button', { name: 'Registrar saída' }).click();
    await expect(toast(page, new RegExp(`Saída de ${V.interfone} registrada`))).toBeVisible();
    await expect(outro).toHaveCount(0);
  });

  test('auditor: verificação de integridade no banco real e exportação de um evento', async ({ page }) => {
    await entrar(page, 'luiza.campos', SENHA!, /\/historico$/);
    await page.getByRole('button', { name: 'Verificar integridade da trilha' }).click();
    await expect(page.getByRole('status').filter({ hasText: /Integridade verificada: \d+ registros/ })).toBeVisible({ timeout: 30_000 });

    await page.getByLabel('Pessoa', { exact: true }).fill(V.interfone);
    const linha = linhaHistorico(page, V.interfone).filter({ hasText: 'Ana Ribeiro' }).first();
    await linha.click();
    const gaveta = page.getByRole('dialog').last();
    await expect(gaveta.getByText('Integridade verificada')).toBeVisible();
    const hash = /sha256 ([0-9a-f]{64})/.exec(await gaveta.getByText(/sha256 [0-9a-f]{64}/).innerText())![1]!;
    const [download] = await Promise.all([page.waitForEvent('download'), gaveta.getByRole('button', { name: 'Exportar este evento' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^evento-EV-\d{6}-\d{8}-\d{4}\.jsonl$/);
    const conteudo = readFileSync(await download.path(), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(conteudo[0]).toMatchObject({ tipo: 'manifesto', versao: 2, modo: 'evento_isolado', quantidade: 1 });
    expect(conteudo[1]).toMatchObject({ tipo: 'evento', evento: { hash }, exibicao: { pessoa: V.interfone, unidade: 'D-32' } });
    expect(conteudo[2]).toMatchObject({ tipo: 'resumo', quantidade: 1, ultimoHash: hash });
  });
});
