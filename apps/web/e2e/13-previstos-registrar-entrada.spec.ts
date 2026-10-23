import { expect, test, botaoConfirmarEntrada, diaSP, entrarComo, toast, trocarPara } from './helpers';

test.describe('13. Painel: "Registrar entrada" nos previstos', () => {
  test('abre a entrada com pessoa e unidade escolhidas e a autorização prévia selecionada; o porteiro confirma', async ({ page }) => {
    await entrarComo(page, 'Administração');
    await page.goto('/unidades/D-32');
    await page.getByRole('button', { name: 'Nova autorização prévia' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Pessoa autorizada').fill('Larissa Gomes');
    await modal.getByRole('button', { name: /Larissa Gomes/ }).click();
    await modal.getByLabel(/Válida até/).fill(diaSP(10));
    await modal.getByLabel(/Justificativa \(obrigatória sem morador solicitante/).fill('Pedido feito por telefone, morador sem acesso ao sistema');
    await modal.getByRole('button', { name: 'Cadastrar autorização' }).click();
    await expect(toast(page, 'Autorização prévia cadastrada.')).toBeVisible();

    await trocarPara(page, 'Porteiro');
    await page.goto('/painel');
    const link = page.getByRole('link', { name: 'Registrar entrada de Larissa Gomes' });
    await expect(link).toBeVisible();
    await link.focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/entrada$/); // params consumidos
    await expect(page.getByRole('button', { name: 'Trocar', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alterar', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Autorização prévia/ })).toBeChecked();
    await botaoConfirmarEntrada(page).click();
    await expect(toast(page, 'Entrada registrada').first()).toBeVisible();
  });

  test('parâmetros inválidos: tela de entrada vazia, sem erro', async ({ page }) => {
    await entrarComo(page, 'Porteiro');
    await page.goto('/entrada?pessoa=nao-e-uuid&unidade=tambem-nao');
    await expect(page.getByRole('combobox', { name: /Buscar por nome/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trocar', exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/\/entrada$/);
  });
});
