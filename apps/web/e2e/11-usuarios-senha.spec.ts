import { API_E2E, expect, preencherLogin, test, entrarComo, sair } from './helpers';

test('usuários: redefinir acesso: formato, copiar mensagem, linha própria', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await entrarComo(page, 'Síndico');
  await page.goto('/usuarios');
  const propria = page.getByRole('row').filter({ hasText: '(você)' });
  await expect(propria.getByRole('link', { name: 'Trocar minha senha' })).toBeVisible();
  await expect(propria.getByRole('button', { name: 'Nova senha temporária' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Nova senha temporária' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Gerar senha temporária' }).click();
  const senha = await page.locator('output').innerText();
  expect(senha).toMatch(/^[a-km-np-z2-9]{4}(-[a-km-np-z2-9]{4}){3}$/);
  await expect(page.getByRole('dialog')).toContainText(/Válida até \d{2}\/\d{2} às \d{2}:\d{2}/);
  await page.getByRole('button', { name: /Copiar mensagem/ }).click();
  const txt = await page.evaluate(() => navigator.clipboard.readText());
  expect(txt).toContain(`Senha temporária: ${senha}`);
  expect(txt).toMatch(/Login: \S+/);
  expect(txt).toMatch(/\nVálida até \d{2}\/\d{2} às \d{2}:\d{2}\n/);
});

test('usuários: senha temporária vence em 72 h: aviso na lista e recusa no login', async ({ page, request }) => {
  await entrarComo(page, 'Síndico');
  await page.goto('/usuarios');
  const linha = page.getByRole('row').filter({ hasText: 'joao.lima' });
  await expect(linha).not.toContainText('Senha temporária');
  await linha.getByRole('button', { name: 'Nova senha temporária' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Gerar senha temporária' }).click();
  await expect(page.getByRole('dialog')).toContainText(/Válida até \d{2}\/\d{2} às \d{2}:\d{2}/);
  const temporaria = (await page.locator('output').innerText()).trim();
  await page.getByRole('button', { name: 'Já copiei, fechar' }).click();
  await expect(linha).toContainText(/Senha temporária\s*Vence em \d{2}\/\d{2} \d{2}:\d{2}/);

  // Sem esperar 72 h: o prazo da senha temporária do João vai para o passado, direto no banco de teste (rota que só
  // existe no servidor de e2e). A tela e a API comparam com a hora real.
  expect((await request.post(`${API_E2E}/__e2e/vencer-senha-temporaria`, { data: { login: 'joao.lima' } })).ok()).toBe(true);
  await page.reload();
  await expect(linha).toContainText('Senha vencida');
  await expect(linha).toContainText('Gere uma nova senha temporária');

  // Com a senha temporária CERTA a API diz que venceu (com a errada, só "usuário ou senha inválidos").
  await sair(page);
  await preencherLogin(page, 'joao.lima', temporaria);
  await expect(page.getByRole('alert')).toContainText('Senha temporária vencida. Peça a redefinição à administração.');
  await expect(page).toHaveURL(/\/login$/);
});
