import { expect, test } from '@playwright/test';
import { entrarComo } from './helpers';

test('usuários: redefinir acesso: formato, copiar mensagem, linha própria', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await entrarComo(page, 'Síndico');
  await page.goto('/usuarios');
  const propria = page.getByRole('row').filter({ hasText: '(você)' });
  await expect(propria.getByRole('link', { name: 'Trocar minha senha' })).toBeVisible();
  await expect(propria.getByRole('button', { name: 'Redefinir acesso' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Redefinir acesso' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Redefinir acesso' }).click();
  const senha = await page.locator('output').innerText();
  expect(senha).toMatch(/^[a-km-np-z2-9]{4}(-[a-km-np-z2-9]{4}){3}$/);
  await page.getByRole('button', { name: /Copiar mensagem/ }).click();
  const txt = await page.evaluate(() => navigator.clipboard.readText());
  expect(txt).toContain(`Senha temporária: ${senha}`);
  expect(txt).toMatch(/Login: \S+/);
});
