// Unidades (RF-01), catálogo, contagem de vínculos e busca (RF-18, RF-34) pela API real (HTTP + PGlite + migrações).
// Dados: seed de estrutura (165 unidades) + usuários + pessoas fictícias do seed de dev (as mesmas do Docker).
import { MATRIZ, pode, type Acao } from '@portaria/domain/rbac';
import type { Papel } from '@portaria/domain/types';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as s from '../src/db/schema';
import { cpfComDv, seedPessoasDev } from '../src/db/seed-pessoas-dev';
import { UnidadesService } from '../src/unidades/unidades.service';
import { type ApiDeTeste, LOGINS, novaApi, type PapelTeste, trilha } from './helpers/app';
import { CHAVE_HMAC_TESTE } from './helpers/banco';

const V1 = '/api/v1';
const CPF_ANA = cpfComDv('529982247'); // 52998224725 (fictício, do seed de dev)
const PAPEIS: PapelTeste[] = ['sindico', 'administracao', 'porteiro', 'auditor'];

let api: ApiDeTeste;
const cookies = {} as Record<PapelTeste, string>;

beforeAll(async () => {
  api = await novaApi();
  await seedPessoasDev(api.db, { chaveHmac: CHAVE_HMAC_TESTE, agora: api.relogio.agora() });
  for (const p of PAPEIS) cookies[p] = (await api.como(p)).cookie;
});
afterAll(async () => { await api.app.close(); await api.client.close(); });

const get = (papel: PapelTeste, url: string) => api.http().get(`${V1}${url}`).set('Cookie', cookies[papel]);
const post = (papel: PapelTeste, url: string, corpo?: object) => api.http().post(`${V1}${url}`).set('Cookie', cookies[papel]).send(corpo);
const patch = (papel: PapelTeste, url: string, corpo: object) => api.http().patch(`${V1}${url}`).set('Cookie', cookies[papel]).send(corpo);

async function idDe(codigo: string) {
  const m = /^T(\d+)-(\d+)$/.exec(codigo)!;
  const [u] = await api.db.select().from(s.unidade).where(and(eq(s.unidade.torre, Number(m[1])), eq(s.unidade.numero, m[2]!)));
  return u!.id;
}
const nomes = (r: { body: { data: { pessoas: { nome: string }[] } } }) => r.body.data.pessoas.map((p) => p.nome);

describe('seed de dev (pessoas fictícias)', () => {
  it('é idempotente: rodar de novo não cria nada nem duplica', async () => {
    const antes = (await api.db.select({ n: count() }).from(s.pessoa))[0]!.n;
    expect(await seedPessoasDev(api.db, { chaveHmac: CHAVE_HMAC_TESTE, agora: api.relogio.agora() })).toEqual([]);
    expect((await api.db.select({ n: count() }).from(s.pessoa))[0]!.n).toBe(antes);
  });

  it('CPF válido, guardado só como máscara + HMAC', async () => {
    expect(CPF_ANA).toBe('52998224725');
    const [ana] = await api.db.select().from(s.pessoa).where(eq(s.pessoa.nome, 'Ana Ribeiro'));
    expect(ana!.documentoMascarado).toBe('***.982.247-**');
    expect(ana!.documentoBusca).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(ana)).not.toContain(CPF_ANA);
  });
});

describe('catálogo', () => {
  it('qualquer papel logado recebe as 165 unidades (com código e rótulo), as áreas comuns e a portaria', async () => {
    for (const p of PAPEIS) {
      const r = await get(p, '/catalogo');
      expect(r.status).toBe(200);
      expect(r.body.data.unidades).toHaveLength(165);
      expect(r.body.data.areasComuns.map((a: { nome: string }) => a.nome)).toContain('Salão de festas');
      expect(r.body.data.pontosAcesso).toEqual([expect.objectContaining({ nome: 'Portaria social', ativo: true })]);
    }
    const r = await get('porteiro', '/catalogo');
    expect(r.body.data.unidades[0]).toEqual({ id: expect.any(String), torre: 1, numero: '11', ativo: true, codigo: 'T1-11', rotulo: 'Torre 1 · AP 11' });
    expect(r.body.data.unidades.at(-1)).toMatchObject({ codigo: 'T9-15' });
  });

  it('sem sessão: 401', async () => {
    expect((await api.http().get(`${V1}/catalogo`)).status).toBe(401);
  });
});

describe('unidades: listagem paginada com resumo', () => {
  it('percorre as 165 por cursor sem repetir nem pular, na ordem torre/número, mesmo com INSERT no meio', async () => {
    const vistos: string[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const r = await get('porteiro', `/unidades?limite=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(r.status).toBe(200);
      vistos.push(...r.body.data.map((x: { unidade: { torre: number; numero: string } }) => `T${x.unidade.torre}-${x.unidade.numero}`));
      cursor = r.body.pagination.cursor;
      expect(r.body.pagination.hasNextPage).toBe(cursor !== null);
      // Depois da 1ª página, entra uma unidade que ordena ANTES do cursor: keyset não a repete nem desloca as outras.
      if (++paginas === 1) await api.db.insert(s.unidade).values({ torre: 1, numero: '1' });
    } while (cursor);
    expect(vistos).toHaveLength(165);
    expect(new Set(vistos).size).toBe(165);
    expect(vistos.slice(0, 3)).toEqual(['T1-11', 'T1-12', 'T1-13']);
    expect(vistos.at(-1)).toBe('T9-15');
    await api.db.delete(s.unidade).where(and(eq(s.unidade.torre, 1), eq(s.unidade.numero, '1')));
  });

  it('filtro por torre e resumo igual ao do mock', async () => {
    const r = await get('auditor', '/unidades?torre=4');
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(20);
    expect(r.body.pagination).toEqual({ cursor: null, hasNextPage: false });
    const t432 = r.body.data.find((x: { unidade: { numero: string } }) => x.unidade.numero === '32');
    expect(t432).toMatchObject({ moradoresValidos: 3, pendentes: 0, restricoes: 0, cadastroCompleto: true }); // 2 aprovados + 1 legado
    const t7 = (await get('auditor', '/unidades?torre=7')).body.data.find((x: { unidade: { numero: string } }) => x.unidade.numero === '11');
    expect(t7).toMatchObject({ moradoresValidos: 1, pendentes: 1, cadastroCompleto: true });
    const t3 = (await get('auditor', '/unidades?torre=3')).body.data.find((x: { unidade: { numero: string } }) => x.unidade.numero === '42');
    expect(t3).toMatchObject({ moradoresValidos: 1, pendentes: 1, cadastroCompleto: false }); // só legado: não é cadastro completo
  });

  it('cursor adulterado e parâmetro desconhecido: 400', async () => {
    expect((await get('porteiro', '/unidades?cursor=xyz')).body.code).toBe('CURSOR_INVALIDO');
    expect((await get('porteiro', '/unidades?ordem=numero')).status).toBe(400);
    expect((await get('porteiro', '/unidades?limite=101')).status).toBe(400);
  });

  it('detalhe por uuid ou pelo código legível; veículos ativos da unidade', async () => {
    const id = await idDe('T4-32');
    const r = await get('porteiro', `/unidades/${id}`);
    expect(r.status).toBe(200);
    expect(r.body.data.unidade).toEqual({ id, torre: 4, numero: '32', ativo: true });
    expect(r.body.data.veiculos.map((v: { placa: string }) => v.placa)).toEqual(['FKR2C41', 'GHT8J20']);
    expect((await get('porteiro', '/unidades/T4-32')).body.data.unidade.id).toBe(id);
    expect((await get('porteiro', '/unidades/T99-1')).body.code).toBe('UNIDADE_NAO_ENCONTRADA');
  });
});

describe('RBAC pela MATRIZ (403 por papel)', () => {
  const rotas: { acao: Acao | 'autenticado'; chamar: (p: PapelTeste) => Promise<{ status: number }> }[] = [
    { acao: 'autenticado', chamar: (p) => get(p, '/catalogo') },
    { acao: 'unidade.ver', chamar: (p) => get(p, '/unidades?limite=1') },
    { acao: 'unidade.ver', chamar: (p) => get(p, '/unidades/T1-11') },
    { acao: 'unidade.editar', chamar: (p) => post(p, '/unidades', { torre: 4, numero: '32' }) }, // 409 para quem pode
    { acao: 'vinculo.ver', chamar: (p) => get(p, '/vinculos/contagem?status=pendente') },
    { acao: 'pessoa.ver', chamar: (p) => post(p, '/busca', { q: 'ana' }) },
    { acao: 'pessoa.ver', chamar: (p) => post(p, '/pessoas/busca', { q: 'ana' }) },
  ];
  it.each(PAPEIS)('%s: 403 exatamente onde a matriz nega, e cada 403 vira acesso.negado', async (papel) => {
    for (const r of rotas) {
      const permitido = r.acao === 'autenticado' || pode(papel as Papel, r.acao);
      const antes = (await trilha(api, 'acesso.negado')).length;
      const { status } = await r.chamar(papel);
      if (permitido) expect(status, `${papel} ${r.acao}`).not.toBe(403);
      else {
        expect(status, `${papel} ${r.acao}`).toBe(403);
        expect((await trilha(api, 'acesso.negado')).length).toBe(antes + 1);
      }
    }
  });

  it('a matriz é a esperada para estas ações (referência)', () => {
    expect(MATRIZ['unidade.editar']).toEqual(['sindico', 'administracao']);
    expect(MATRIZ['vinculo.ver']).toEqual(['sindico', 'administracao', 'auditor']);
  });

  it('porteiro não altera, desativa nem reativa unidade', async () => {
    const id = await idDe('T1-11');
    expect((await patch('porteiro', `/unidades/${id}`, { torre: 1, numero: '99' })).status).toBe(403);
    expect((await post('porteiro', `/unidades/${id}/desativar`)).status).toBe(403);
    expect((await post('auditor', `/unidades/${id}/reativar`)).status).toBe(403);
  });
});

describe('unidades: criar, editar, desativar e reativar (regras do mock)', () => {
  let novaId = '';

  it('cria (201), audita e recusa duplicata (409) e estrutura inválida (422)', async () => {
    const r = await post('administracao', '/unidades', { torre: 10, numero: ' 101 ' });
    expect(r.status).toBe(201);
    expect(r.body.data).toEqual({ id: expect.any(String), torre: 10, numero: '101', ativo: true });
    novaId = r.body.data.id;
    const a = (await trilha(api, 'unidade.criar')).at(-1)!;
    expect(a).toMatchObject({ registroId: novaId, usuarioPapel: 'administracao', entidade: 'unidade' });
    expect(a.depois).toMatchObject({ torre: 10, numero: '101', ativo: true });

    expect((await post('sindico', '/unidades', { torre: 10, numero: '101' })).body.code).toBe('UNIDADE_DUPLICADA');
    expect((await post('sindico', '/unidades', { torre: 4, numero: '3a' })).body).toMatchObject({ statusCode: 422, code: 'UNIDADE_INVALIDA' });
    expect((await post('sindico', '/unidades', { torre: 0, numero: '11' })).status).toBe(422);
    expect((await post('sindico', '/unidades', { torre: '4', numero: '11' })).status).toBe(400);
    expect((await get('porteiro', '/catalogo')).body.data.unidades).toHaveLength(166);
  });

  it('edita unidade sem registros (com antes/depois); referenciada não muda de número (422)', async () => {
    const r = await patch('sindico', `/unidades/${novaId}`, { torre: 10, numero: '102' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ torre: 10, numero: '102' });
    const a = (await trilha(api, 'unidade.editar')).at(-1)!;
    expect(a.antes).toMatchObject({ numero: '101' });
    expect(a.depois).toMatchObject({ numero: '102' });
    // sem mudança: 200 sem nova linha de auditoria
    const n = (await trilha(api, 'unidade.editar')).length;
    expect((await patch('sindico', `/unidades/${novaId}`, { torre: 10, numero: '102' })).status).toBe(200);
    expect((await trilha(api, 'unidade.editar')).length).toBe(n);

    const t432 = await idDe('T4-32');
    expect((await patch('sindico', `/unidades/${t432}`, { torre: 4, numero: '99' })).body).toMatchObject({ statusCode: 422, code: 'UNIDADE_REFERENCIADA' });
    expect((await patch('sindico', `/unidades/${novaId}`, { torre: 4, numero: '31' })).body.code).toBe('UNIDADE_DUPLICADA');
    expect((await patch('sindico', `/unidades/00000000-0000-4000-8000-000000000000`, { torre: 4, numero: '31' })).status).toBe(404);
  });

  it('desativa e reativa (409 se repetir); inativa continua no catálogo e na busca, e barra novos usos', async () => {
    const d = await post('administracao', `/unidades/${novaId}/desativar`);
    expect(d.status).toBe(200);
    expect(d.body.data.ativo).toBe(false);
    expect((await post('administracao', `/unidades/${novaId}/desativar`)).body.code).toBe('UNIDADE_JA_INATIVA');
    expect((await trilha(api, 'unidade.desativar')).at(-1)).toMatchObject({ registroId: novaId, antes: { ativo: true }, depois: { ativo: false } });

    const cat = (await get('porteiro', '/catalogo')).body.data.unidades.find((u: { id: string }) => u.id === novaId);
    expect(cat).toMatchObject({ codigo: 'T10-102', ativo: false });
    expect((await post('porteiro', '/busca', { q: 'T10-102' })).body.data.unidades).toEqual([{ id: novaId, motivo: 'Unidade (desativada)' }]);

    const servico = api.app.get(UnidadesService);
    await expect(servico.paraNovoUso(api.db, novaId)).rejects.toMatchObject({ status: 422, response: { codigo: 'UNIDADE_INATIVA' } });
    // a unidade inativa pode ser corrigida (o mock também deixa), mas não usada
    expect((await get('porteiro', `/unidades/${novaId}`)).body.data.unidade.ativo).toBe(false);

    const r = await post('sindico', `/unidades/${novaId}/reativar`);
    expect(r.body.data.ativo).toBe(true);
    expect((await post('sindico', `/unidades/${novaId}/reativar`)).body.code).toBe('UNIDADE_JA_ATIVA');
    await expect(servico.paraNovoUso(api.db, novaId)).resolves.toMatchObject({ id: novaId, ativo: true });
  });
});

describe('vínculos: contagem por status (badge do menu)', () => {
  it('pendentes do seed: Rafael, Rodrigo e Lucas', async () => {
    const r = await get('administracao', '/vinculos/contagem?status=pendente');
    expect(r.body.data).toEqual({ status: 'pendente', total: 3 });
    expect((await get('administracao', '/vinculos/contagem?status=xyz')).status).toBe(400);
    expect((await get('administracao', '/vinculos/contagem')).status).toBe(400);
  });
});

describe('busca de pessoas (mesmo comportamento do mock)', () => {
  const buscar = (q: string, extra: object = {}) => post('porteiro', '/pessoas/busca', { q, ...extra });

  it('por nome: sem acento e sem caixa; ordem exato > começa com > contém > alfabética', async () => {
    expect(nomes(await buscar('ANA RIBEIRO'))[0]).toBe('Ana Ribeiro');
    expect(nomes(await buscar('ribeiro'))).toEqual(['Ana Ribeiro', 'Lúcia Ribeiro', 'Paulo Ribeiro']);
    expect(nomes(await buscar('lucia'))).toEqual(['Lúcia Ribeiro']);
    expect(nomes(await buscar('OTÁVIO'))).toEqual(['Otávio Duarte']);
    expect(nomes(await buscar('mendes'))).toEqual(['Carla Mendes', 'Rafael Mendes']);
    // "Ana" exato não existe; começa com vem antes de contém
    const r = nomes(await buscar('ana'));
    expect(r[0]).toBe('Ana Ribeiro');
    expect(r).toContain('Juliana Costa');
    expect(r.indexOf('Ana Ribeiro')).toBeLessThan(r.indexOf('Juliana Costa'));
    // curinga do LIKE digitado é texto, não padrão
    expect(nomes(await buscar('%'))).toEqual([]);
    expect(nomes(await buscar('_'))).toEqual([]);
  });

  it('por CPF: 11 dígitos é igualdade pelo HMAC; 3 a 10 dígitos, parcial no mascarado', async () => {
    expect(nomes(await buscar('529.982.247-25'))).toEqual(['Ana Ribeiro']);
    expect(nomes(await buscar(CPF_ANA))).toEqual(['Ana Ribeiro']);
    expect(nomes(await buscar('11144477735'))).toEqual([]); // CPF válido que ninguém tem
    expect(nomes(await buscar('52998224700'))).toEqual([]); // 11 dígitos diferentes: sem match parcial
    expect(nomes(await buscar('982247'))).toContain('Ana Ribeiro');
  });

  it('por unidade: vínculos pendente, aprovado e legado da unidade', async () => {
    expect(nomes(await buscar('4-32')).sort()).toEqual(['Ana Ribeiro', 'Lúcia Ribeiro', 'Paulo Ribeiro']);
    expect(nomes(await buscar('T7-11')).sort()).toEqual(['Carla Mendes', 'Rafael Mendes']);
  });

  it('por placa: só quem tem vínculo VÁLIDO na unidade do veículo', async () => {
    expect(nomes(await buscar('BRA-2E19'))).toEqual(['Marta Siqueira']); // Rodrigo (pendente) fica de fora
    expect(nomes(await buscar('fkr2c')).sort()).toEqual(['Ana Ribeiro', 'Lúcia Ribeiro', 'Paulo Ribeiro']);
  });

  it('semMoradores (portaria): tira quem tem vínculo válido, mantém o pendente', async () => {
    expect(nomes(await buscar('Ana Ribeiro', { semMoradores: true }))).toEqual([]);
    expect(nomes(await buscar('Rodrigo Alves', { semMoradores: true }))).toEqual(['Rodrigo Alves']);
  });

  it('limite e "há mais"; formato sem telefone nem HMAC', async () => {
    const r = await buscar('a', { limite: 3 });
    expect(r.body.data.pessoas).toHaveLength(3);
    expect(r.body.data.temMais).toBe(true);
    expect((await buscar('Marta')).body.data.temMais).toBe(false);
    const ana = (await buscar('Ana Ribeiro')).body.data.pessoas[0];
    expect(ana).toEqual({
      id: expect.any(String), nome: 'Ana Ribeiro', documentoTipo: 'cpf', documentoMascarado: '***.982.247-**', semCpf: false,
      categoria: 'morador', ultimoAcesso: 'Sem acessos', unidadesVinculadas: [await idDe('T4-32')], unidadesVinculadasCodigos: ['T4-32'],
    });
    const claudia = (await buscar('Cláudia')).body.data.pessoas[0];
    expect(claudia).toMatchObject({ semCpf: true, documentoMascarado: '(sem CPF)', empresa: 'Autônoma' });
    expect((await buscar('x'.repeat(101))).status).toBe(400);
    expect((await buscar('ana', { extra: 1 })).status).toBe(400);
  });

  it('último acesso vem do evento mais recente (entrada, negado ou recusado)', async () => {
    const [marcos] = await api.db.select().from(s.pessoa).where(eq(s.pessoa.nome, 'Marcos Pereira'));
    const [ana] = await api.db.select().from(s.pessoa).where(eq(s.pessoa.nome, 'Ana Ribeiro'));
    const [ponto] = await api.db.select().from(s.pontoAcesso);
    await api.db.insert(s.eventoAcesso).values({
      tipo: 'entrada', categoriaPessoa: 'visitante', pessoaId: marcos!.id, unidadeDestinoId: await idDe('T4-32'), pontoAcessoId: ponto!.id,
      autorizadoPorTipo: 'interfone', autorizadoPorPessoaId: ana!.id, operadorId: api.usuarios[LOGINS.porteiro]!.id, operadorPapel: 'porteiro',
    });
    const r = (await buscar('Marcos Pereira')).body.data.pessoas[0];
    expect(r.ultimoAcesso).toMatch(/^(Hoje \d{2}:\d{2}|\d{2}\/\d{2}) · T4-32$/);
  });

  it('pessoa anonimizada não aparece, nem por nome nem por unidade', async () => {
    const [bruno] = await api.db.select().from(s.pessoa).where(eq(s.pessoa.nome, 'Bruno Teixeira'));
    await api.db.update(s.pessoa).set({ anonimizadaEm: api.relogio.agora(), documentoBusca: null, documentoMascarado: null, telefone: null })
      .where(eq(s.pessoa.id, bruno!.id));
    expect(nomes(await buscar('Bruno Teixeira'))).toEqual([]);
    expect(nomes(await post('sindico', '/busca', { q: 'Bruno' }))).toEqual([]);
  });
});

describe('busca global (topo)', () => {
  it('unidade pelo código, pessoas (até 6, com 2+ caracteres) e unidade pela placa', async () => {
    const r = await post('auditor', '/busca', { q: 'T4-32' });
    expect(r.body.data.unidades[0]).toEqual({ id: await idDe('T4-32'), motivo: 'Unidade' });
    expect(nomes(r).sort()).toEqual(['Ana Ribeiro', 'Lúcia Ribeiro', 'Paulo Ribeiro']);
    const p = await post('auditor', '/busca', { q: 'bra2e' });
    expect(p.body.data.unidades).toEqual([{ id: await idDe('T9-13'), motivo: 'Placa BRA-2E19 · Toyota Corolla' }]);
    expect((await post('auditor', '/busca', { q: 'a' })).body.data).toEqual({ pessoas: [], unidades: [], temMaisPessoas: false });
    const ri = await post('auditor', '/busca', { q: 'ri' });
    expect(nomes(ri)).toEqual(['Ana Ribeiro', 'Lúcia Ribeiro', 'Paulo Ribeiro', 'Rodrigo Alves']); // todos "contém": alfabética
    expect(ri.body.data.temMaisPessoas).toBe(false);
  });
});

describe('CPF fora de log e de trilha', () => {
  it('busca por CPF (sucesso, 400 e 403) não grava o CPF em log de aplicação, na trilha nem no corpo de erro', async () => {
    const linhas: string[] = [];
    const captura = (...a: unknown[]) => { linhas.push(a.map(String).join(' ')); };
    const log = vi.spyOn(console, 'log').mockImplementation(captura);
    const err = vi.spyOn(console, 'error').mockImplementation(captura);
    const warn = vi.spyOn(console, 'warn').mockImplementation(captura);
    const respostas: string[] = [];
    try {
      for (const q of [CPF_ANA, '529.982.247-25']) {
        const a = await post('porteiro', '/pessoas/busca', { q });
        const b = await post('auditor', '/busca', { q });
        const c = await post('porteiro', '/pessoas/busca', { q, limite: 'muitos' }); // 400
        expect([a.status, b.status, c.status]).toEqual([200, 200, 400]);
        respostas.push(JSON.stringify(c.body));
      }
      // 403 (troca de senha obrigatória) também grava acesso.negado: sem o termo buscado
      const novo = await post('sindico', '/usuarios', { nome: 'Porteiro Novo', login: 'porteiro.novo', papel: 'porteiro' });
      const { cookie } = await api.entrar('porteiro.novo', novo.body.data.senhaTemporaria);
      const negado = await api.http().post(`${V1}/busca`).set('Cookie', cookie).send({ q: CPF_ANA });
      expect(negado.status).toBe(403);
      respostas.push(JSON.stringify(negado.body));
    } finally {
      log.mockRestore(); err.mockRestore(); warn.mockRestore();
    }
    expect(linhas.length).toBeGreaterThan(0); // a API logou as requisições
    const trilhaJson = JSON.stringify(await trilha(api));
    for (const alvo of [CPF_ANA, '529.982.247-25', '98224725']) {
      expect(linhas.join('\n')).not.toContain(alvo);
      expect(trilhaJson).not.toContain(alvo);
      expect(respostas.join('\n')).not.toContain(alvo);
    }
    expect(linhas.some((l) => l.includes('"rota":"/api/v1/pessoas/busca"'))).toBe(true);
  });
});
