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

  test('na própria entrada: com a busca vazia, o previsto aparece e Enter escolhe pessoa e unidade; o resumo mostra o prazo', async ({ page }) => {
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
    await page.goto('/entrada');
    const previstos = page.getByRole('listbox', { name: /Previstos para agora/ });
    await expect(previstos.getByRole('option', { name: /Larissa Gomes/ })).toBeVisible();
    // Antes de escolher, a etapa 3 mostra os meios bloqueados com o motivo
    await expect(page.getByRole('group', { name: /ainda bloqueados/ }).getByText('Escolha a pessoa primeiro').first()).toBeVisible();
    const busca = page.getByRole('combobox', { name: /Buscar por nome/ });
    await busca.focus();
    const n = await previstos.getByRole('option').count();
    const alvo = (await previstos.getByRole('option').allInnerTexts()).findIndex((t) => t.includes('Larissa Gomes'));
    for (let i = 0; i < alvo && i < n; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Trocar', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alterar', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Autorização prévia/ })).toBeChecked();
    const resumo = page.getByRole('complementary', { name: 'Resumo do registro' });
    await expect(resumo.getByText('Visita · prazo 4 h')).toBeVisible();
    await expect(resumo.getByText(/^Sai até \d{2}:\d{2}/)).toBeVisible();
  });

  test('parâmetros inválidos: tela de entrada vazia, sem erro', async ({ page }) => {
    await entrarComo(page, 'Porteiro');
    await page.goto('/entrada?pessoa=nao-e-uuid&unidade=tambem-nao');
    await expect(page.getByRole('combobox', { name: /Buscar por nome/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trocar', exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/\/entrada$/);
  });
});
