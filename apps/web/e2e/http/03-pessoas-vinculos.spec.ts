// E2E contra a API real (Docker local): cadastro de pessoa, vínculo pendente, conferência do comprovante (RF-05),
// aprovação (RN-02), o morador na unidade e na busca do topo, e a regularização de um legado (RN-09) criado aqui mesmo
// pela importação da planilha (RF-11), para o teste não depender de um legado do seed que uma execução anterior já
// tenha regularizado. Cada execução cria pessoas novas (nome e CPF fictícios aleatórios): elas se acumulam no banco de
// dev; para limpar, docker compose down -v. A senha do seed vem de SEED_SENHA_DEV e nunca é impressa.
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

/** Entra e espera a rota inicial: sem isso o próximo goto sai antes do cookie e cai no /login. */
async function entrarAdmin(page: Page, senha: string) {
  await page.goto('/login');
  await page.getByLabel('Usuário').fill('paula.nogueira');
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/vinculos$/);
}

/** CPF fictício válido (dígitos verificadores corretos) a partir de 9 dígitos aleatórios. */
function cpfAleatorio(): string {
  const d = Array.from({ length: 9 }, (_, i) => (i === 0 ? 1 + Math.floor(Math.random() * 9) : Math.floor(Math.random() * 10)));
  const dv = (n: number[]) => { const s = n.reduce((a, x, i) => a + x * (n.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(d);
  return [...d, d1, dv([...d, d1])].join('');
}

const toast = (page: Page, texto: string | RegExp) => page.getByRole('region', { name: 'Notificações' }).getByText(texto);

async function registrarConferencia(page: Page, tipo: string, descricao?: string) {
  await page.getByLabel('Tipo do documento conferido').selectOption({ label: tipo });
  if (descricao) await page.getByLabel('Descrição do documento').fill(descricao);
  await page.getByLabel('Conferi o comprovante apresentado').check();
  await page.getByRole('button', { name: 'Registrar conferência' }).click();
}

const SENHA = senhaSeed();
const SUFIXO = Math.random().toString(36).slice(2, 7);
const NOME = `Teste Ponta ${SUFIXO}`;
const NOME_LEGADO = `Legado Ponta ${SUFIXO}`;
const UNIDADE = 'T1-11';

test.describe.serial('API real: pessoas, vínculos, conferência e legado', () => {
  test.beforeAll(async ({ request }) => {
    test.skip(!(await apiDePe(request)), 'API local fora do ar (docker compose up)');
    test.skip(!SENHA, 'SEED_SENHA_DEV ausente');
  });

  test('administração cadastra pessoa, pede o vínculo, registra a conferência e aprova', async ({ page }) => {
    await entrarAdmin(page, SENHA!);

    // 1) Cadastro: CPF válido e telefone; o CPF não volta em nenhuma resposta
    await page.goto('/cadastro');
    await page.getByRole('button', { name: 'Nova pessoa' }).click();
    const nova = page.getByRole('dialog', { name: 'Nova pessoa' });
    const cpf = cpfAleatorio();
    await nova.getByLabel('Nome completo').fill(NOME);
    await nova.getByLabel('CPF').fill(cpf);
    await nova.getByLabel('Telefone (obrigatório)').fill('(11) 98888-1234');
    const resposta = page.waitForResponse((r) => r.url().endsWith('/api/v1/pessoas') && r.request().method() === 'POST');
    await nova.getByRole('button', { name: 'Cadastrar' }).click();
    const corpo = await (await resposta).text();
    expect(corpo).not.toContain(cpf);
    expect(corpo).not.toContain('documentoBusca');
    await expect(toast(page, `${NOME} cadastrado(a).`)).toBeVisible();

    // CPF repetido: 409 da API vira mensagem no modal
    await page.getByRole('button', { name: 'Nova pessoa' }).click();
    const dup = page.getByRole('dialog', { name: 'Nova pessoa' });
    await dup.getByLabel('Nome completo').fill(`${NOME} B`);
    await dup.getByLabel('CPF').fill(cpf);
    await dup.getByLabel('Telefone (obrigatório)').fill('(11) 98888-4321');
    await dup.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(dup.getByRole('alert')).toContainText('Já existe cadastro com este CPF');
    await dup.getByRole('button', { name: 'Cancelar' }).click();

    // 2) Vínculo pendente na unidade
    await page.goto(`/unidades/${UNIDADE}`);
    await page.getByRole('button', { name: 'Solicitar vínculo' }).click();
    const modal = page.getByRole('dialog', { name: 'Solicitar vínculo' });
    await modal.getByLabel('Pessoa', { exact: true }).fill(NOME);
    await modal.getByRole('button', { name: new RegExp(NOME) }).click();
    await modal.getByRole('combobox', { name: 'Tipo de vínculo' }).selectOption({ label: 'Dependente' });
    await modal.getByRole('button', { name: 'Solicitar vínculo' }).click();
    await expect(toast(page, /Vínculo solicitado/)).toBeVisible();

    // 3) Fila: sem conferência, Aprovar fica desabilitado; com ela, aprova
    await page.goto('/vinculos');
    await page.getByRole('list', { name: 'Fila' }).getByRole('button', { name: new RegExp(NOME) }).click();
    await expect(page.getByRole('heading', { name: new RegExp(NOME) })).toBeVisible();
    const aprovar = page.getByRole('button', { name: 'Aprovar', exact: true });
    await expect(aprovar).toBeDisabled();
    await registrarConferencia(page, 'Outro', 'Certidão de nascimento');
    await expect(toast(page, new RegExp(`Conferência do comprovante de ${NOME} registrada`))).toBeVisible();
    await expect(aprovar).toBeEnabled();
    await aprovar.click();
    await expect(toast(page, new RegExp(`Vínculo de ${NOME} \\(${UNIDADE}\\) aprovado`))).toBeVisible();
    await expect(page.getByRole('list', { name: 'Fila' }).getByRole('button', { name: new RegExp(NOME) })).toHaveCount(0);
  });

  test('o morador aprovado aparece na unidade e na busca do topo', async ({ page }) => {
    await entrarAdmin(page, SENHA!);
    await page.goto(`/unidades/${UNIDADE}`);
    await expect(page.getByRole('heading', { name: 'Torre 1 · Apartamento 11' })).toBeVisible();
    await expect(page.getByText(NOME, { exact: true })).toBeVisible();

    await page.getByLabel('Buscar por nome, documento, unidade ou placa').fill(NOME);
    // A aprovação mudou a categoria da pessoa para morador
    await expect(page.getByRole('listbox', { name: 'Resultados da busca' }).getByRole('option', { name: new RegExp(`${NOME}.*Morador`) })).toBeVisible();
  });

  test('importação cria um legado; a conferência e a regularização o passam a aprovado', async ({ page }) => {
    await entrarAdmin(page, SENHA!);
    await page.goto('/importar');
    const csv = `nome;cpf;torre;unidade;tipo;telefone\n${NOME_LEGADO};${cpfAleatorio()};1;12;dependente;11977771234\n`;
    await page.getByLabel('Selecionar arquivo da planilha').setInputFiles({ name: 'planilha-e2e.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await expect(page.getByText(/1 linhas lidas · 1 válidas/)).toBeVisible();
    await page.getByRole('button', { name: /Importar 1 moradores válidos/ }).click();
    await expect(page.getByText(/1 moradores importados com status Legado/)).toBeVisible();

    await page.goto('/vinculos');
    await page.getByRole('tab', { name: /Legados/ }).click();
    const fila = page.getByRole('list', { name: 'Fila' });
    const item = fila.getByRole('button', { name: new RegExp(NOME_LEGADO) });
    // Legados vêm por prazo (vencidos primeiro): o recém-importado pode estar numa página seguinte
    for (let i = 0; i < 10 && !(await item.count()); i++) {
      const mais = fila.getByRole('button', { name: 'Carregar mais' });
      if (!(await mais.count())) break;
      await mais.click();
      await page.waitForTimeout(300);
    }
    await item.click();
    const regularizar = page.getByRole('button', { name: 'Regularizar', exact: true });
    await expect(regularizar).toBeDisabled();
    await registrarConferencia(page, 'Outro', 'Certidão de nascimento');
    await expect(regularizar).toBeEnabled();
    await regularizar.click();
    await expect(toast(page, new RegExp(`Vínculo legado de ${NOME_LEGADO} \\(T1-12\\) regularizado`))).toBeVisible();
    await expect(item).toHaveCount(0);
  });
});
