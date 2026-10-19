import { expect, test, diaSP, entrarComo, toast } from './helpers';

// Seed do e2e (apps/api/test/e2e/dados.ts): 001 encerrada, 002 aberta pelo Sérgio Matos, 003 aberta pelo João Lima.
// O código leva o ano da abertura (hoje, em São Paulo).
const ANO = diaSP().slice(0, 4);
const OC = (n: number) => `OC-${ANO}-${String(n).padStart(3, '0')}`;

const abrir = (page: import('@playwright/test').Page, codigo: string) =>
  page.getByRole('table', { name: 'Ocorrências registradas' }).getByRole('row', { name: `Abrir ocorrência ${codigo}` }).click();

test.describe('8. Ocorrência', () => {
  test.beforeEach(async ({ page }) => {
    await entrarComo(page, 'Porteiro'); // João Lima
    await page.goto('/ocorrencias');
  });

  test('porteiro não consegue alterar ocorrência aberta por outro', async ({ page }) => {
    // A 002 foi aberta por Sérgio Matos e está "aberta"
    await abrir(page, OC(2));
    const modal = page.getByRole('dialog');
    await expect(modal).toContainText('Sérgio Matos');
    await expect(modal.getByRole('button', { name: 'Marcar em andamento' })).toHaveCount(0);
    await expect(modal.getByRole('button', { name: 'Encerrar ocorrência' })).toHaveCount(0);
    await expect(modal.getByRole('button', { name: 'Fechar' })).toBeVisible();
  });

  test('fluxo aberta → em andamento → encerrada; encerrada não muda', async ({ page }) => {
    // A 003 foi aberta pelo próprio João Lima
    await abrir(page, OC(3));
    let modal = page.getByRole('dialog');
    await expect(modal).toContainText('Aberta');
    // Não pula etapa: ainda não há "Encerrar" na ocorrência aberta
    await expect(modal.getByRole('button', { name: 'Encerrar ocorrência' })).toHaveCount(0);

    await modal.getByRole('button', { name: 'Marcar em andamento' }).click();
    await expect(toast(page, `${OC(3)} agora está “Em andamento”`)).toBeVisible();
    modal = page.getByRole('dialog');
    await expect(modal).toContainText('Em andamento');
    await expect(modal.getByRole('button', { name: 'Marcar em andamento' })).toHaveCount(0);

    await modal.getByRole('button', { name: 'Encerrar ocorrência' }).click();
    await expect(toast(page, `${OC(3)} agora está “Encerrada”`)).toBeVisible();
    modal = page.getByRole('dialog');
    await expect(modal).toContainText('Encerrada');
    await expect(modal.getByText('Mudanças de status')).toBeVisible();
    // Encerrada é final: nenhuma ação de status
    await expect(modal.getByRole('button', { name: 'Marcar em andamento' })).toHaveCount(0);
    await expect(modal.getByRole('button', { name: 'Encerrar ocorrência' })).toHaveCount(0);

    // Reabrindo depois de recarregar, continua encerrada e sem ações
    await modal.getByRole('button', { name: 'Fechar' }).click();
    await page.reload();
    await abrir(page, OC(3));
    modal = page.getByRole('dialog');
    await expect(modal).toContainText('Encerrada');
    await expect(modal.getByRole('button', { name: /Marcar em andamento|Encerrar ocorrência/ })).toHaveCount(0);
  });

  test('ocorrência já encerrada no seed (001) não oferece ações', async ({ page }) => {
    await abrir(page, OC(1));
    const modal = page.getByRole('dialog');
    await expect(modal).toContainText('Encerrada');
    await expect(modal.getByRole('button', { name: /Marcar em andamento|Encerrar ocorrência/ })).toHaveCount(0);
  });
});
