import type { Page } from '@playwright/test';
import { expect, test, entrarComo, toast } from './helpers';

test.describe('6. Vínculo', () => {
  test.beforeEach(async ({ page }) => {
    await entrarComo(page, 'Administração');
  });

  test('administração solicita vínculo sem campo de documento; fica pendente', async ({ page }) => {
    await page.goto('/unidades/C-14');
    await page.getByRole('button', { name: 'Solicitar vínculo' }).click();
    const modal = page.getByRole('dialog', { name: 'Solicitar vínculo' });
    await expect(modal).toBeVisible();

    // Sem anexo/campo de documento (RF-04): a aprovação da administração é o que vale
    await expect(modal.locator('input[type=file]')).toHaveCount(0);
    await expect(modal.getByLabel(/documento|anexo|contrato|arquivo/i)).toHaveCount(0);

    await modal.getByLabel('Pessoa', { exact: true }).fill('Larissa Gomes');
    await modal.getByRole('button', { name: /Larissa Gomes/ }).click();
    await modal.getByRole('combobox', { name: 'Tipo de vínculo' }).selectOption({ label: 'Dependente' });
    await modal.getByRole('button', { name: 'Solicitar vínculo' }).click();
    await expect(toast(page, /Vínculo solicitado\. Fica pendente/)).toBeVisible();

    // Aparece na fila de pendentes da administração
    await page.goto('/vinculos');
    await expect(page.getByRole('list', { name: 'Fila' }).getByRole('button', { name: /Larissa Gomes/ })).toBeVisible();
  });

  test('aprovar pessoa sem CPF/telefone completo é barrado por "cadastro incompleto"', async ({ page }) => {
    // 1) Cadastra pessoa sem CPF (a administração pode cadastrar visitante sem CPF)
    await page.goto('/cadastro');
    await page.getByRole('button', { name: 'Nova pessoa' }).click();
    const nova = page.getByRole('dialog', { name: 'Nova pessoa' });
    await nova.getByLabel('Nome completo').fill('Ximena Sem Documento');
    await nova.getByLabel('Tipo').selectOption({ label: 'Visitante' });
    await nova.getByLabel('Pessoa sem CPF').check();
    await nova.getByLabel('Telefone (obrigatório)').fill('(11) 98888-7777');
    await nova.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(toast(page, 'Ximena Sem Documento cadastrado(a).')).toBeVisible();

    // 2) Solicita o vínculo na unidade
    await page.goto('/unidades/C-14');
    await page.getByRole('button', { name: 'Solicitar vínculo' }).click();
    const modal = page.getByRole('dialog', { name: 'Solicitar vínculo' });
    await modal.getByLabel('Pessoa', { exact: true }).fill('Ximena Sem');
    await modal.getByRole('button', { name: /Ximena Sem Documento/ }).click();
    await modal.getByRole('button', { name: 'Solicitar vínculo' }).click();
    await expect(toast(page, /Vínculo solicitado/)).toBeVisible();

    // 3) Na fila, a aprovação é barrada: aviso "Cadastro incompleto" e botão Aprovar desabilitado
    await page.goto('/vinculos');
    await page.getByRole('list', { name: 'Fila' }).getByRole('button', { name: /Ximena Sem Documento/ }).click();
    await expect(page.getByRole('heading', { name: /Ximena Sem Documento/ })).toBeVisible();
    await expect(page.getByText(/Cadastro incompleto: a pessoa precisa ter CPF válido/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aprovar', exact: true })).toBeDisabled();
    // Rejeitar segue disponível
    await expect(page.getByRole('button', { name: 'Rejeitar', exact: true })).toBeEnabled();
  });

  test('aprovar vínculo de cadastro completo funciona', async ({ page }) => {
    await page.goto('/vinculos');
    // Seed V4: Lucas Ferraz (C-42), todas as conferências OK e cadastro completo
    await page.getByRole('list', { name: 'Fila' }).getByRole('button', { name: /Lucas Ferraz/ }).click();
    await expect(page.getByRole('heading', { name: /Lucas Ferraz/ })).toBeVisible();
    await expect(page.getByText(/Cadastro incompleto/)).toHaveCount(0);

    // RF-05: sem conferência registrada, Aprovar fica desabilitado
    const aprovar = page.getByRole('button', { name: 'Aprovar', exact: true });
    await expect(aprovar).toBeDisabled();
    await registrarConferencia(page, 'Contrato de locação');
    await expect(toast(page, /Conferência do comprovante de Lucas Ferraz registrada/)).toBeVisible();
    await expect(page.getByText(/Conferido por/)).toBeVisible();

    await aprovar.click();
    await expect(toast(page, /Vínculo de Lucas Ferraz \(C-42\) aprovado/)).toBeVisible();

    // Saiu da fila de pendentes e foi para "Decididos" com o aprovador
    await expect(page.getByRole('list', { name: 'Fila' }).getByRole('button', { name: /Lucas Ferraz/ })).toHaveCount(0);
    await page.getByRole('tab', { name: /Decididos/ }).click();
    await page.getByRole('list', { name: 'Fila' }).getByRole('button', { name: /Lucas Ferraz/ }).click();
    await expect(page.getByText(/por Paula Nogueira em/)).toBeVisible();
  });

  test('conferência do comprovante: sem arquivo, exige tipo e confirmação, barra CPF na observação (Rodrigo Alves, V1)', async ({ page }) => {
    await page.goto('/vinculos');
    await page.getByRole('list', { name: 'Fila' }).getByRole('button', { name: /Rodrigo Alves/ }).click();
    await expect(page.getByRole('heading', { name: /Rodrigo Alves/ })).toBeVisible();
    await expect(page.locator('input[type=file]')).toHaveCount(0);
    await expect(page.getByLabel('Pré-visualização do documento')).toHaveCount(0);
    await expect(page.getByText('Comprovante não conferido')).toBeVisible();

    const registrar = page.getByRole('button', { name: 'Registrar conferência' });
    await expect(registrar).toBeDisabled();
    await page.getByLabel('Tipo do documento conferido').selectOption({ label: 'Outro' });
    await page.getByLabel('Conferi o comprovante apresentado').check();
    await expect(registrar).toBeDisabled(); // "Outro" exige descrição
    await page.getByLabel('Descrição do documento').fill('Formal de partilha');
    await expect(registrar).toBeEnabled();
    await page.getByLabel('Observação (opcional)').fill('CPF do locador 529.982.247-25');
    await expect(page.getByText('Não escreva CPF, telefone ou outro número pessoal.')).toBeVisible();
    await expect(registrar).toBeDisabled();
    await page.getByLabel('Observação (opcional)').fill('Recebido por e-mail.');
    await registrar.click();
    await expect(toast(page, /Conferência do comprovante de Rodrigo Alves registrada/)).toBeVisible();
    await expect(page.getByText('Outro — Formal de partilha')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aprovar', exact: true })).toBeEnabled();
  });

  test('regularizar legado também pede a conferência do comprovante', async ({ page }) => {
    await page.goto('/vinculos');
    await page.getByRole('tab', { name: /Legados/ }).click();
    await page.getByRole('list', { name: 'Fila' }).getByRole('button', { name: /Lúcia Ribeiro/ }).click();
    const regularizar = page.getByRole('button', { name: 'Regularizar', exact: true });
    await expect(regularizar).toBeDisabled();
    await expect(page.getByText(/Registre a conferência do comprovante \(ao lado\) antes de regularizar/)).toBeVisible();
    await registrarConferencia(page, 'Outro', 'Certidão de nascimento');
    await expect(regularizar).toBeEnabled();
    await regularizar.click();
    await expect(toast(page, /Vínculo legado de Lúcia Ribeiro \(D-32\) regularizado/)).toBeVisible();
  });
});

async function registrarConferencia(page: Page, tipo: string, descricao?: string) {
  await page.getByLabel('Tipo do documento conferido').selectOption({ label: tipo });
  if (descricao) await page.getByLabel('Descrição do documento').fill(descricao);
  await page.getByLabel('Conferi o comprovante apresentado').check();
  await page.getByRole('button', { name: 'Registrar conferência' }).click();
}
