import { fileURLToPath } from 'node:url';
import { expect, test, diaSP, entrarComo, escolherPessoa, escolherUnidade, linhaEvento, toast } from './helpers';

const XLSX = fileURLToPath(new URL('./fixtures/moradores.xlsx', import.meta.url));

test.describe('9. Lacunas do MVP', () => {
  test('relatórios: filtros de período, tipo de pessoa e meio, e exportação em CSV', async ({ page }) => {
    await entrarComo(page, 'Síndico');
    await page.goto('/relatorios');
    const filtros = page.getByRole('form', { name: 'Filtros do relatório' });
    await expect(filtros).toBeVisible();
    await expect(page.getByText(/acessos no período/)).toBeVisible();
    const totalGeral = await page.getByText(/acessos no período/).innerText();

    await filtros.getByLabel('Tipo de pessoa').selectOption('prestador');
    await expect(page.getByText(/acessos no período/)).not.toHaveText(totalGeral);
    await filtros.getByLabel('Meio de autorização').selectOption('interfone');
    await filtros.getByLabel('De', { exact: true }).fill(diaSP());
    await filtros.getByLabel('Até', { exact: true }).fill(diaSP());
    await expect(page.getByText(/^\d+ de \d+ unidades|\d+ acessos no período/).first()).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar CSV' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^relatorio-portaria-parque-.*\.csv$/);
    await expect(toast(page, 'Relatório exportado')).toBeVisible();

    await filtros.getByRole('button', { name: 'Limpar filtros' }).click();
    await expect(page.getByText(/acessos no período/)).toHaveText(totalGeral);
  });

  test('gaveta do evento: "Exportar este evento" baixa o JSONL do evento isolado', async ({ page }) => {
    await entrarComo(page, 'Síndico');
    await page.goto('/historico');
    await linhaEvento(page, 'Thiago Moura').first().click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar este evento' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^evento-EV-.*\.jsonl$/);
    await expect(toast(page, 'Evento exportado')).toBeVisible();
  });

  test('importação aceita .xlsx e mostra o relatório de inconsistências', async ({ page }) => {
    await entrarComo(page, 'Síndico');
    await page.goto('/importar');
    await page.getByLabel('Selecionar arquivo da planilha').setInputFiles(XLSX);
    await expect(page.getByText('moradores.xlsx')).toBeVisible();
    await expect(page.getByText(/3 linhas lidas · 2 válidas · 1 rejeitadas/)).toBeVisible();
    await expect(page.getByText('Ágata Mendonça Lopes')).toBeVisible();
  });

  test('busca da portaria: morador aparece com rótulo, vai a outra unidade e é barrado na própria', async ({ page }) => {
    await entrarComo(page, 'Porteiro');
    await page.goto('/entrada');
    await page.getByRole('combobox', { name: /Buscar por nome/ }).fill('Ana Ribeiro');
    await expect(page.getByRole('option', { name: /Ana Ribeiro/ }).first()).toContainText('Morador da D-32');
    await page.getByRole('option', { name: /Ana Ribeiro/ }).first().click();

    await escolherUnidade(page, 'D-32');
    await expect(page.getByText('Morador não registra entrada na própria unidade no MVP')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar entrada', exact: true })).toBeDisabled();

    await page.getByRole('button', { name: 'Alterar', exact: true }).click();
    await escolherUnidade(page, 'A-12');
    await expect(page.getByText('Morador não registra entrada na própria unidade no MVP')).toHaveCount(0);
  });

  test('busca da portaria: mais de 8 resultados mostra "Mais resultados — refine a busca"', async ({ page }) => {
    await entrarComo(page, 'Porteiro');
    await page.goto('/entrada');
    await page.getByRole('combobox', { name: /Buscar por nome/ }).fill('a');
    await expect(page.getByRole('option')).toHaveCount(8);
    await expect(page.getByText('Mais resultados — refine a busca')).toBeVisible();
    await page.getByRole('combobox', { name: /Buscar por nome/ }).fill('Márcia Pereira');
    await expect(page.getByText('Mais resultados — refine a busca')).toHaveCount(0);
    await escolherPessoa(page, 'Márcia Pereira');
  });
});
