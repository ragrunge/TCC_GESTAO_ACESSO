import { expect, test } from '@playwright/test';
import { NOME_PERFIL, ROTA_INICIAL, entrarComo, type Perfil } from './helpers';

test.describe('1. Login', () => {
  const perfis: Perfil[] = ['Porteiro', 'Administração', 'Síndico', 'Auditor'];

  for (const perfil of perfis) {
    test(`${perfil} entra sem etapa de 2FA e cai na rota inicial`, async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: perfil, exact: true }).click();
      await expect(page.getByRole('button', { name: perfil, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();

      // Sem 2FA: não aparece nenhum campo de código/token em nenhum momento do fluxo
      await expect(page).toHaveURL(ROTA_INICIAL[perfil]);
      await expect(page.getByLabel(/c[óo]digo|token|2FA|verifica[çc][ãa]o/i)).toHaveCount(0);

      // Já autenticado: usuário e papel aparecem no cabeçalho
      await expect(page.getByText(NOME_PERFIL[perfil], { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
    });
  }

  test('qualquer senha é aceita, e a sessão sobrevive a recarregar a página', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Senha').fill('qualquer-coisa-123');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/painel$/);
    await page.reload();
    await expect(page).toHaveURL(/\/painel$/);
  });

  test('usuário inexistente mostra erro e fica na tela de login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Usuário').fill('fulano.inexistente');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('rota protegida sem sessão redireciona ao login; sair encerra a sessão', async ({ page }) => {
    await page.goto('/historico');
    await expect(page).toHaveURL(/\/login$/);
    await entrarComo(page, 'Porteiro');
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
