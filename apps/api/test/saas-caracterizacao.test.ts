// Testes de CARACTERIZAÇÃO da fase F0 do SaaS (docs/05_arquitetura_saas.md §5): fixam o comportamento de hoje nos
// pontos que F2 e F4 vão mudar (login, sessão/cookie, selo público, agendador). Não dizem que o comportamento é o certo
// para o SaaS; dizem o que existe. Quando uma fase mudar um destes pontos de propósito, o teste muda junto, no mesmo
// commit, e o diff do teste documenta a mudança. Quebrar sem querer = regressão no piloto.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as s from '../src/db/schema';
import { TravaJobs } from '../src/jobs/trava';
import { SeloService } from '../src/selo/selo.module';
import { type ApiDeTeste, cookieDe, novaApi, novoIp, SENHA } from './helpers/app';

const V1 = '/api/v1';
const ANCORA_GITHUB = { github: true, emails: [], remetente: 'portaria@localhost', smtp: null, arquivo: null };

describe('caracterização: login e sessão (F2 muda: código do condomínio e cookie v2.<condominio_id>.<token>)', () => {
  let api: ApiDeTeste;
  beforeAll(async () => { api = await novaApi(); });
  afterAll(async () => { await api.app.close(); await api.client.close(); });

  it('login só com {login, senha}; o cabeçalho X-Condominio é ignorado, até com código inexistente', async () => {
    for (const cab of [undefined, 'demo', 'nao-existe']) {
      const r = api.http().post(`${V1}/auth/login`).set('X-Forwarded-For', novoIp());
      if (cab) r.set('X-Condominio', cab);
      expect((await r.send({ login: 'joao.lima', senha: SENHA })).status).toBe(200);
    }
  });

  it('campo `codigo` no corpo do login é recusado hoje (400, corpo estrito)', async () => {
    const r = await api.http().post(`${V1}/auth/login`).set('X-Forwarded-For', novoIp()).send({ login: 'joao.lima', senha: SENHA, codigo: 'demo' });
    expect(r.status).toBe(400);
  });

  it('cookie: token opaco base64url de 43 caracteres, sem prefixo nem ponto; no banco, só o SHA-256 dele', async () => {
    const { cookie } = await api.entrar('joao.lima');
    const [nome, token] = cookie.split('=') as [string, string];
    expect(nome).toBe('__Host-portaria_sessao');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hashes = (await api.db.select({ h: s.sessao.tokenHash }).from(s.sessao)).map((x) => x.h);
    expect(hashes).toContain(createHash('sha256').update(token, 'utf8').digest('hex'));
  });

  it('o mesmo token com prefixo de condomínio (formato v2 da F2) é sessão inválida hoje: 401', async () => {
    const { cookie } = await api.entrar('joao.lima');
    const token = cookie.split('=')[1]!;
    expect((await api.http().get(`${V1}/auth/me`).set('Cookie', cookie)).status).toBe(200);
    const v2 = await api.http().get(`${V1}/auth/me`).set('Cookie', `__Host-portaria_sessao=v2.${randomUUID()}.${token}`);
    expect(v2.status).toBe(401);
    expect(v2.body.code).toBe('SESSAO_INVALIDA');
  });

  it('o login é procurado no banco inteiro, sem distinguir maiúsculas (um condomínio por banco)', async () => {
    const r = await api.http().post(`${V1}/auth/login`).set('X-Forwarded-For', novoIp()).send({ login: 'JOAO.LIMA', senha: SENHA });
    expect(r.status).toBe(200);
    expect(cookieDe(r.headers['set-cookie'])).toMatch(/^__Host-portaria_sessao=/);
  });
});

describe('caracterização: selo público v1 (F4 muda: só {data, raiz} por dia, formato v2)', () => {
  let api: ApiDeTeste;
  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    api = await novaApi({ ancora: ANCORA_GITHUB });
    await api.app.get(SeloService).selarDia('2026-10-16');
  });
  afterAll(async () => { vi.restoreAllMocks(); await api.app.close(); await api.client.close(); });

  it('formato v1 exato: {formato, versao: 1, selos: [{data, seq, hash, totalDoDia}]}; X-Condominio ignorado', async () => {
    const r = await api.http().get(`${V1}/auditoria/selos/publico`).set('X-Forwarded-For', novoIp());
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data)).toEqual(['formato', 'versao', 'selos']);
    expect(r.body.data).toMatchObject({ formato: 'portaria-parque/selos-diarios', versao: 1 });
    expect(r.body.data.selos.map((x: object) => Object.keys(x))).toEqual([['data', 'seq', 'hash', 'totalDoDia']]);
    expect(r.body.data.selos[0]).toMatchObject({ data: '2026-10-16', seq: 0, totalDoDia: 0 });
    const outro = await api.http().get(`${V1}/auditoria/selos/publico`).set('X-Forwarded-For', novoIp()).set('X-Condominio', 'outro');
    expect(outro.body).toEqual(r.body);
  });
});

describe('caracterização: agendador (F2 muda: laço por condomínio e trava por condomínio)', () => {
  it('trava de job: advisory lock com chave GLOBAL por nome (portaria:job:<nome>), sem condomínio', async () => {
    const chaves: unknown[] = [];
    const conexao = { query: async (_q: string, p: unknown[]) => { chaves.push(p[0]); return { rows: [{ ok: true }] }; }, release: () => undefined };
    const trava = new TravaJobs({ connect: async () => conexao, end: async () => undefined } as never);
    expect(await trava.tentar('selo', async () => 1)).toEqual({ obtida: true, valor: 1 });
    expect(await trava.tentar('retencao', async () => 2)).toEqual({ obtida: true, valor: 2 });
    expect([...new Set(chaves)]).toEqual(['portaria:job:selo', 'portaria:job:retencao']);
  });

  it('o "ontem" do selo diário é BRT fixo: 02:59Z ainda é o dia anterior em São Paulo, 03:00Z já não', async () => {
    const api = await novaApi();
    try {
      const selo = api.app.get(SeloService);
      api.relogio.atual = new Date('2026-10-17T02:59:00.000Z'); // 23:59 de 16/10 em BRT -> ontem = 15/10
      await selo.rotinaDiaria();
      api.relogio.atual = new Date('2026-10-17T03:00:00.000Z'); // 00:00 de 17/10 em BRT -> ontem = 16/10
      await selo.rotinaDiaria();
      const dias = (await api.db.select({ d: s.seloCadeia.data, t: s.seloCadeia.tipo }).from(s.seloCadeia)).map((x) => `${x.t}:${x.d}`);
      expect(dias.sort()).toEqual(['diario:2026-10-15', 'diario:2026-10-16']);
    } finally { await api.app.close(); await api.client.close(); }
  });
});
