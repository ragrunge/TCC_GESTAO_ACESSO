import { expect, test } from '@playwright/test';
import { botaoConfirmarEntrada, entrarComo, escolherMeio, escolherUnidade, filtrarHistoricoPorPessoa, linhaEvento, toast } from './helpers';

// CPFs válidos (dígitos verificadores corretos) usados apenas nos testes
const CPF_VALIDO = '529.982.247-25';
const CPF_INVALIDO = '123.456.789-00';
const TELEFONE = '(11) 91234-5678';

test.describe('3. Cadastro de nova pessoa na entrada', () => {
  test.beforeEach(async ({ page }) => {
    await entrarComo(page, 'Porteiro');
    await page.goto('/entrada');
    await page.getByRole('button', { name: 'Pessoa sem cadastro' }).click();
    await expect(page.getByLabel('Nome completo')).toBeVisible();
  });

  test('CPF inválido mostra erro e não cadastra', async ({ page }) => {
    await page.getByLabel('Nome completo').fill('Carlos Teste Cpf');
    await page.getByRole('textbox', { name: 'CPF', exact: true }).fill(CPF_INVALIDO);
    await page.getByLabel('Telefone (obrigatório)').fill(TELEFONE);
    await page.getByRole('button', { name: 'Usar este cadastro' }).click();

    await expect(page.getByRole('alert')).toContainText('CPF inválido');
    // Continua no formulário: nenhuma pessoa foi escolhida
    await expect(page.getByRole('button', { name: 'Trocar', exact: true })).toHaveCount(0);
  });

  test('telefone ausente ou incompleto impede o cadastro', async ({ page }) => {
    await page.getByLabel('Nome completo').fill('Carlos Teste Fone');
    await page.getByRole('textbox', { name: 'CPF', exact: true }).fill(CPF_VALIDO);

    // Telefone vazio: o campo é obrigatório e o navegador bloqueia o envio
    const tel = page.getByLabel('Telefone (obrigatório)');
    await page.getByRole('button', { name: 'Usar este cadastro' }).click();
    await expect(tel).toHaveJSProperty('validity.valueMissing', true);
    await expect(page.getByRole('button', { name: 'Trocar', exact: true })).toHaveCount(0);

    // Telefone sem DDD/curto: a regra do "servidor" rejeita
    await tel.fill('1234');
    await page.getByRole('button', { name: 'Usar este cadastro' }).click();
    await expect(page.getByRole('alert')).toContainText(/telefone/i);
    await expect(page.getByRole('button', { name: 'Trocar', exact: true })).toHaveCount(0);
  });

  test('CPF válido + telefone: pessoa cadastrada e selecionada para a entrada', async ({ page }) => {
    await page.getByLabel('Nome completo').fill('Carlos Teste Valido');
    await page.getByRole('textbox', { name: 'CPF', exact: true }).fill(CPF_VALIDO);
    await page.getByLabel('Telefone (obrigatório)').fill(TELEFONE);
    await page.getByRole('button', { name: 'Usar este cadastro' }).click();

    await expect(toast(page, /Carlos Teste Valido cadastrado\(a\) como visitante/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Trocar', exact: true })).toBeVisible();
    await expect(page.getByText('***.982.247-**')).toBeVisible(); // CPF só aparece mascarado
    await expect(page.getByText('529.982.247-25')).toHaveCount(0);

    // Com CPF, todos os meios ficam disponíveis (aqui: escolhe a unidade e confere os rótulos)
    await escolherUnidade(page, 'T4-32');
    for (const meio of [/Interfone/, /Morador presente/, /Exceção do porteiro/]) {
      await expect(page.getByRole('radio', { name: meio })).toBeEnabled();
    }
  });

  test('CPF já cadastrado é rejeitado (sem duplicar a pessoa)', async ({ page }) => {
    await page.getByLabel('Nome completo').fill('Carlos Primeiro');
    await page.getByRole('textbox', { name: 'CPF', exact: true }).fill(CPF_VALIDO);
    await page.getByLabel('Telefone (obrigatório)').fill(TELEFONE);
    await page.getByRole('button', { name: 'Usar este cadastro' }).click();
    await expect(page.getByRole('button', { name: 'Trocar', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Trocar', exact: true }).click();
    await page.getByRole('button', { name: 'Pessoa sem cadastro' }).click();
    await page.getByLabel('Nome completo').fill('Carlos Segundo');
    await page.getByRole('textbox', { name: 'CPF', exact: true }).fill(CPF_VALIDO);
    await page.getByLabel('Telefone (obrigatório)').fill(TELEFONE);
    await page.getByRole('button', { name: 'Usar este cadastro' }).click();
    await expect(page.getByRole('alert')).toContainText('Já existe cadastro com este CPF');
  });

  test('"Pessoa sem CPF": só o meio "Exceção do porteiro" fica disponível', async ({ page }) => {
    await page.getByLabel('Nome completo').fill('Pessoa Sem Documento');
    await page.getByLabel('Pessoa sem CPF').check();
    await expect(page.getByRole('textbox', { name: 'CPF', exact: true })).toBeDisabled();
    await page.getByLabel('Telefone (obrigatório)').fill(TELEFONE);
    await page.getByRole('button', { name: 'Usar este cadastro' }).click();

    await expect(page.getByRole('button', { name: 'Trocar', exact: true })).toBeVisible();
    await escolherUnidade(page, 'T4-32');

    await expect(page.getByText('Pessoa cadastrada sem CPF')).toBeVisible();
    await expect(page.getByRole('radio', { name: /Interfone/ })).toBeDisabled();
    await expect(page.getByRole('radio', { name: /Morador presente/ })).toBeDisabled();
    await expect(page.getByRole('radio', { name: /Autorização prévia/ })).toBeDisabled();
    await expect(page.getByRole('radio', { name: /Exceção do porteiro/ })).toBeEnabled();

    // E a entrada por exceção funciona, com justificativa
    await escolherMeio(page, 'Exceção do porteiro');
    await page.getByLabel(/Justificativa \(obrigatória/).fill('Entrega combinada com a moradora, sem documento');
    await botaoConfirmarEntrada(page).click();
    await expect(toast(page, 'Entrada registrada').first()).toBeVisible();

    await filtrarHistoricoPorPessoa(page, 'Pessoa Sem Documento');
    await expect(linhaEvento(page, 'Pessoa Sem Documento', 'Exceção')).toHaveCount(1);
  });
});
