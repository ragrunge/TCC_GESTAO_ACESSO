// E2E contra a API real (PGlite): desativar o cadastro de um visitante pela ficha (RF-02, spec §14 2026-10-22), sumiço
// das buscas, entrada recusada pela API, reativação a partir do "CPF já cadastrado"; e o cadastro de pessoa dentro do
// modal "Nova autorização prévia" (pessoa nova fica escolhida; CPF existente oferece "Usar o cadastro existente").
// Dados: o seed do e2e (apps/api/test/e2e/dados.ts), com CPFs fictícios.
import type { Page } from '@playwright/test';
import { expect, test, diaSP, entrarComo, toast, trocarPara } from './helpers';

/** Os mesmos CPFs fictícios do seed (cpfComDv de apps/api/src/db/seed-pessoas-dev.ts). */
function cpfComDv(base9: string): string {
  const d = [...base9].map(Number);
  const dv = (n: number[]) => { const s = n.reduce((a, x, i) => a + x * (n.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(d);
  return [...d, d1, dv([...d, d1])].join('');
}
const CPF_OSVALDO = cpfComDv('905678905');
const CPF_MARCIA = cpfComDv('901234561');
const MOTIVO = 'Visitante não frequenta mais o condomínio';

async function abrirFicha(page: Page, nome: string) {
  await page.goto('/cadastro');
  await page.getByLabel('Buscar por nome, documento ou unidade').fill(nome);
  await page.getByRole('row', { name: `Abrir ficha de ${nome}` }).click();
  return page.getByRole('dialog', { name: 'Ficha da pessoa' });
}

test.describe('Desativar cadastro de pessoa (RF-02)', () => {
  test('síndico desativa um visitante pela ficha; some das buscas, a entrada é recusada; reativa pelo CPF repetido', async ({ page }) => {
    await entrarComo(page, 'Síndico');
    const ficha = await abrirFicha(page, 'Osvaldo Brandão');
    await ficha.getByRole('button', { name: 'Desativar cadastro' }).click();

    const conf = page.getByRole('alertdialog', { name: 'Desativar cadastro' });
    const confirmar = conf.getByRole('button', { name: 'Desativar cadastro' });
    await expect(confirmar).toBeDisabled(); // motivo obrigatório (mínimo 15)
    await conf.getByLabel(/Motivo/).fill('curto');
    await expect(confirmar).toBeDisabled();
    await conf.getByLabel(/Motivo/).fill(MOTIVO);
    await confirmar.click();
    await expect(toast(page, 'Cadastro desativado')).toBeVisible();

    const fichaDepois = page.getByRole('dialog', { name: 'Ficha da pessoa' });
    await expect(fichaDepois.getByText('Desativado', { exact: true })).toBeVisible();
    await expect(fichaDepois.getByRole('status')).toContainText(MOTIVO);
    await fichaDepois.getByRole('button', { name: 'Fechar' }).click();

    // Some da lista/busca do Cadastro; volta com "Mostrar desativados", marcado
    await expect(page.getByRole('row', { name: 'Abrir ficha de Osvaldo Brandão' })).toHaveCount(0);
    await page.getByLabel('Mostrar desativados').check();
    const linha = page.getByRole('row', { name: 'Abrir ficha de Osvaldo Brandão' });
    await expect(linha).toBeVisible();
    await expect(linha.getByText('Desativado', { exact: true })).toBeVisible();

    // Porteiro: a busca da entrada não o encontra; a API recusa a entrada mesmo assim (422 PESSOA_DESATIVADA)
    await trocarPara(page, 'Porteiro');
    await page.goto('/entrada');
    const resposta = page.waitForResponse((r) => r.url().endsWith('/api/v1/pessoas/busca'));
    await page.getByRole('combobox', { name: /Buscar por nome/ }).fill('Osvaldo');
    await resposta;
    await expect(page.getByRole('option', { name: /Osvaldo/ })).toHaveCount(0);
    const ficha2 = (await (await page.request.post('/api/v1/pessoas/busca', { data: { q: 'Osvaldo', incluirDesativadas: true } })).json()).data.pessoas[0];
    const d32 = (await (await page.request.get('/api/v1/unidades/D-32')).json()).data.unidade.id;
    const entrada = await page.request.post('/api/v1/eventos-acesso', {
      data: { pessoaId: ficha2.id, unidadeDestinoId: d32, autorizadoPorTipo: 'excecao_porteiro', justificativa: 'Morador não atende, entrega urgente' },
    });
    expect(entrada.status()).toBe(422);
    expect((await entrada.json()).code).toBe('PESSOA_DESATIVADA');
    // O porteiro não pode desativar: o botão nem aparece na ficha (rota de Cadastro é de SI/AD/AU)

    // Administração: cadastrar de novo o mesmo CPF oferece "Reativar e abrir o cadastro existente"
    await trocarPara(page, 'Administração');
    await page.goto('/cadastro');
    await page.getByRole('button', { name: 'Nova pessoa' }).click();
    const nova = page.getByRole('dialog', { name: 'Nova pessoa' });
    await nova.getByLabel('Nome completo').fill('Osvaldo Brandão');
    await nova.getByRole('textbox', { name: 'CPF' }).fill(CPF_OSVALDO);
    await nova.getByLabel('Telefone (obrigatório)').fill('(11) 98765-0025');
    await nova.getByLabel('Tipo').selectOption('visitante');
    await nova.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(nova.getByRole('alert')).toContainText('cadastro está desativado');
    await nova.getByRole('button', { name: 'Reativar e abrir o cadastro existente' }).click();
    const reativada = page.getByRole('dialog', { name: 'Ficha da pessoa' });
    await expect(reativada.getByText('Osvaldo Brandão', { exact: true })).toBeVisible();
    await expect(reativada.getByText('Desativado', { exact: true })).toHaveCount(0);
    await expect(reativada.getByRole('button', { name: 'Desativar cadastro' })).toBeVisible();
    await reativada.getByRole('button', { name: 'Fechar' }).click();
    await page.getByLabel('Buscar por nome, documento ou unidade').fill('Osvaldo');
    await expect(page.getByRole('row', { name: 'Abrir ficha de Osvaldo Brandão' })).toBeVisible();
  });

  test('desativar com a pessoa dentro do condomínio: a API recusa com mensagem clara', async ({ page }) => {
    await entrarComo(page, 'Síndico');
    const ficha = await abrirFicha(page, 'Thiago Moura'); // o seed deixa o Thiago dentro
    await ficha.getByRole('button', { name: 'Desativar cadastro' }).click();
    const conf = page.getByRole('alertdialog', { name: 'Desativar cadastro' });
    await conf.getByLabel(/Motivo/).fill(MOTIVO);
    await conf.getByRole('button', { name: 'Desativar cadastro' }).click();
    await expect(conf.getByRole('alert')).toContainText('registre a saída antes de desativar');
    await conf.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('dialog', { name: 'Ficha da pessoa' })).toBeVisible();
  });
});

test.describe('Nova autorização prévia: cadastrar a pessoa sem sair do modal', () => {
  test('visitante novo fica escolhido; CPF já cadastrado oferece "Usar o cadastro existente"', async ({ page }) => {
    await entrarComo(page, 'Porteiro');
    await page.goto('/unidades/D-32');
    await page.getByRole('button', { name: 'Nova autorização prévia' }).click();
    const modal = page.getByRole('dialog', { name: 'Nova autorização prévia' });
    // Só letras: texto com dígito é tratado como CPF pelo seletor e não pré-preenche o nome.
    const sufixo = Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
    const nome = `Visitante Novo ${sufixo}`;
    await modal.getByLabel('Pessoa autorizada').fill(nome);
    await modal.getByRole('button', { name: 'Cadastrar nova pessoa' }).click();

    const nova = page.getByRole('dialog', { name: 'Nova pessoa' });
    await expect(nova.getByLabel('Tipo')).toHaveValue('visitante');
    await expect(nova.getByLabel('Nome completo')).toHaveValue(nome);
    // CPF repetido (Márcia, do seed): 409 com "Usar o cadastro existente", que a escolhe no seletor
    await nova.getByRole('textbox', { name: 'CPF' }).fill(CPF_MARCIA);
    await nova.getByLabel('Telefone (obrigatório)').fill('(11) 98888-0001');
    await nova.getByRole('button', { name: 'Cadastrar e escolher' }).click();
    await expect(nova.getByRole('alert')).toContainText('Já existe cadastro com este CPF');
    await nova.getByRole('button', { name: 'Usar o cadastro existente' }).click();
    const prev = page.getByRole('dialog', { name: 'Nova autorização prévia' });
    await expect(prev.getByText('Márcia Pereira', { exact: true })).toBeVisible();

    // Troca e cadastra uma pessoa nova de verdade: fica escolhida e a autorização sai
    await prev.getByRole('button', { name: 'Trocar pessoa' }).click();
    await prev.getByLabel('Pessoa autorizada').fill(nome);
    await prev.getByRole('button', { name: 'Cadastrar nova pessoa' }).click();
    const nova2 = page.getByRole('dialog', { name: 'Nova pessoa' });
    await nova2.getByRole('textbox', { name: 'CPF' }).fill(cpfComDv(String(100_000_000 + Math.floor(Math.random() * 800_000_000))));
    await nova2.getByLabel('Telefone (obrigatório)').fill('(11) 98888-0002');
    await nova2.getByRole('button', { name: 'Cadastrar e escolher' }).click();
    const prev2 = page.getByRole('dialog', { name: 'Nova autorização prévia' });
    await expect(prev2.getByText(nome, { exact: true })).toBeVisible();
    await prev2.getByLabel(/Válida até/).fill(diaSP(5));
    await prev2.getByLabel(/Justificativa \(obrigatória sem morador solicitante/).fill('Pedido feito por telefone, morador viajando');
    await prev2.getByRole('button', { name: 'Cadastrar autorização' }).click();
    await expect(toast(page, 'Autorização prévia cadastrada.')).toBeVisible();
  });
});
