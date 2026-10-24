// E2E contra a API real (PGlite): vincular uma pessoa a uma unidade a partir da ficha (Pessoas), com o mesmo fluxo e o
// mesmo resultado de "Incluir morador" (POST /vinculos, nasce pendente; conferência e aprovação ficam em Vínculos), e o
// comportamento dos combobox (teclado, Esc fecha só a lista, tela pequena). Dados: o seed do e2e (apps/api/test/e2e/dados.ts).
import type { Page } from '@playwright/test';
import { expect, test, diaSP, entrarComo, toast } from './helpers';

async function abrirFicha(page: Page, nome: string) {
  await page.goto('/cadastro');
  await page.getByLabel('Buscar por nome, documento ou unidade').fill(nome);
  await page.getByRole('row', { name: `Abrir ficha de ${nome}` }).click();
  return page.getByRole('dialog', { name: 'Ficha da pessoa' });
}

test.describe('14. Vínculo pela ficha da pessoa', () => {
  test('administração vincula pela ficha: Bloco -> Apartamento -> Inquilino -> revisão -> pendente na ficha e na fila', async ({ page }) => {
    await entrarComo(page, 'Administração');
    const ficha = await abrirFicha(page, 'Larissa Gomes');
    await ficha.getByRole('button', { name: 'Vincular a uma unidade' }).click();
    const modal = page.getByRole('dialog', { name: 'Vincular a uma unidade' });
    await expect(modal.getByText('Larissa Gomes')).toBeVisible();

    await modal.getByRole('combobox', { name: 'Bloco' }).click();
    await modal.getByRole('option', { name: /^Bloco C/ }).click();
    // O foco passa para o apartamento (escolha encadeada)
    await expect(modal.getByRole('combobox', { name: 'Apartamento' })).toBeFocused();
    await modal.getByRole('combobox', { name: 'Apartamento' }).click();
    await modal.getByRole('option', { name: /^AP 14\b/ }).click();

    await modal.getByRole('radio', { name: 'Inquilino' }).click();
    await modal.getByRole('button', { name: 'Revisar vínculo' }).click();
    await expect(modal.getByText('Inquilino exige data de fim da vigência.')).toBeVisible();
    await modal.getByLabel('Fim da vigência (obrigatório)').fill(diaSP(365));
    await modal.getByRole('button', { name: 'Revisar vínculo' }).click();
    await expect(modal.getByText('Vincular Larissa Gomes a Bloco C · AP 14 como Inquilino')).toBeFocused();
    await expect(modal.getByText('Fica pendente de aprovação')).toBeVisible();
    await modal.getByRole('button', { name: 'Confirmar vínculo' }).click();

    await expect(toast(page, /Fica pendente até a aprovação/)).toBeVisible();
    await expect(ficha.getByText(/Vincular Larissa Gomes a Bloco C · AP 14 como Inquilino: solicitado e pendente/)).toBeVisible();
    await expect(ficha.getByText('C-14')).toBeVisible();

    // Reabrir o fluxo: a C-14 agora aparece indisponível (não duplica)
    await ficha.getByRole('button', { name: 'Vincular a uma unidade' }).click();
    await modal.getByRole('combobox', { name: 'Bloco' }).click();
    await modal.getByRole('option', { name: /^Bloco C/ }).click();
    await modal.getByRole('combobox', { name: 'Apartamento' }).click();
    const c14 = modal.getByRole('option', { name: /^AP 14\b/ });
    await expect(c14).toHaveAttribute('aria-disabled', 'true');
    await expect(c14).toContainText('Já tem vínculo pendente com esta unidade');
    await page.keyboard.press('Escape'); // fecha só a lista
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Cancelar' }).click();
    await expect(ficha).toBeVisible();

    // Mesmo resultado de "Incluir morador": pendente na fila de Vínculos (conferência e aprovação são passos separados)
    await page.goto('/vinculos');
    await page.getByRole('list', { name: 'Fila' }).getByRole('button', { name: /Larissa Gomes/ }).click();
    await expect(page.getByText('Comprovante não conferido')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aprovar', exact: true })).toBeDisabled();
  });

  test('só pelo teclado: Bloco e Apartamento filtrados por digitação, tipo por setas, Enter confirma', async ({ page }) => {
    await entrarComo(page, 'Síndico');
    const ficha = await abrirFicha(page, 'Bruno Teixeira');
    await ficha.getByRole('button', { name: 'Vincular a uma unidade' }).focus();
    await page.keyboard.press('Enter');
    const modal = page.getByRole('dialog', { name: 'Vincular a uma unidade' });
    const bloco = modal.getByRole('combobox', { name: 'Bloco' });
    await bloco.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('B');
    await page.keyboard.press('Enter');
    await expect(bloco).toContainText('Bloco B');
    await expect(modal.getByRole('combobox', { name: 'Apartamento' })).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.type('11');
    await page.keyboard.press('Enter');
    await expect(modal.getByRole('combobox', { name: 'Apartamento' })).toContainText('AP 11');

    await modal.getByRole('radio', { name: 'Proprietário' }).focus();
    // Setas movem o foco entre as opções (o Radix move num setTimeout: espera o foco chegar) e Espaço marca.
    for (const proximo of ['Inquilino', 'Dependente']) {
      await page.keyboard.press('ArrowRight');
      await expect(modal.getByRole('radio', { name: proximo })).toBeFocused();
    }
    await page.keyboard.press('Space');
    await expect(modal.getByRole('radio', { name: 'Dependente' })).toBeChecked();
    await modal.getByRole('button', { name: 'Revisar vínculo' }).focus();
    await page.keyboard.press('Enter');
    await expect(modal.getByText('Vincular Bruno Teixeira a Bloco B · AP 11 como Dependente')).toBeVisible();
    await modal.getByRole('button', { name: 'Confirmar vínculo' }).focus();
    await page.keyboard.press('Enter');
    await expect(toast(page, /Vínculo solicitado/)).toBeVisible();
    await expect(ficha.getByText('B-11')).toBeVisible();
  });

  test('auditor abre a ficha sem o botão de vincular (RN-03: só síndico e administração criam vínculo)', async ({ page }) => {
    await entrarComo(page, 'Auditor');
    const ficha = await abrirFicha(page, 'Larissa Gomes');
    await expect(ficha.getByText('Vínculos com unidades')).toBeVisible();
    await expect(ficha.getByRole('button', { name: 'Vincular a uma unidade' })).toHaveCount(0);
  });

  test('incluir morador em tela pequena: a lista de pessoas cabe na tela, Esc fecha só a lista', async ({ page }) => {
    await entrarComo(page, 'Administração');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/unidades/C-14');
    await page.getByRole('button', { name: 'Incluir morador' }).click();
    const modal = page.getByRole('dialog', { name: 'Incluir morador' });
    const campo = modal.getByRole('combobox', { name: 'Pessoa', exact: true });
    await campo.fill('Lar');
    const opcao = modal.getByRole('option', { name: /Larissa Gomes/ });
    await expect(opcao).toBeVisible();
    await expect(opcao).toContainText('***'); // CPF só mascarado
    const caixa = (await opcao.boundingBox())!;
    expect(caixa.x).toBeGreaterThanOrEqual(0);
    expect(caixa.x + caixa.width).toBeLessThanOrEqual(390);
    await expect(campo).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(opcao).toHaveCount(0);
    await expect(campo).toHaveAttribute('aria-expanded', 'false');
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
  });
});
