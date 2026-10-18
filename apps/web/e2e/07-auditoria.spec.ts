import { expect, test } from '@playwright/test';
import { entrarComo, linhaEvento, toast } from './helpers';

// window.__adulterarEvento é a ferramenta de demonstração do mock (altera um evento sem recalcular o hash)
declare global {
  interface Window { __adulterarEvento: (ref: string | number) => Promise<void> }
}

test.describe('7. Auditoria (síndico)', () => {
  test('verificar integridade: "Trilha íntegra"; após adulterar e recarregar, aponta adulteração', async ({ page }) => {
    await entrarComo(page, 'Síndico');
    await page.goto('/historico');

    const verificar = page.getByRole('button', { name: 'Verificar integridade da trilha' });
    await verificar.click();
    await expect(toast(page, 'Trilha íntegra')).toBeVisible();
    await expect(page.getByText(/Integridade verificada: \d+ registros/)).toBeVisible();

    // Adultera o evento e4808 (Thiago Moura, 08/10) sem recalcular o hash, e recarrega a página
    await page.evaluate(() => window.__adulterarEvento('e4808'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Verificar integridade da trilha' })).toBeVisible();

    await page.getByRole('button', { name: 'Verificar integridade da trilha' }).click();
    await expect(toast(page, 'Adulteração detectada')).toBeVisible();
    const alerta = page.getByRole('alert').filter({ hasText: 'ADULTERAÇÃO DETECTADA NA TRILHA' });
    await expect(alerta).toBeVisible();
    await expect(alerta).toContainText(/primeiro registro inconsistente/i);
    await expect(page.getByText(/Integridade verificada/)).toHaveCount(0);

    // A linha adulterada é marcada na lista (e é a do Thiago Moura)
    const marcada = linhaEvento(page, 'Adulterado');
    await expect(marcada).toHaveCount(1);
    await expect(marcada).toContainText('Thiago Moura');
  });

  test('aba "Trilha de alterações" lista login e as escritas feitas (com usuário e papel)', async ({ page }) => {
    await entrarComo(page, 'Síndico');

    // Escrita feita pelo síndico durante o teste: autorização prévia sem solicitante
    await page.goto('/unidades/T4-32');
    await page.getByRole('button', { name: 'Nova autorização prévia' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Pessoa autorizada').fill('Larissa Gomes');
    await modal.getByRole('button', { name: /Larissa Gomes/ }).click();
    await modal.getByLabel(/Válida até/).fill('2026-10-30');
    await modal.getByLabel(/Justificativa \(obrigatória sem morador/).fill('Cadastro direto pelo síndico para a visita de sábado');
    await modal.getByRole('button', { name: 'Cadastrar autorização' }).click();
    await expect(toast(page, 'Autorização prévia cadastrada.')).toBeVisible();

    await page.goto('/historico');
    await page.getByRole('tab', { name: 'Trilha de alterações' }).click();
    const tabela = page.getByRole('table', { name: 'Trilha de alterações' });

    const login = tabela.getByRole('row', { name: /^Abrir alteração/ }).filter({ hasText: 'auth.login' });
    await expect(login).toHaveCount(1);
    await expect(login).toContainText('Roberto Faria');
    await expect(login).toContainText('Síndico');

    const escrita = tabela.getByRole('row', { name: /^Abrir alteração/ }).filter({ hasText: 'autorizacao.criar' });
    await expect(escrita).toHaveCount(1);
    await expect(escrita).toContainText('Roberto Faria');
    await expect(escrita).toContainText('Síndico');

    // Detalhe: Antes vazio, Depois com os dados (sem dado pessoal em claro)
    await escrita.click();
    await expect(page.getByRole('heading', { name: 'Depois' })).toBeVisible();
    await expect(page.getByText('Esta trilha é só de acréscimo')).toBeVisible();
  });

  test('porteiro NÃO vê a aba "Trilha de alterações" nem a verificação de integridade', async ({ page }) => {
    await entrarComo(page, 'Porteiro');
    await page.goto('/historico');
    await expect(page.getByRole('heading', { name: 'Histórico e auditoria' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Trilha de alterações' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Verificar integridade da trilha' })).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Eventos de acesso' })).toBeVisible();
  });
});
