// E2E contra a API real (PGlite): tempo de permanência com prazo por tipo de visita (spec §14 2026-10-23). Entrada de um
// visitante como "Entregador" (prazo de 30 min), coluna Permanência em "Presentes agora" e prorrogação "+1h" com
// confirmação. Visitante novo com nome e CPF fictícios aleatórios, cadastrado pela API.
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
const NOME = `Entregador Prazo ${Math.random().toString(36).slice(2, 7)} Um`;

test.describe.serial('API real: prazo de permanência na portaria', () => {
  test.beforeAll(async ({ request, playwright }) => {
    await resetarBanco(request);
    const ctx = await playwright.request.newContext();
    try {
      expect((await ctx.post(`${API}/auth/login`, { data: { login: 'paula.nogueira', senha: SENHA_E2E } })).ok()).toBe(true);
      const r = await ctx.post(`${API}/pessoas`, { data: { nome: NOME, documento: cpfAleatorio(), telefone: '11955550000', categoria: 'visitante' } });
      expect(r.status()).toBe(201);
      await ctx.post(`${API}/auth/logout`);
    } finally { await ctx.dispose(); }
  });

  test('porteiro: entrada como Entregador (30 min); Presentes agora mostra o prazo; "+1h" prorroga com confirmação', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Usuário').fill('joao.lima');
    await page.getByLabel('Senha').fill(SENHA_E2E!);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/painel$/);

    await page.goto('/entrada');
    await page.getByRole('combobox', { name: /Buscar por nome/ }).fill(NOME);
    await page.getByRole('option', { name: new RegExp(NOME) }).first().click();
    await page.getByRole('radio', { name: 'D', exact: true }).click();
    await page.getByLabel('Ou digite o apartamento', { exact: false }).fill('32');
    await expect(page.getByRole('button', { name: 'Alterar', exact: true })).toBeVisible();
    // Tipo de visita: rádios nativos; o padrão é Visita e as setas trocam a opção
    const tipos = page.getByRole('group', { name: /Tipo de visita/ });
    await expect(tipos.getByRole('radio', { name: /Visita/ })).toBeChecked();
    await tipos.getByRole('radio', { name: /Visita/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tipos.getByRole('radio', { name: /Entregador/ })).toBeChecked();
    await page.getByRole('group', { name: 'Meio de autorização' }).getByText('Interfone', { exact: true }).click();
    await page.getByRole('radiogroup', { name: /Morador que autorizou/ }).getByText('Ana Ribeiro', { exact: true }).click();
    await page.getByRole('button', { name: /^Confirmar entrada/ }).click();
    await expect(toast(page, 'Entrada registrada').first()).toBeVisible();

    await page.goto('/pessoas');
    const linha = page.getByRole('table', { name: 'Pessoas atualmente no condomínio' }).getByRole('row').filter({ hasText: NOME });
    await expect(linha).toContainText('Entregador');
    await expect(linha).toContainText(/Até \d{2}:\d{2}/);
    await linha.getByRole('button', { name: /Prorrogar a permanência/ }).click();
    const modal = page.getByRole('dialog', { name: /Prorrogar permanência/ });
    await expect(modal).toContainText('Novo prazo');
    await modal.getByRole('button', { name: 'Prorrogar +1h' }).click();
    await expect(toast(page, /prorrogada até/).first()).toBeVisible();
    await expect(linha).toContainText('prorrogado 1×');
  });
});
