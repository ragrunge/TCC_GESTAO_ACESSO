// Lote B2: telas novas do MVP (funcionários, CRUD de unidades, legados, ficha com LGPD, papéis, retirada autorizada,
// prestador em área comum). Cada teste parte do seed limpo (contexto de navegador novo).
import { expect, test, type Page } from '@playwright/test';
import {
  botaoConfirmarEntrada, entrarComo, escolherMeio, escolherPessoa, filtrarHistoricoPorPessoa, linhaEvento, toast, trocarPara,
} from './helpers';

/** Abre a ficha da pessoa pela busca global do topo. */
async function abrirFicha(page: Page, nome: string) {
  await page.getByLabel('Buscar por nome, documento, unidade ou placa').fill(nome);
  await page.getByRole('listbox', { name: 'Resultados da busca' }).getByRole('option', { name: new RegExp(nome) }).first().click();
  const ficha = page.getByRole('dialog', { name: 'Ficha da pessoa' });
  await expect(ficha.getByText(nome, { exact: true })).toBeVisible();
  return ficha;
}

test.describe('10. Lote B2', () => {
  test('RF-09: administração cadastra funcionário com escala noturna; porteiro não vê a tela', async ({ page }) => {
    await entrarComo(page, 'Administração');
    await page.getByRole('navigation', { name: 'Administração' }).getByRole('link', { name: 'Funcionários' }).click();
    await expect(page).toHaveURL(/\/funcionarios$/);
    await expect(page.getByRole('table', { name: 'Funcionários do condomínio' }).getByText('Válter Souza')).toBeVisible();

    await page.getByRole('button', { name: 'Novo funcionário' }).click();
    const modal = page.getByRole('dialog', { name: 'Novo funcionário' });
    await modal.getByLabel('Nome completo').fill('Nilo Vigia');
    await modal.getByLabel('CPF').fill('529.982.247-25');
    await modal.getByLabel('Telefone').fill('(11) 97777-6666');
    await modal.getByLabel('Função').fill('Vigia noturno');
    await modal.getByLabel('Início do turno').fill('22:00');
    await modal.getByLabel('Fim do turno').fill('06:00');
    await expect(modal.getByText(/Atravessa a meia-noite/)).toBeVisible();
    await modal.getByRole('button', { name: 'Cadastrar funcionário' }).click();
    await expect(toast(page, 'Nilo Vigia cadastrado(a) como Vigia noturno.')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Funcionários do condomínio' }).getByText(/seg a sex, 22h–6h \(atravessa a meia-noite\)/)).toBeVisible();

    await trocarPara(page, 'Porteiro');
    await expect(page.getByRole('link', { name: 'Funcionários' })).toHaveCount(0);
  });

  test('RF-01: cria unidade nova, desativa e reativa; auditor só consulta', async ({ page }) => {
    await entrarComo(page, 'Administração');
    await page.goto('/unidades');
    await page.getByRole('button', { name: 'Nova unidade' }).click();
    const modal = page.getByRole('dialog', { name: 'Nova unidade' });
    await modal.getByLabel('Torre').fill('10');
    await modal.getByLabel('Apartamento').fill('101');
    await modal.getByRole('button', { name: 'Cadastrar unidade' }).click();
    await expect(toast(page, 'Unidade T10-101 cadastrada.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Torre 10 · Apartamento 101' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Torre' }).getByRole('radio', { name: '10' })).toBeVisible();

    await page.getByRole('button', { name: 'Desativar unidade' }).click();
    await expect(toast(page, /Unidade T10-101 desativada/)).toBeVisible();
    await expect(page.getByText(/Unidade desativada: não aparece para nova entrada/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Solicitar vínculo' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Reativar unidade' }).click();
    await expect(toast(page, 'Unidade T10-101 reativada.')).toBeVisible();

    // Unidade com histórico não muda de número
    await page.goto('/unidades/T4-32');
    await page.getByRole('button', { name: 'Editar número' }).click();
    const ed = page.getByRole('dialog', { name: 'Editar número da unidade' });
    await ed.getByLabel('Apartamento').fill('99');
    await ed.getByRole('button', { name: 'Salvar' }).click();
    await expect(ed.getByRole('alert')).toContainText('já tem registros');

    await page.keyboard.press('Escape');
    await trocarPara(page, 'Auditor');
    await page.goto('/unidades/T4-32');
    await expect(page.getByRole('heading', { name: 'Torre 4 · Apartamento 32' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova unidade' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Desativar unidade' })).toHaveCount(0);
  });

  test('RN-09: lista de legados e regularização de legado com cadastro completo', async ({ page }) => {
    await entrarComo(page, 'Administração');
    await page.goto('/vinculos');
    await page.getByRole('tab', { name: /Legados/ }).click();
    await expect(page.getByText(/Importados da planilha \(RN-09\)/)).toBeVisible();
    await page.getByRole('list', { name: 'Fila' }).getByRole('button', { name: /Lúcia Ribeiro/ }).click();
    await expect(page.getByText(/Legado válido até 31\/03\/2027/)).toBeVisible();
    // RN-09 + RF-05: regularizar exige a conferência do comprovante
    await page.getByLabel('Tipo do documento conferido').selectOption({ label: 'Outro' });
    await page.getByLabel('Descrição do documento').fill('Certidão de nascimento');
    await page.getByLabel('Conferi o comprovante apresentado').check();
    await page.getByRole('button', { name: 'Registrar conferência' }).click();
    await page.getByRole('button', { name: 'Regularizar', exact: true }).click();
    await expect(toast(page, /Vínculo legado de Lúcia Ribeiro \(T4-32\) regularizado/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Fila' }).getByRole('button', { name: /Lúcia Ribeiro/ })).toHaveCount(0);
  });

  test('ficha: administração corrige o cadastro e exporta os dados (LGPD); síndico anonimiza', async ({ page }) => {
    await entrarComo(page, 'Administração');
    let ficha = await abrirFicha(page, 'Marcos Pereira');
    await ficha.getByRole('button', { name: 'Editar cadastro' }).click();
    await ficha.getByRole('form', { name: 'Editar cadastro' }).getByLabel('Telefone').fill('(11) 93333-2222');
    await ficha.getByRole('button', { name: 'Salvar correção' }).click();
    await expect(toast(page, /Cadastro atualizado/)).toBeVisible();
    await expect(ficha.getByText(/\(11\) 93333-2222/)).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), ficha.getByRole('button', { name: 'Exportar dados (LGPD)' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^lgpd-.*\.json$/);
    await expect(ficha.getByRole('button', { name: 'Anonimizar…' })).toHaveCount(0); // só o síndico
    await ficha.getByRole('button', { name: 'Fechar' }).click();

    await trocarPara(page, 'Síndico');
    ficha = await abrirFicha(page, 'Osvaldo Brandão');
    await ficha.getByRole('button', { name: 'Anonimizar…' }).click();
    await ficha.getByRole('button', { name: 'Confirmar anonimização' }).click();
    await expect(toast(page, /Pessoa anonimizada/)).toBeVisible();
    await expect(ficha.getByText('Pessoa anonimizada', { exact: true })).toBeVisible();
    await expect(ficha.getByText('O que fica retido')).toBeVisible();
  });

  test('RF-33: administração altera papel de usuário, mas não mexe no síndico', async ({ page }) => {
    await entrarComo(page, 'Administração');
    await page.getByRole('link', { name: 'Usuários' }).click();
    await expect(page).toHaveURL(/\/usuarios$/);
    await page.getByLabel('Papel de Marina Couto').selectOption({ label: 'Auditor' });
    await expect(toast(page, 'Marina Couto agora é Auditor.')).toBeVisible();
    await expect(page.getByLabel('Papel de Marina Couto').locator('option', { hasText: 'Síndico' })).toHaveCount(0);
    const linhaSindico = page.getByRole('row').filter({ hasText: 'Roberto Faria' });
    await expect(linhaSindico.getByText('Só o síndico gerencia')).toBeVisible();
    await expect(page.getByLabel('Papel de Paula Nogueira')).toHaveCount(0); // o próprio papel
  });

  test('RN-08: morador autoriza outra pessoa a retirar a encomenda; o porteiro entrega a ela', async ({ page }) => {
    await entrarComo(page, 'Porteiro');
    await page.goto('/encomendas');
    await page.getByRole('button', { name: 'Autorizar retirada da encomenda K108' }).click();
    const modal = page.getByRole('dialog', { name: 'Autorizar retirada da encomenda K108' });
    await modal.getByLabel(/Morador que autoriza/).selectOption({ label: 'Ana Ribeiro (Proprietário)' });
    await modal.getByLabel('Quem vai retirar (cadastro com CPF)').fill('Marcos Pereira');
    await modal.getByRole('button', { name: /Marcos Pereira/ }).click();
    await modal.getByRole('button', { name: 'Autorizar retirada' }).click();
    await expect(toast(page, 'Marcos Pereira autorizado(a) a retirar a encomenda K108.')).toBeVisible();

    await page.getByRole('button', { name: 'Entregar encomenda K108' }).click();
    const entregar = page.getByRole('dialog', { name: 'Entregar encomenda K108' });
    await entregar.getByLabel('Quem está retirando?').fill('Marcos Pereira');
    await entregar.getByRole('button', { name: /Marcos Pereira/ }).click();
    await expect(entregar.getByText(/Autorizado\(a\) a retirar por Ana Ribeiro/)).toBeVisible();
    await entregar.getByRole('button', { name: /Confirmar entrega/ }).click();
    await expect(toast(page, 'Encomenda K108 entregue a Marcos Pereira.')).toBeVisible();
    await page.getByRole('tab', { name: /Entregues/ }).click();
    await expect(page.getByText('Marcos Pereira (autorizado por Ana Ribeiro)')).toBeVisible();
  });

  test('RF-36: prestador entra em área comum por exceção; o histórico mostra a área', async ({ page }) => {
    await entrarComo(page, 'Porteiro');
    await page.goto('/entrada');
    await escolherPessoa(page, 'Adriano Melo');
    await page.getByRole('radiogroup', { name: 'Destino do prestador' }).getByRole('radio', { name: 'Área comum' }).click();
    await page.getByRole('radiogroup', { name: 'Área comum' }).getByRole('radio', { name: 'Piscina' }).click();
    // Na área comum não há interfone nem morador presente
    await expect(page.getByRole('group', { name: 'Meio de autorização' }).getByText('Interfone', { exact: true })).toHaveCount(0);
    await escolherMeio(page, 'Exceção do porteiro');
    await page.getByLabel(/Justificativa \(obrigatória/).fill('Manutenção da bomba da piscina combinada com o zelador');
    await botaoConfirmarEntrada(page).click();
    await expect(toast(page, /Entrada registrada/).first()).toBeVisible();
    await filtrarHistoricoPorPessoa(page, 'Adriano Melo');
    await expect(linhaEvento(page, 'Adriano Melo', 'Piscina')).toHaveCount(1);
  });
});
