import { expect, test, diaSP, entrarComo, revisarEConfirmarVinculo, toast } from './helpers';

test.describe('12. Moradores na tela da unidade', () => {
  test.beforeEach(async ({ page }) => {
    await entrarComo(page, 'Administração');
  });

  test('incluir morador: busca vazia, cadastra a pessoa no picker e deixa o vínculo pendente com link para Vínculos', async ({ page }) => {
    await page.goto('/unidades/C-14');
    await page.getByRole('button', { name: 'Incluir morador' }).click();
    const modal = page.getByRole('dialog', { name: 'Incluir morador' });
    await modal.getByRole('combobox', { name: 'Pessoa', exact: true }).fill('Zulmira Inexistente');
    await expect(modal.getByText('Nenhuma pessoa encontrada.')).toBeVisible();

    await modal.getByRole('option', { name: 'Cadastrar nova pessoa' }).click();
    const cad = page.getByRole('dialog', { name: 'Nova pessoa' });
    await expect(cad.getByLabel('Nome completo')).toHaveValue('Zulmira Inexistente');
    await cad.getByLabel('CPF').fill('909.012.349-07');
    await cad.getByLabel(/Telefone/).fill('(11) 98888-7777');
    await cad.getByRole('button', { name: 'Cadastrar e escolher' }).click();

    // volta ao vínculo com a pessoa criada já escolhida
    const vinc = page.getByRole('dialog', { name: 'Incluir morador' });
    await expect(vinc.getByRole('button', { name: 'Trocar pessoa (Zulmira Inexistente)' })).toBeVisible();
    await revisarEConfirmarVinculo(vinc, 'Vincular Zulmira Inexistente a Bloco C · AP 14 como Proprietário');
    await expect(toast(page, /Vínculo solicitado\. Fica pendente/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Vínculos', exact: true }).first()).toBeVisible();
    await expect(page.getByText(/fica pendente até a aprovação em/)).toBeVisible();

    await page.goto('/vinculos');
    await expect(page.getByRole('list', { name: 'Fila' }).getByRole('button', { name: /Zulmira Inexistente/ })).toBeVisible();
  });

  test('encerrar vínculo pela unidade exige motivo e confirmação', async ({ page }) => {
    await page.goto('/unidades/D-32');
    await page.getByRole('button', { name: 'Encerrar vínculo de Ana Ribeiro' }).click();
    const modal = page.getByRole('alertdialog', { name: 'Encerrar vínculo' });
    const confirmar = modal.getByRole('button', { name: 'Confirmar encerramento' });
    await expect(confirmar).toBeDisabled();
    await modal.getByLabel(/Motivo do encerramento/).fill('Mudou-se do condomínio e devolveu as chaves');
    await confirmar.click();
    await expect(toast(page, /Vínculo de Ana Ribeiro encerrado/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Encerrar vínculo de Ana Ribeiro' })).toHaveCount(0);
  });

  test('revogar autorização prévia pede confirmação; cancelar mantém', async ({ page }) => {
    await page.goto('/unidades/D-32');
    await page.getByRole('button', { name: 'Nova autorização prévia' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Pessoa autorizada').fill('Larissa Gomes');
    await modal.getByRole('button', { name: /Larissa Gomes/ }).click();
    await modal.getByLabel('Morador que pediu').selectOption({ label: 'Ana Ribeiro' });
    await modal.getByLabel(/Válida até/).fill(diaSP(10));
    await modal.getByRole('button', { name: 'Cadastrar autorização' }).click();
    await expect(toast(page, 'Autorização prévia cadastrada.')).toBeVisible();

    const revogar = page.getByRole('button', { name: 'Revogar autorização de Larissa Gomes' });
    await revogar.click();
    const conf = page.getByRole('alertdialog', { name: 'Revogar autorização prévia' });
    await conf.getByRole('button', { name: 'Cancelar' }).click();
    await expect(revogar).toBeVisible();

    await revogar.click();
    await page.getByRole('alertdialog', { name: 'Revogar autorização prévia' }).getByRole('button', { name: 'Revogar autorização' }).click();
    await expect(toast(page, 'Autorização prévia revogada.')).toBeVisible();
    await expect(revogar).toHaveCount(0);
  });

  test('unidade desativada explica por que faltam os botões de inclusão', async ({ page }) => {
    await page.goto('/unidades/C-14');
    await page.getByRole('button', { name: 'Desativar unidade' }).click();
    await expect(page.getByText(/Unidade desativada: reative para incluir moradores ou autorizações/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Incluir morador' })).toHaveCount(0);
  });
});
