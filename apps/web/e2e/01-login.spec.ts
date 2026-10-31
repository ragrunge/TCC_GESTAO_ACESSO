import { NOME_PERFIL, ROTA_INICIAL, LOGIN_PERFIL, entrarComo, expect, preencherLogin, test, type Perfil } from './helpers';

test.describe('1. Login', () => {
  const perfis: Perfil[] = ['Porteiro', 'Administração', 'Síndico', 'Auditor'];

  for (const perfil of perfis) {
    test(`${perfil} entra com usuário e senha, sem etapa de 2FA, e cai na rota inicial`, async ({ page }) => {
      await preencherLogin(page, LOGIN_PERFIL[perfil]);

      // Sem 2FA: não aparece nenhum campo de código/token em nenhum momento do fluxo
      await expect(page).toHaveURL(ROTA_INICIAL[perfil]);
      await expect(page.getByLabel(/c[óo]digo|token|2FA|verifica[çc][ãa]o/i)).toHaveCount(0);

      // Já autenticado: usuário e papel aparecem no cabeçalho
      await expect(page.getByText(NOME_PERFIL[perfil], { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
    });
  }

  test('tela de login sem atalhos de demonstração; senha errada é recusada; a sessão sobrevive a recarregar', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Usuário')).toHaveValue('');
    await expect(page.getByLabel('Senha', { exact: true })).toHaveValue('');
    await expect(page.getByText('Perfil de demonstração')).toHaveCount(0);
    await expect(page.getByText(/qualquer senha/i)).toHaveCount(0);
    await expect(page.getByText(/dados fictícios/i)).toHaveCount(0);

    await preencherLogin(page, 'joao.lima', 'qualquer-coisa-123');
    await expect(page.getByRole('alert')).toHaveText('Usuário ou senha inválidos.');
    await expect(page).toHaveURL(/\/login$/);

    await entrarComo(page, 'Porteiro');
    await page.reload();
    await expect(page).toHaveURL(/\/painel$/);
  });

  test('usuário inexistente mostra erro e fica na tela de login', async ({ page }) => {
    await preencherLogin(page, 'fulano.inexistente');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('rota protegida sem sessão redireciona ao login; sair encerra a sessão', async ({ page }) => {
    await page.goto('/historico');
    await expect(page).toHaveURL(/\/login$/);
    await entrarComo(page, 'Porteiro');
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
  });
});

test.describe('1b. Passar turno', () => {
  test('logout que falha não dá o turno por passado: o modal fica aberto, a sessão segue e a nova tentativa sai', async ({ page }) => {
    await entrarComo(page, 'Porteiro');
    await page.getByRole('button', { name: 'Passar turno' }).click();
    const modal = page.getByRole('dialog', { name: 'Passar turno' });

    await page.route('**/auth/logout', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"INDISPONIVEL","message":"x"}' }));
    await modal.getByRole('button', { name: 'Confirmar passagem de turno' }).click();
    await expect(page.getByText('Não foi possível encerrar a sessão. Verifique a conexão e tente de novo.')).toBeVisible();
    await expect(modal).toBeVisible();
    await expect(page).not.toHaveURL(/\/login$/);

    await page.unroute('**/auth/logout');
    await modal.getByRole('button', { name: 'Confirmar passagem de turno' }).click();
    await expect(page).toHaveURL(/\/login$/);
    // A sessão acabou no servidor: recarregar não traz o operador anterior de volta
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Sair', exact: true })).toHaveCount(0);
  });
});
