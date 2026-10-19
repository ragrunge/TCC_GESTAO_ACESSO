import { expect, test } from '@playwright/test';
import {
  botaoConfirmarEntrada, entrarComo, escolherMeio, escolherMorador, escolherPessoa, escolherUnidade, filtrarHistoricoPorPessoa,
  linhaEvento, toast, trocarPara,
} from './helpers';

test.describe('2. Entrada pelo porteiro (/entrada)', () => {
  test.beforeEach(async ({ page }) => {
    await entrarComo(page, 'Porteiro');
    await page.goto('/entrada');
  });

  test('interfone com morador escolhido: "Entrada registrada" e evento no histórico com "autorizado por"', async ({ page }) => {
    await escolherPessoa(page, 'Márcia Pereira');
    await escolherUnidade(page, 'D-32');
    await escolherMeio(page, 'Interfone');
    await escolherMorador(page, 'Ana Ribeiro');
    await expect(page.getByText('Falta:')).toHaveCount(0);

    await botaoConfirmarEntrada(page).click();
    await expect(toast(page, 'Entrada registrada').first()).toBeVisible();
    await expect(page).toHaveURL(/\/painel$/);

    await filtrarHistoricoPorPessoa(page, 'Márcia Pereira');
    const linha = linhaEvento(page, 'Márcia Pereira', 'D-32');
    await expect(linha).toHaveCount(1);
    await expect(linha).toContainText('Interfone');
    await expect(linha).toContainText('Ana Ribeiro'); // quem autorizou
    await expect(linha).toContainText('João Lima'); // quem registrou

    // Detalhe do evento: "Autorizado por"
    await linha.click();
    await expect(page.getByText(/Autorizado por/i).first()).toBeVisible();
    await expect(page.getByText('Ana Ribeiro').first()).toBeVisible();
  });

  test('exceção do porteiro exige justificativa de pelo menos 15 caracteres e aparece como "Exceção"', async ({ page }) => {
    await escolherPessoa(page, 'Márcia Pereira');
    await escolherUnidade(page, 'D-32');
    await escolherMeio(page, 'Exceção do porteiro');

    const just = page.getByLabel(/Justificativa \(obrigatória/);
    // Antes de justificar: botão desabilitado e a falta é informada
    await expect(page.getByRole('button', { name: 'Confirmar entrada', exact: true })).toBeDisabled();
    await expect(page.getByText(/Falta:.*justificativa/)).toBeVisible();

    // 14 caracteres: ainda desabilitado
    await just.fill('12345678901234');
    await expect(page.getByText('14 de 15 caracteres')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar entrada', exact: true })).toBeDisabled();

    // 15 caracteres: habilita
    await just.fill('123456789012345');
    await expect(botaoConfirmarEntrada(page)).toBeEnabled();
    await just.fill('Morador não atende o interfone');
    await botaoConfirmarEntrada(page).click();

    await expect(toast(page, 'Entrada registrada').first()).toBeVisible();
    await filtrarHistoricoPorPessoa(page, 'Márcia Pereira');
    const linha = linhaEvento(page, 'Márcia Pereira');
    await expect(linha).toHaveCount(1);
    await expect(linha).toContainText('Exceção');

    // Também aparece no filtro "Somente exceções"
    await page.getByLabel('Pessoa', { exact: true }).fill('');
    await page.getByLabel('Somente exceções').check();
    await expect(linhaEvento(page, 'Márcia Pereira')).toHaveCount(1);
  });

  test('"Morador recusou" grava evento "Recusado" e o histórico mostra "Recusado por …"', async ({ page }) => {
    await escolherPessoa(page, 'Márcia Pereira');
    await escolherUnidade(page, 'D-32');
    await escolherMeio(page, 'Interfone');
    await escolherMorador(page, 'Ana Ribeiro');
    await page.getByRole('button', { name: 'Morador recusou' }).click();

    await expect(toast(page, 'Recusa registrada')).toBeVisible();
    // Nenhuma entrada foi criada: a tela volta ao passo 1
    await expect(page.getByRole('combobox', { name: /Buscar por nome/ })).toBeVisible();

    await filtrarHistoricoPorPessoa(page, 'Márcia Pereira');
    const linha = linhaEvento(page, 'Márcia Pereira');
    await expect(linha).toHaveCount(1);
    await expect(linha).toContainText('Recusado');
    await expect(linha).toContainText('Recusado por Ana Ribeiro');
  });

  test('pessoa com vínculo pendente (Rodrigo Alves) aparece na busca como Visitante', async ({ page }) => {
    await page.getByRole('combobox', { name: /Buscar por nome/ }).fill('Rodrigo Alves');
    const opcao = page.getByRole('option', { name: /Rodrigo Alves/ });
    await expect(opcao).toBeVisible();
    await expect(opcao).toContainText('Visitante');
    await expect(opcao).not.toContainText('Morador');
  });

  test('pessoa com restrição: modal "Entrada não permitida" e cancelar grava UM único evento negado', async ({ page }) => {
    // Seed: Bruno Teixeira tem restrição na D-32 e já possui 1 evento "Negado" (08/10)
    await filtrarHistoricoPorPessoa(page, 'Bruno Teixeira');
    await expect(linhaEvento(page, 'Bruno Teixeira', 'Negado')).toHaveCount(1);
    const negadosAntes = 1;

    await page.goto('/entrada');
    await escolherPessoa(page, 'Bruno Teixeira');
    await escolherUnidade(page, 'D-32');

    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Entrada não permitida para D-32');
    await expect(modal).toContainText('Morador não autoriza a entrada');
    // Não existe opção de liberar: só registrar ocorrência ou cancelar
    await expect(modal.getByRole('button')).toHaveText([/Registrar ocorrência/, /Cancelar/]);

    await modal.getByRole('button', { name: /Cancelar/ }).click();
    await expect(toast(page, 'Entrada negada')).toBeVisible();
    await expect(modal).toBeHidden();

    // Histórico: exatamente um novo "Negado" (não duplicou)
    await filtrarHistoricoPorPessoa(page, 'Bruno Teixeira');
    await expect(linhaEvento(page, 'Bruno Teixeira', 'Negado')).toHaveCount(negadosAntes + 1);
  });

  test('Rodrigo Alves (vínculo pendente) não consegue autorizar como morador na própria unidade', async ({ page }) => {
    // Vínculo pendente não dá acesso de morador: I-13 só lista a moradora aprovada (Marta Siqueira)
    await escolherPessoa(page, 'Márcia Pereira');
    await escolherUnidade(page, 'I-13');
    await escolherMeio(page, 'Interfone');
    const grupo = page.getByRole('radiogroup', { name: /Morador que autorizou/ });
    await expect(grupo.getByText('Marta Siqueira', { exact: true })).toBeVisible();
    await expect(grupo.getByText('Rodrigo Alves')).toHaveCount(0);
  });
});

test.describe('2b. Funcionário com restrição de condomínio', () => {
  test('restrição do condomínio criada pelo síndico bloqueia o funcionário sem escolher unidade', async ({ page }) => {
    // 1) Síndico cadastra a restrição (a UI só cria restrição a partir da tela de uma unidade;
    //    o escopo "todo o condomínio" fica pendente até o síndico aprovar — RN-06)
    await entrarComo(page, 'Síndico');
    await page.goto('/unidades/D-32');
    await page.getByRole('button', { name: 'Nova restrição' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Pessoa que não pode entrar').fill('Válter');
    await form.getByRole('button', { name: /Válter Souza/ }).click();
    await form.getByLabel(/Morador que pediu a restrição/).selectOption({ label: 'Ana Ribeiro' });
    await form.getByLabel('Motivo').fill('Conduta incompatível com a função');
    await form.getByLabel(/Vale até/).fill('2026-12-31');
    await form.getByLabel(/Pedir restrição para todo o condomínio/).check();
    await form.getByRole('button', { name: 'Cadastrar restrição' }).click();
    await expect(toast(page, /Pedido de restrição para todo o condomínio registrado/)).toBeVisible();

    // 2) Síndico aprova no painel (RN-06: só o síndico aprova)
    await page.goto('/painel');
    // (o seed já traz um pedido pendente de Edu Barreto: aprova só o do Válter)
    const pendencias = page.getByRole('region', { name: 'Pendências do síndico' });
    await pendencias.locator('div', { hasText: 'Válter Souza' }).getByRole('button', { name: 'Aprovar' }).last().click();
    await expect(toast(page, 'Restrição para todo o condomínio aprovada.')).toBeVisible();

    // 3) Porteiro tenta registrar a entrada do funcionário: modal "no condomínio", sem unidade
    await trocarPara(page, 'Porteiro');
    await page.goto('/entrada');
    await escolherPessoa(page, 'Válter Souza');
    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Entrada não permitida no condomínio');
    await expect(modal).toContainText('Restrição para todo o condomínio');
    await expect(modal).toContainText('Conduta incompatível com a função');

    await modal.getByRole('button', { name: /Cancelar/ }).click();
    await expect(toast(page, /não entrou no condomínio/)).toBeVisible();

    await filtrarHistoricoPorPessoa(page, 'Válter Souza');
    const negados = linhaEvento(page, 'Válter Souza', 'Negado');
    await expect(negados).toHaveCount(1);
  });
});
