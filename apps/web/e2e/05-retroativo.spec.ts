import { expect, test } from '@playwright/test';
import { entrarComo, escolherMeio, escolherMorador, escolherPessoa, escolherUnidade, filtrarHistoricoPorPessoa, linhaEvento, toast } from './helpers';

test.describe('5. Lançamento retroativo (contingência em papel)', () => {
  test.beforeEach(async ({ page }) => {
    await entrarComo(page, 'Porteiro');
  });

  test('entrada retroativa: sem nº do formulário não habilita; com formulário grava "Retroativo"', async ({ page }) => {
    await page.goto('/entrada?retroativo=1');
    await expect(page.getByRole('heading', { name: 'Lançar registro retroativo' })).toBeVisible();

    await escolherPessoa(page, 'Márcia Pereira');
    await escolherUnidade(page, 'D-32');
    await escolherMeio(page, 'Interfone');
    await escolherMorador(page, 'Ana Ribeiro');

    const confirmar = page.getByRole('button', { name: 'Confirmar lançamento' });
    // Falta hora real e formulário
    await expect(confirmar).toBeDisabled();
    await page.getByLabel('Hora real do acesso').fill('10:15');
    await expect(confirmar).toBeDisabled(); // ainda falta o formulário
    await expect(page.getByText(/Falta:.*formulário de papel/)).toBeVisible();

    await page.getByLabel(/Nº do formulário de papel/).fill('0123');
    await expect(confirmar).toBeEnabled();
    await confirmar.click();

    await expect(toast(page, 'Lançamento retroativo registrado')).toBeVisible();

    await filtrarHistoricoPorPessoa(page, 'Márcia Pereira');
    const linha = linhaEvento(page, 'Márcia Pereira');
    await expect(linha).toHaveCount(1);
    await expect(linha).toContainText('Retroativo');
    await expect(linha).toContainText('Hora real 10:15');
    // Filtro "Somente retroativos" também encontra
    await page.getByLabel('Somente retroativos').check();
    await expect(linhaEvento(page, 'Márcia Pereira')).toHaveCount(1);
  });

  test('hora real no futuro não é aceita', async ({ page }) => {
    await page.goto('/entrada?retroativo=1');
    await escolherPessoa(page, 'Márcia Pereira');
    await escolherUnidade(page, 'D-32');
    await escolherMeio(page, 'Interfone');
    await escolherMorador(page, 'Ana Ribeiro');
    await page.getByLabel(/Nº do formulário de papel/).fill('0124');
    await page.getByLabel('Hora real do acesso').fill('23:59'); // o relógio simulado está em ~14:32
    await expect(page.getByText('Deve ser anterior ao momento atual.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar lançamento' })).toBeDisabled();
  });

  test('saída retroativa em "Pessoas no condomínio": exige hora real e nº do formulário', async ({ page }) => {
    await page.goto('/pessoas');
    // Seed: Pedro Almeida entrou hoje às 12:10 e segue dentro
    const linha = page.getByRole('table', { name: 'Pessoas atualmente no condomínio' }).getByRole('row').filter({ hasText: 'Pedro Almeida' });
    await expect(linha).toHaveCount(1);
    await linha.getByRole('button', { name: 'Saída retroativa' }).click();

    const modal = page.getByRole('dialog', { name: /Saída retroativa · Pedro Almeida/ });
    await expect(modal).toBeVisible();

    // Sem hora: rejeitado no cliente
    await modal.getByRole('button', { name: 'Registrar saída retroativa' }).click();
    await expect(modal.getByRole('alert')).toContainText('Informe a hora real da saída');

    // Hora anterior à entrada (12:10): rejeitada
    await modal.getByLabel('Hora real da saída').fill('11:00');
    await expect(modal.getByText('Depois da entrada e antes de agora.')).toBeVisible();

    // Hora válida, mas sem formulário: o "servidor" rejeita
    await modal.getByLabel('Hora real da saída').fill('13:00');
    await modal.getByRole('button', { name: 'Registrar saída retroativa' }).click();
    await expect(modal.getByRole('alert')).toBeVisible();
    await expect(linha).toHaveCount(1);

    // Com formulário: registra
    await modal.getByLabel(/Nº do formulário de papel/).fill('0200');
    await modal.getByRole('button', { name: 'Registrar saída retroativa' }).click();
    await expect(toast(page, /Saída retroativa de Pedro Almeida registrada: hora real 09\/10\/2026 13:00/)).toBeVisible();
    await expect(linha).toHaveCount(0); // saiu da lista de presentes

    // Histórico: saída marcada como Retroativo, com a hora real
    await filtrarHistoricoPorPessoa(page, 'Pedro Almeida');
    const saida = linhaEvento(page, 'Pedro Almeida', 'Saída registrada');
    await expect(saida.first()).toContainText('Retroativo');
    await expect(saida.first()).toContainText('Hora real 13:00');
  });
});
