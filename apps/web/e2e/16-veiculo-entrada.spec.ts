import {
  expect, test, botaoConfirmarEntrada, entrarComo, escolherMeio, escolherMorador, escolherPessoa, escolherUnidade, toast,
} from './helpers';

// Veículo na entrada (migração 0013): opcional, "A pé" por padrão; com veículo a placa é obrigatória (antiga ou
// Mercosul), modelo e cor opcionais. Aparece em Presentes agora, na tela de saída e na confirmação da saída, e a
// próxima entrada da mesma pessoa oferece "Mesmo da última visita".
test.describe('16. Veículo na entrada', () => {
  test.beforeEach(async ({ page }) => {
    await entrarComo(page, 'Porteiro');
    await page.goto('/entrada');
    await escolherPessoa(page, 'Márcia Pereira');
    await escolherUnidade(page, 'D-32');
    await escolherMeio(page, 'Interfone');
    await escolherMorador(page, 'Ana Ribeiro');
  });

  test('a pé é o padrão; com veículo, a placa inválida segura a confirmação', async ({ page }) => {
    const resumo = page.getByRole('complementary', { name: 'Resumo do registro' });
    await expect(page.getByRole('radio', { name: 'A pé' })).toBeChecked();
    await expect(resumo).toContainText('A pé');
    await expect(botaoConfirmarEntrada(page)).toBeEnabled();

    await page.getByRole('group', { name: /Veículo/ }).getByText('Com veículo', { exact: true }).click();
    const placa = page.getByRole('textbox', { name: /Placa/ });
    await expect(placa).toBeFocused();
    await expect(page.getByText(/Falta: .*placa do veículo/)).toBeVisible();
    await page.keyboard.type('abcd123');
    await expect(placa).toHaveValue('ABCD123');
    await expect(page.getByText(/fora do padrão antigo/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Confirmar entrada/ })).toBeDisabled();

    // Voltar para "A pé" libera de novo (a placa digitada não vai)
    await page.getByRole('group', { name: /Veículo/ }).getByText('A pé', { exact: true }).click();
    await expect(botaoConfirmarEntrada(page)).toBeEnabled();
  });

  test('entrada com veículo: aparece em presentes e na saída; a próxima entrada oferece o mesmo veículo', async ({ page }) => {
    await page.getByRole('group', { name: /Veículo/ }).getByText('Com veículo', { exact: true }).click();
    await page.keyboard.type('abc1d23');
    await expect(page.getByRole('textbox', { name: /Placa/ })).toHaveValue('ABC-1D23');
    await page.getByLabel('Modelo').fill('Onix');
    await page.getByLabel('Cor').fill('Prata');
    const resumo = page.getByRole('complementary', { name: 'Resumo do registro' });
    await expect(resumo).toContainText('ABC-1D23 · Onix · Prata');
    await botaoConfirmarEntrada(page).click();
    await expect(toast(page, 'Entrada registrada').first()).toBeVisible();

    // Presentes agora
    await page.goto('/pessoas');
    await expect(page.getByText('ABC-1D23 · Onix · Prata')).toBeVisible();

    // Tela de saída: acha pela placa (com ou sem hífen) e a confirmação mostra o veículo
    await page.goto('/saida');
    const busca = page.getByRole('combobox', { name: 'Buscar quem está dentro' });
    await busca.fill('abc1d23');
    const opcao = page.getByRole('option', { name: /Márcia Pereira/ });
    await expect(opcao).toContainText('ABC-1D23 · Onix · Prata');
    await opcao.click();
    const modal = page.getByRole('dialog', { name: 'Registrar saída · Márcia Pereira' });
    await expect(modal).toContainText('ABC-1D23 · Onix · Prata');
    await modal.getByRole('button', { name: 'Confirmar saída' }).click();
    await expect(toast(page, /Saída de Márcia Pereira registrada/)).toBeVisible();

    // Nova entrada da mesma pessoa: "Mesmo da última visita" preenche tudo
    await page.goto('/entrada');
    await escolherPessoa(page, 'Márcia Pereira');
    await escolherUnidade(page, 'D-32');
    await page.getByRole('button', { name: 'Mesmo da última visita: ABC-1D23 · Onix · Prata' }).click();
    await expect(page.getByRole('radio', { name: 'Com veículo' })).toBeChecked();
    await expect(page.getByRole('textbox', { name: /Placa/ })).toHaveValue('ABC-1D23');
    await expect(page.getByRole('complementary', { name: 'Resumo do registro' })).toContainText('ABC-1D23 · Onix · Prata');
  });
});
