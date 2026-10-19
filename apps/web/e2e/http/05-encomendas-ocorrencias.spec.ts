// E2E contra a API real (Docker local): encomendas e ocorrências pela tela. Receber (com a conferência da unidade) e
// entregar a um dependente, com a fila e o painel atualizados; autorizar um terceiro a retirar e entregar a ele; abrir
// ocorrência a partir de um negado (link "Registrar ocorrência" do alerta de restrição), com anexo cifrado, andar o
// status até encerrada; e o síndico baixar o anexo (o conteúdo volta idêntico).
// Cada execução cadastra pessoas novas (nome e CPF fictícios aleatórios), uma restrição, encomendas e uma ocorrência;
// tudo se acumula no banco de dev (as trilhas são append-only); para limpar, docker compose down -v.
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
function cpfAleatorio(): string {
  const d = Array.from({ length: 9 }, (_, i) => (i === 0 ? 1 + Math.floor(Math.random() * 9) : Math.floor(Math.random() * 10)));
  const dv = (n: number[]) => { const s = n.reduce((a, x, i) => a + x * (n.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(d);
  return [...d, d1, dv([...d, d1])].join('');
}
const toast = (page: Page, texto: string | RegExp) => page.getByRole('region', { name: 'Notificações' }).getByText(texto);

async function entrar(page: Page, login: string, senha: string, rota: RegExp) {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill(login);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(rota); // espera o cookie antes do próximo goto
}

const SENHA = senhaSeed();
const SUFIXO = Math.random().toString(36).slice(2, 7);
const P = { restrita: `Visita Encomenda ${SUFIXO} Restrita`, terceiro: `Visita Encomenda ${SUFIXO} Terceiro` };
const RASTREIO = { dependente: `E2E${SUFIXO}DEP`.toUpperCase(), terceiro: `E2E${SUFIXO}TER`.toUpperCase() };
// PNG pelo conteúdo (a API decide o tipo pelos primeiros bytes), com um marcador para conferir o download
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`anexo e2e ${SUFIXO} `.repeat(40))]);
let codigoOcorrencia = '';

/** Receber pela tela: torre, apartamento, destinatário, transportadora, rastreio e a conferência da unidade. Devolve o código. */
async function receber(page: Page, rastreio: string): Promise<string> {
  await page.goto('/encomendas');
  await expect(page.getByRole('heading', { name: 'Encomendas', level: 1 })).toBeVisible();
  await page.keyboard.press('F3'); // RNF-07: atalho do recebimento
  const modal = page.getByRole('dialog', { name: 'Receber encomenda' });
  await modal.getByRole('radio', { name: '4', exact: true }).click();
  await modal.getByRole('button', { name: 'Apartamento 32', exact: true }).click();
  await modal.getByLabel('Destinatário', { exact: true }).fill('Ana Ribeiro');
  await modal.getByRole('radio', { name: 'Correios' }).click();
  await modal.getByLabel('Código de rastreio').fill(rastreio);
  await modal.getByRole('button', { name: /Continuar/ }).click();
  // RF-23: conferência da unidade em destaque antes de gravar
  await expect(page.getByRole('dialog', { name: 'Conferir a unidade de destino' })).toContainText('TORRE 4 · AP 32?');
  await page.keyboard.press('Enter');
  const t = toast(page, /Encomenda K\d+ registrada para T4-32/);
  await expect(t).toBeVisible();
  return /Encomenda (K\d+)/.exec((await t.textContent()) ?? '')![1]!;
}

test.describe.serial('API real: encomendas e ocorrências', () => {
  test.beforeAll(async ({ request, playwright }) => {
    test.skip(!(await apiDePe(request)), 'API local fora do ar (docker compose up)');
    test.skip(!SENHA, 'SEED_SENHA_DEV ausente');
    // Administração: a pessoa com restrição na T4-32 (a pedido da Ana) e o terceiro que vai retirar uma encomenda
    const ctx = await playwright.request.newContext();
    try {
      expect((await ctx.post(`${API}/auth/login`, { data: { login: 'paula.nogueira', senha: SENHA } })).ok()).toBe(true);
      const ids: Record<string, string> = {};
      for (const nome of Object.values(P)) {
        const r = await ctx.post(`${API}/pessoas`, { data: { nome, documento: cpfAleatorio(), telefone: '11955550000', categoria: 'visitante' } });
        expect(r.status()).toBe(201);
        ids[nome] = (await r.json()).data.id;
      }
      const ana = (await (await ctx.post(`${API}/pessoas/busca`, { data: { q: 'Ana Ribeiro' } })).json()).data.pessoas[0];
      const t432 = (await (await ctx.get(`${API}/unidades/T4-32`)).json()).data.unidade.id;
      const validaAte = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      const rest = await ctx.post(`${API}/restricoes`, { data: { pessoaId: ids[P.restrita], unidadeId: t432, motivo: 'Morador não autoriza visitas', validaAte, solicitadaPorPessoaId: ana.id } });
      expect(rest.status()).toBe(201);
      await ctx.post(`${API}/auth/logout`);
    } finally { await ctx.dispose(); }
  });

  test('receber e entregar a um dependente: some da fila, aparece em entregues e o painel acompanha', async ({ page }) => {
    await entrar(page, 'joao.lima', SENHA!, /\/painel$/);
    const codigo = await receber(page, RASTREIO.dependente);
    const linha = page.getByRole('row').filter({ hasText: RASTREIO.dependente });
    await expect(linha).toHaveCount(1);
    await linha.getByRole('button', { name: `Entregar encomenda ${codigo}` }).click();
    const modal = page.getByRole('dialog', { name: `Entregar encomenda ${codigo}` });
    await modal.getByLabel('Quem está retirando?').fill('Paulo Ribeiro');
    await modal.getByRole('button', { name: /Paulo Ribeiro/ }).click();
    await expect(modal.getByText(/Vínculo válido com a T4-32/)).toBeVisible();
    await modal.getByRole('button', { name: /Confirmar entrega/ }).click();
    await expect(toast(page, `Encomenda ${codigo} entregue a Paulo Ribeiro.`)).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: RASTREIO.dependente })).toHaveCount(0); // a fila foi invalidada
    await page.getByRole('tab', { name: /Entregues/ }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Paulo Ribeiro (dependente)' }).first()).toBeVisible();

    // Painel: o cartão mostra o mesmo total que a API
    const resumo = (await (await page.request.get('/api/v1/encomendas/resumo')).json()).data;
    await page.goto('/painel');
    await expect(page.getByRole('link', { name: /Encomendas aguardando/ })).toContainText(String(resumo.aguardando));
  });

  test('autorizar um terceiro (a pedido da moradora) e entregar a ele', async ({ page }) => {
    await entrar(page, 'joao.lima', SENHA!, /\/painel$/);
    const codigo = await receber(page, RASTREIO.terceiro);
    await page.getByRole('button', { name: `Autorizar retirada da encomenda ${codigo}` }).click();
    const modal = page.getByRole('dialog', { name: `Autorizar retirada da encomenda ${codigo}` });
    await modal.getByLabel(/Morador que autoriza/).selectOption({ label: 'Ana Ribeiro (Proprietário)' });
    await modal.getByLabel('Quem vai retirar (cadastro com CPF)').fill(P.terceiro);
    await modal.getByRole('button', { name: new RegExp(P.terceiro) }).click();
    await modal.getByRole('button', { name: 'Autorizar retirada' }).click();
    await expect(toast(page, `${P.terceiro} autorizado(a) a retirar a encomenda ${codigo}.`)).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: RASTREIO.terceiro })).toContainText(`Autorizado: ${P.terceiro}`);

    await page.getByRole('button', { name: `Entregar encomenda ${codigo}` }).click();
    const entregar = page.getByRole('dialog', { name: `Entregar encomenda ${codigo}` });
    await entregar.getByLabel('Quem está retirando?').fill(P.terceiro);
    await entregar.getByRole('button', { name: new RegExp(P.terceiro) }).click();
    await expect(entregar.getByText(/Autorizado\(a\) a retirar por Ana Ribeiro/)).toBeVisible();
    await entregar.getByRole('button', { name: /Confirmar entrega/ }).click();
    await expect(toast(page, `Encomenda ${codigo} entregue a ${P.terceiro}.`)).toBeVisible();
    await page.getByRole('tab', { name: /Entregues/ }).click();
    await expect(page.getByText(`${P.terceiro} (autorizado por Ana Ribeiro)`)).toBeVisible();
  });

  test('ocorrência a partir de um negado: evento vinculado, anexo cifrado e status até encerrada', async ({ page }) => {
    await entrar(page, 'joao.lima', SENHA!, /\/painel$/);
    await page.goto('/entrada');
    await page.getByRole('combobox', { name: /Buscar por nome/ }).fill(P.restrita);
    await page.getByRole('option', { name: new RegExp(P.restrita) }).first().click();
    await page.getByRole('radio', { name: '4', exact: true }).click();
    await page.getByLabel('Ou digite o apartamento', { exact: false }).fill('32');
    const alerta = page.getByRole('alertdialog');
    await expect(alerta).toContainText('Entrada não permitida');
    await alerta.getByRole('button', { name: /Registrar ocorrência/ }).click();

    // Formulário já preenchido pelo link: tipo, unidade, envolvido e o evento negado
    await expect(page).toHaveURL(/\/ocorrencias/);
    const modal = page.getByRole('dialog', { name: 'Nova ocorrência' });
    await expect(modal.getByRole('radio', { name: 'Tentativa de acesso indevido' })).toHaveAttribute('aria-checked', 'true');
    await expect(modal.getByLabel('Unidade')).toHaveValue('T4-32');
    await expect(modal.getByLabel('Envolvidos')).toHaveValue(P.restrita);
    await expect(modal.getByText('Eventos de acesso vinculados (1)')).toBeVisible();
    await modal.getByLabel('Descrição').fill('Tentou entrar com restrição ativa; morador não autoriza visitas.');
    await modal.getByLabel('Anexos').setInputFiles({ name: 'foto-da-portaria.png', mimeType: 'image/png', buffer: PNG });
    await modal.getByRole('button', { name: 'Registrar ocorrência' }).click();
    const t = toast(page, /Ocorrência OC-\d{4}-\d+ registrada\./);
    await expect(t).toBeVisible();
    codigoOcorrencia = /(OC-\d{4}-\d+)/.exec((await t.textContent()) ?? '')![1]!;

    await page.getByRole('row', { name: `Abrir ocorrência ${codigoOcorrencia}` }).click();
    let det = page.getByRole('dialog');
    await expect(det).toContainText(P.restrita);
    await expect(det.getByText(/Negad/)).toBeVisible(); // o evento negado vinculado
    await expect(det.getByRole('list', { name: 'Anexos da ocorrência' })).toContainText(/anexo-[0-9a-f]{8}\.png/);
    await expect(det.getByRole('button', { name: /^Baixar/ })).toHaveCount(0); // o porteiro não abre o conteúdo
    await expect(det).not.toContainText('foto-da-portaria'); // o nome original não é guardado

    await det.getByRole('button', { name: 'Marcar em andamento' }).click();
    await expect(toast(page, `${codigoOcorrencia} agora está “Em andamento”.`)).toBeVisible();
    det = page.getByRole('dialog');
    await det.getByRole('button', { name: 'Encerrar ocorrência' }).click();
    await expect(toast(page, `${codigoOcorrencia} agora está “Encerrada”.`)).toBeVisible();
    det = page.getByRole('dialog');
    await expect(det.getByText('Mudanças de status')).toBeVisible();
    await expect(det.getByRole('button', { name: /Marcar em andamento|Encerrar ocorrência|Vincular eventos/ })).toHaveCount(0);
    await expect(det.getByLabel('Adicionar anexo')).toHaveCount(0); // encerrada é final
  });

  test('o síndico baixa o anexo: o conteúdo decifrado é idêntico ao enviado', async ({ page }) => {
    test.skip(!codigoOcorrencia, 'depende da ocorrência do teste anterior');
    await entrar(page, 'roberto.faria', SENHA!, /\/painel$/);
    await page.goto('/ocorrencias');
    await page.getByRole('tab', { name: 'Encerradas' }).click();
    await page.getByRole('row', { name: `Abrir ocorrência ${codigoOcorrencia}` }).click();
    const det = page.getByRole('dialog');
    const espera = page.waitForEvent('download');
    await det.getByRole('button', { name: /^Baixar anexo-[0-9a-f]{8}\.png$/ }).click();
    const download = await espera;
    expect(download.suggestedFilename()).toMatch(/^anexo-[0-9a-f]{8}\.png$/);
    const caminho = await download.path();
    expect(Buffer.compare(readFileSync(caminho!), PNG)).toBe(0);
  });
});
