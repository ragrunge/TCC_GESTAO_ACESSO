import { expect, test, diaSP, botaoConfirmarEntrada, entrarComo, escolherPessoa, escolherUnidade, filtrarHistoricoPorPessoa, linhaEvento, toast, trocarPara } from './helpers';

test.describe('4. Autorização prévia (tela da unidade)', () => {
  test('sem "Morador que pediu" exige justificativa; vira exceção atribuída a quem cadastrou (relatório do síndico)', async ({ page }) => {
    // --- Administração cadastra a autorização prévia na tela da unidade
    await entrarComo(page, 'Administração');
    await page.goto('/unidades/D-32');
    await page.getByRole('button', { name: 'Nova autorização prévia' }).click();
    const modal = page.getByRole('dialog');

    await modal.getByLabel('Pessoa autorizada').fill('Larissa Gomes');
    await modal.getByRole('button', { name: /Larissa Gomes/ }).click();
    await modal.getByLabel(/Válida até/).fill(diaSP(10));

    // Sem solicitante: aparece o campo de justificativa e o envio sem ela é rejeitado
    const just = modal.getByLabel(/Justificativa \(obrigatória sem morador solicitante/);
    await expect(just).toBeVisible();
    await modal.getByRole('button', { name: 'Cadastrar autorização' }).click();
    await expect(modal.getByRole('alert')).toContainText(/justificativa de pelo menos 15 caracteres/);

    // Justificativa curta (14 caracteres) continua inválida
    await just.fill('12345678901234');
    await modal.getByRole('button', { name: 'Cadastrar autorização' }).click();
    await expect(modal.getByRole('alert')).toBeVisible();

    await just.fill('Pedido feito por telefone, morador sem acesso ao sistema');
    await modal.getByRole('button', { name: 'Cadastrar autorização' }).click();
    await expect(toast(page, 'Autorização prévia cadastrada.')).toBeVisible();

    // Selo "Sem solicitante" na unidade, com quem cadastrou e a justificativa
    const cartao = page.getByRole('heading', { name: 'Autorizações prévias ativas' }).locator('..');
    const item = cartao.locator('div', { hasText: 'Larissa Gomes' }).last();
    await expect(item.getByText('Sem solicitante', { exact: true })).toBeVisible();
    await expect(item).toContainText('cadastrada por Paula Nogueira');
    await expect(item).toContainText('Justificativa: Pedido feito por telefone');

    // --- Com solicitante a justificativa não é exigida (contraste): o campo some
    await page.getByRole('button', { name: 'Nova autorização prévia' }).click();
    const modal2 = page.getByRole('dialog');
    await modal2.getByLabel('Morador que pediu').selectOption({ label: 'Ana Ribeiro' });
    await expect(modal2.getByLabel(/Justificativa \(obrigatória/)).toHaveCount(0);
    await modal2.getByRole('button', { name: 'Cancelar' }).click();

    // --- Porteiro registra a entrada usando a autorização
    await trocarPara(page, 'Porteiro');
    await page.goto('/entrada');
    await escolherPessoa(page, 'Larissa Gomes');
    await escolherUnidade(page, 'D-32');
    await expect(page.getByRole('status').filter({ hasText: /Autorização prévia sem solicitante/ })).toBeVisible();
    await botaoConfirmarEntrada(page).click();
    await expect(toast(page, 'Entrada registrada').first()).toBeVisible();

    // O histórico marca como "Sem solicitante" (tratada como exceção)
    await filtrarHistoricoPorPessoa(page, 'Larissa Gomes');
    await expect(linhaEvento(page, 'Larissa Gomes', 'D-32', 'Sem solicitante')).toHaveCount(1);

    // --- Síndico vê a exceção no relatório, atribuída a quem cadastrou a autorização (Paula), não ao porteiro
    await trocarPara(page, 'Síndico');
    await page.goto('/relatorios');
    const secao = page.locator('section', { has: page.getByRole('heading', { name: 'Liberações por exceção, por responsável' }) });
    const linhaPaula = secao.getByRole('listitem').filter({ hasText: 'Paula Nogueira' });
    await expect(linhaPaula).toHaveCount(1);
    await expect(linhaPaula).toContainText('1');
    // (o porteiro que só registrou a entrada não recebe esta exceção; Paula não tinha nenhuma no seed)
  });
});
