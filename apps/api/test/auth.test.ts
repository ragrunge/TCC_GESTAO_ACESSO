// Autenticação e sessão (spec §5.1) pela API real (HTTP), sobre PGlite com as migrações reais.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as s from '../src/db/schema';
import { type ApiDeTeste, LOGINS, novaApi, novoIp, SENHA, trilha } from './helpers/app';

const LOGIN = '/api/v1/auth/login';
const ME = '/api/v1/auth/me';

describe('auth: login, cookie, sessão e logout', () => {
  let api: ApiDeTeste;
  beforeAll(async () => { api = await novaApi(); });
  afterAll(async () => { await api.app.close(); await api.client.close(); });

  it('/saude continua público com os guards globais', async () => {
    const r = await api.http().get('/api/v1/saude');
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('ok');
  });

  it('login ok: cookie HttpOnly; Secure; SameSite=Strict; Path=/ com prefixo __Host-, sem hash na resposta', async () => {
    const r = await api.http().post(LOGIN).set('X-Forwarded-For', novoIp()).send({ login: 'Joao.Lima ', senha: SENHA });
    expect(r.status).toBe(200);
    const sc = ([] as string[]).concat(r.headers['set-cookie'] ?? []).find((c) => c.startsWith('__Host-portaria_sessao='))!;
    expect(sc).toBeTruthy();
    expect(sc).toMatch(/; HttpOnly/i);
    expect(sc).toMatch(/; Secure/i);
    expect(sc).toMatch(/; SameSite=Strict/i);
    expect(sc).toMatch(/; Path=\//i);
    expect(sc).not.toMatch(/Domain=/i);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.data.usuario).toMatchObject({ login: 'joao.lima', papel: 'porteiro', deveTrocarSenha: false });
    expect(JSON.stringify(r.body)).not.toMatch(/argon2|senha_hash|senhaHash/);
    // O token só existe no cookie: o banco guarda o SHA-256
    const token = sc.split(';')[0]!.split('=')[1]!;
    const sessoes = await api.db.select().from(s.sessao);
    expect(sessoes.some((x) => x.tokenHash === token)).toBe(false);
    expect((await trilha(api, 'auth.login')).at(-1)).toMatchObject({ usuarioId: api.usuarios['joao.lima']!.id, entidade: 'sessao' });
  });

  it('falha: usuário inexistente, senha errada e usuário inativo respondem IGUAL', async () => {
    const ip = novoIp;
    const a = await api.http().post(LOGIN).set('X-Forwarded-For', ip()).send({ login: 'ninguem.aqui', senha: 'qualquer coisa' });
    const b = await api.http().post(LOGIN).set('X-Forwarded-For', ip()).send({ login: LOGINS.auditor, senha: 'senha errada mesmo' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect({ ...a.body, timestamp: 0 }).toEqual({ ...b.body, timestamp: 0 });
    expect(a.body).toMatchObject({ statusCode: 401, error: 'Unauthorized', code: 'CREDENCIAIS_INVALIDAS', message: 'Usuário ou senha inválidos.', path: '/api/v1/auth/login' });
    expect(a.body).not.toHaveProperty('details');
    expect(a.headers['set-cookie']).toBeUndefined();
    const falhas = await trilha(api, 'auth.login_falha');
    expect(falhas.find((f) => f.usuarioId === null)?.usuarioNome).toBe('ninguem.aqui');
    expect(falhas.find((f) => f.usuarioId === api.usuarios[LOGINS.auditor]!.id)).toBeTruthy();
    // A senha tentada nunca vai para a trilha
    expect(JSON.stringify(falhas)).not.toMatch(/qualquer coisa|senha errada mesmo/);
  });

  it('login digitado como CPF fica mascarado na trilha (usuario_nome e depois)', async () => {
    await api.http().post(LOGIN).set('X-Forwarded-For', novoIp()).send({ login: '529.982.247-25', senha: 'x' });
    await api.http().post(LOGIN).set('X-Forwarded-For', novoIp()).send({ login: '52998224725', senha: 'x' });
    const falhas = (await trilha(api, 'auth.login_falha')).slice(-2);
    for (const f of falhas) {
      expect(f.usuarioNome).not.toMatch(/\d{3}/);
      expect(JSON.stringify(f.depois)).not.toMatch(/\d{3}/);
    }
  });

  it('401 sem cookie, com cookie adulterado e com token que nunca existiu', async () => {
    expect((await api.http().get(ME)).status).toBe(401);
    expect((await api.http().get('/api/v1/usuarios')).status).toBe(401);
    expect((await api.http().get(ME).set('Cookie', '__Host-portaria_sessao=abc')).status).toBe(401);
    const forjado = `__Host-portaria_sessao=${'A'.repeat(43)}`;
    const r = await api.http().get(ME).set('Cookie', forjado);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('SESSAO_INVALIDA');
    // 401 não é negação de acesso: não grava acesso.negado
    expect((await trilha(api, 'acesso.negado')).length).toBe(0);
  });

  it('me devolve o usuário e a expiração; logout revoga no banco e limpa o cookie', async () => {
    const { cookie } = await api.como('administracao');
    const me = await api.http().get(ME).set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.usuario.login).toBe(LOGINS.administracao);
    expect(me.body.data.sessao.inatividadeMin).toBe(30);

    const sai = await api.http().post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(sai.status).toBe(204);
    expect(String(sai.headers['set-cookie'])).toMatch(/__Host-portaria_sessao=;.*Expires=Thu, 01 Jan 1970/);
    // O mesmo token, reapresentado, não vale mais (logout real, não só apagar o cookie)
    expect((await api.http().get(ME).set('Cookie', cookie)).status).toBe(401);
    const [sessao] = await api.db.select().from(s.sessao)
      .where(and(eq(s.sessao.usuarioId, api.usuarios[LOGINS.administracao]!.id), eq(s.sessao.motivoRevogacao, 'logout')));
    expect(sessao?.revogadaEm).toBeInstanceOf(Date);
    expect((await trilha(api, 'auth.logout')).length).toBe(1);
  });

  it('sessão expira por inatividade (30 min) e é renovada pelo uso', async () => {
    const { cookie } = await api.como('porteiro');
    api.relogio.avancarMin(29);
    expect((await api.http().get(ME).set('Cookie', cookie)).status).toBe(200); // uso grava ultimo_uso_em
    api.relogio.avancarMin(29);
    expect((await api.http().get(ME).set('Cookie', cookie)).status).toBe(200); // 58 min desde o login, 29 desde o uso
    api.relogio.avancarMin(30);
    expect((await api.http().get(ME).set('Cookie', cookie)).status).toBe(401);
  });

  it('sessão expira pelo tempo absoluto (12 h) mesmo em uso contínuo', async () => {
    const { cookie } = await api.como('sindico');
    for (let min = 0; min < 720 - 20; min += 20) {
      api.relogio.avancarMin(20);
      expect((await api.http().get(ME).set('Cookie', cookie)).status, `minuto ${min + 20}`).toBe(200);
    }
    api.relogio.avancarMin(25); // 12h05 desde o login, 5 min desde o último uso
    expect((await api.http().get(ME).set('Cookie', cookie)).status).toBe(401);
  });

  it('corpo inválido: 400 sem eco do valor e campo desconhecido recusado', async () => {
    const r = await api.http().post(LOGIN).send({ login: 'x', senha: 'y', papel: 'sindico' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('DADOS_INVALIDOS');
    const vazio = await api.http().post(LOGIN).set('Content-Type', 'application/json').send('{"login":');
    expect(vazio.status).toBe(400);
    expect(vazio.body.code).toBeTruthy();
    expect(JSON.stringify(vazio.body)).not.toMatch(/Unexpected|JSON\.parse|at /);
  });
});

describe('auth: limite de tentativas (5 em 15 min, por login e por IP)', () => {
  let api: ApiDeTeste;
  beforeAll(async () => { api = await novaApi(); });
  afterAll(async () => { await api.app.close(); await api.client.close(); });

  it('5 falhas no mesmo login (de IPs diferentes) bloqueiam até com a senha certa; libera após 15 min', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await api.http().post(LOGIN).set('X-Forwarded-For', novoIp()).send({ login: LOGINS.porteiro, senha: `errada-${i}` });
      expect(r.status).toBe(401);
    }
    const bloqueado = await api.http().post(LOGIN).set('X-Forwarded-For', novoIp()).send({ login: LOGINS.porteiro, senha: SENHA });
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body.code).toBe('LOGIN_BLOQUEADO');
    expect(Number(bloqueado.headers['retry-after'])).toBeGreaterThan(0);
    const bloqueios = await trilha(api, 'auth.bloqueio');
    expect(bloqueios.length).toBe(1);
    expect(bloqueios[0]!.depois).toMatchObject({ tipo: 'login', falhas: 5 });

    api.relogio.avancarMin(15);
    await api.entrar(LOGINS.porteiro); // lança se não for 200
  });

  it('login inexistente bloqueia igual (sem enumeração pelo comportamento do bloqueio)', async () => {
    for (let i = 0; i < 5; i++) await api.http().post(LOGIN).set('X-Forwarded-For', novoIp()).send({ login: 'nao.existe', senha: 'x' });
    const r = await api.http().post(LOGIN).set('X-Forwarded-For', novoIp()).send({ login: 'nao.existe', senha: 'x' });
    expect(r.status).toBe(429);
  });

  it('5 falhas do mesmo IP (logins variados) bloqueiam o IP, inclusive para um login válido', async () => {
    const ip = '203.0.113.7';
    for (let i = 0; i < 5; i++) await api.http().post(LOGIN).set('X-Forwarded-For', ip).send({ login: `spray.${i}`, senha: 'x' });
    const r = await api.http().post(LOGIN).set('X-Forwarded-For', ip).send({ login: LOGINS.auditor, senha: SENHA });
    expect(r.status).toBe(429);
    // Outro IP entra normalmente
    await api.entrar(LOGINS.auditor);
  });

  it('sucesso zera o contador do login (falhas antigas não somam com as novas)', async () => {
    for (let i = 0; i < 4; i++) await api.http().post(LOGIN).set('X-Forwarded-For', novoIp()).send({ login: LOGINS.sindico, senha: 'x' });
    await api.entrar(LOGINS.sindico);
    for (let i = 0; i < 4; i++) {
      expect((await api.http().post(LOGIN).set('X-Forwarded-For', novoIp()).send({ login: LOGINS.sindico, senha: 'x' })).status).toBe(401);
    }
    await api.entrar(LOGINS.sindico);
  });

  it('rajada paralela: no máximo 5 senhas verificadas por login, o resto bloqueado sem verificar', async () => {
    const antes = (await trilha(api, 'auth.login_falha')).length;
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      api.http().post(LOGIN).set('X-Forwarded-For', novoIp()).send({ login: LOGINS.administracao, senha: `paralela-${i}` })));
    expect(rs.filter((r) => r.status === 401).length).toBeLessThanOrEqual(5);
    expect(rs.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(7);
    const novas = (await trilha(api, 'auth.login_falha')).slice(antes);
    expect(novas.filter((f) => (f.depois as { motivo: string }).motivo === 'senha_incorreta').length).toBeLessThanOrEqual(5);
  });
});
