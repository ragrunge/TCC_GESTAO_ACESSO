import { expect, test } from '@playwright/test';
import { entrarComo, sair } from './helpers';

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
  await expect(page.getByRole('dialog')).toContainText(/Válida até \d{2}\/\d{2} às \d{2}:\d{2}/);
  await page.getByRole('button', { name: /Copiar mensagem/ }).click();
  const txt = await page.evaluate(() => navigator.clipboard.readText());
  expect(txt).toContain(`Senha temporária: ${senha}`);
  expect(txt).toMatch(/Login: \S+/);
  expect(txt).toMatch(/\nVálida até \d{2}\/\d{2} às \d{2}:\d{2}\n/);
});

test('usuários: senha temporária vence em 72 h: aviso na lista e recusa no login', async ({ page }) => {
  await entrarComo(page, 'Síndico');
  await page.goto('/usuarios');
  const linha = page.getByRole('row').filter({ hasText: 'joao.lima' });
  await expect(linha).not.toContainText('Senha temporária');
  await linha.getByRole('button', { name: 'Redefinir acesso' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Redefinir acesso' }).click();
  await expect(page.getByRole('dialog')).toContainText(/Válida até \d{2}\/\d{2} às \d{2}:\d{2}/);
  await page.getByRole('button', { name: 'Já copiei, fechar' }).click();
  await expect(linha).toContainText(/Senha temporária vence em \d{2}\/\d{2} \d{2}:\d{2}/);

  // Relógio simulado + 73 h: o mock retoma o relógio de `salvoEm` ao recarregar.
  await page.evaluate(() => {
    const k = 'portaria-parque:db:v1';
    const d = JSON.parse(localStorage.getItem(k)!) as { salvoEm: number };
    d.salvoEm += 73 * 3600 * 1000;
    localStorage.setItem(k, JSON.stringify(d));
  });
  await page.reload();
  await expect(linha).toContainText('Senha temporária vencida — redefina');

  await sair(page);
  await page.getByLabel('Usuário').fill('joao.lima');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Senha temporária vencida. Peça a redefinição à administração.');
  await expect(page).toHaveURL(/\/login$/);
});
