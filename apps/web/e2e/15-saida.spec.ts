import {
  expect, test, botaoConfirmarEntrada, entrarComo, escolherMeio, escolherMorador, escolherPessoa, escolherUnidade, filtrarHistoricoPorPessoa,
  linhaEvento, toast,
} from './helpers';

// Tela "Registrar saída" (/saida, UC07): busca entre quem está dentro, confirmação, saída como evento novo ligado à
// entrada (RN-04). Também o atalho F8 e a abertura já selecionada pela gaveta do evento (?entrada=<id>).
test.describe('15. Saída pelo porteiro (/saida)', () => {
  test.beforeEach(async ({ page }) => {
    await entrarComo(page, 'Porteiro');
    await page.goto('/entrada');
    await escolherPessoa(page, 'Márcia Pereira');
    await escolherUnidade(page, 'D-32');
    await escolherMeio(page, 'Interfone');
    await escolherMorador(page, 'Ana Ribeiro');
    await botaoConfirmarEntrada(page).click();
    await expect(toast(page, 'Entrada registrada').first()).toBeVisible();
    await expect(page).toHaveURL(/\/painel$/);
  });

  test('porteiro registra saída pela tela de saída', async ({ page }) => {
    // F8 abre a tela, com o foco na busca
    await page.keyboard.press('F8');
    await expect(page).toHaveURL(/\/saida$/);
    const busca = page.getByRole('combobox', { name: 'Buscar quem está dentro' });
    await expect(busca).toBeFocused();

    // Busca pelo nome (sem acento) e escolha por teclado
    await page.keyboard.type('marcia');
    const opcao = page.getByRole('option', { name: /Márcia Pereira/ });
    await expect(opcao).toHaveCount(1);
    await expect(opcao).toContainText('D-32');
    await page.keyboard.press('Enter');

    const modal = page.getByRole('dialog', { name: 'Registrar saída · Márcia Pereira' });
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('D-32');
    await expect(modal).toContainText('Ana Ribeiro');
    await expect(modal.getByRole('button', { name: 'Confirmar saída' })).toBeFocused();
    const codigoEntrada = /\((EV-\d+)\)/.exec((await modal.getByText(/Entrou às/).textContent()) ?? '')?.[1];
    expect(codigoEntrada).toBeTruthy();

    // Enter confirma
    await page.keyboard.press('Enter');
    await expect(toast(page, new RegExp(`Saída de Márcia Pereira registrada às \\d\\d:\\d\\d \\(EV-\\d+, ligada à entrada ${codigoEntrada}\\)`))).toBeVisible();
    await expect(modal).toHaveCount(0);
    await expect(busca).toBeFocused(); // pronto para a próxima saída
    await expect(busca).toHaveValue('');
    await expect(page.getByRole('option', { name: /Márcia Pereira/ })).toHaveCount(0);

    // Some de "Presentes agora"
    await page.goto('/pessoas');
    await expect(page.getByRole('table', { name: 'Pessoas atualmente no condomínio' }).getByRole('row').filter({ hasText: 'Márcia Pereira' })).toHaveCount(0);

    // Histórico: a saída é um evento próprio, ligado à entrada
    await filtrarHistoricoPorPessoa(page, 'Márcia Pereira');
    const saida = linhaEvento(page, 'Márcia Pereira', 'Saída registrada');
    await expect(saida).toHaveCount(1);
    await saida.click();
    await expect(page.getByText(`Vinculado à entrada ${codigoEntrada}`)).toBeVisible();
  });

  test('busca pelo começo do CPF (formato novo da máscara) acha quem está dentro; o meio do CPF não', async ({ page }) => {
    await page.goto('/saida');
    const busca = page.getByRole('combobox', { name: 'Buscar quem está dentro' });
    await busca.fill('901.23'); // Márcia Pereira: CPF 901.234.561-xx, máscara 901.23*.***-**
    const opcao = page.getByRole('option', { name: /Márcia Pereira/ });
    await expect(opcao).toHaveCount(1);
    await expect(opcao).toContainText('901.23*.***-**');
    await busca.fill('23456'); // dígitos 3 a 7: não estão no banco (só os 5 primeiros ficam visíveis)
    await expect(page.getByText('Ninguém dentro com “23456”.')).toBeVisible();
    await expect(page.getByRole('option', { name: /Márcia Pereira/ })).toHaveCount(0);
  });

  test('pela gaveta da entrada: abre a saída já escolhida; Esc volta sem registrar', async ({ page }) => {
    await filtrarHistoricoPorPessoa(page, 'Márcia Pereira');
    const entrada = linhaEvento(page, 'Márcia Pereira', 'D-32');
    await expect(entrada).toHaveCount(1);
    await entrada.click();
    await page.getByRole('dialog', { name: /^Evento EV-/ }).getByRole('link', { name: 'Registrar saída', exact: true }).click();

    await expect(page).toHaveURL(/\/saida$/); // o ?entrada= é consumido
    const modal = page.getByRole('dialog', { name: 'Registrar saída · Márcia Pereira' });
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Buscar quem está dentro' })).toBeFocused();
    await expect(page.getByRole('option', { name: /Márcia Pereira/ })).toHaveCount(1); // continua dentro
  });
});
