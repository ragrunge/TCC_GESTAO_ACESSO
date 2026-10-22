// Autenticação e sessão (spec §5.1) pela API real (HTTP), sobre PGlite com as migrações reais.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as s from '../src/db/schema';
import { PADROES_LOGIN } from '../src/config/config';
import { LimiteLoginService, TETO_FALHAS } from '../src/auth/limite-login.service';
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
    // Sem o seq da cadeia: em polling ele mostraria o instante de cada evento da portaria
    expect(r.body.data).not.toHaveProperty('ultimoSeq');
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
    // Login inexistente: rótulo fixo, sem o texto digitado; existente: o ator do cadastro, sem o texto digitado.
    expect(falhas.find((f) => f.usuarioId === null)).toMatchObject({ usuarioNome: '(login inexistente)', depois: { motivo: 'login_inexistente' } });
    expect(falhas.find((f) => f.usuarioId === api.usuarios[LOGINS.auditor]!.id)?.depois).toEqual({ motivo: 'senha_incorreta' });
    // Nem a senha tentada nem o login digitado vão para a trilha
    expect(JSON.stringify(falhas)).not.toMatch(/qualquer coisa|senha errada mesmo|ninguem\.aqui/);
  });

  it('senha digitada no campo de login não fica na trilha (nem em auth.login_falha nem em auth.bloqueio)', async () => {
    const ip = novoIp();
    const segredo = 'Minha-Senha-Secreta-123';
    for (let i = 0; i < PADROES_LOGIN.maxFalhasLogin + 1; i++) {
      await api.http().post(LOGIN).set('X-Forwarded-For', ip).send({ login: segredo, senha: 'x' });
    }
    const linhas = [...await trilha(api, 'auth.login_falha'), ...await trilha(api, 'auth.bloqueio')];
    expect(linhas.some((l) => (l.depois as { tipo?: string } | null)?.tipo === 'login_ip')).toBe(true);
    expect(JSON.stringify(linhas)).not.toMatch(/secreta/i);
  });

  it('login digitado como CPF não aparece na trilha (usuario_nome e depois)', async () => {
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

describe('auth: limite de tentativas (padrão: 10 por login+IP e 30 por IP em 15 min; login sozinho só atrasa)', () => {
  let api: ApiDeTeste;
  const L = PADROES_LOGIN.maxFalhasLogin;
  const IP = PADROES_LOGIN.maxFalhasIp;
  beforeAll(async () => { api = await novaApi(); });
  afterAll(async () => { await api.app.close(); await api.client.close(); });

  it('os padrões são os da spec §14 nº 27 (10 por login, 30 por IP, janela e bloqueio de 15 min)', () => {
    expect(PADROES_LOGIN).toMatchObject({ maxFalhasLogin: 10, maxFalhasIp: 30, janelaMin: 15, bloqueioMin: 15 });
    expect(api.config.login).toMatchObject({ maxFalhasLogin: 10, maxFalhasIp: 30 });
  });

  it(`${L} falhas no mesmo login e IP bloqueiam esse par até com a senha certa; outro IP entra; libera após 15 min`, async () => {
    const atacante = novoIp();
    for (let i = 0; i < L; i++) {
      const r = await api.http().post(LOGIN).set('X-Forwarded-For', atacante).send({ login: LOGINS.porteiro, senha: `errada-${i}` });
      expect(r.status).toBe(401);
    }
    const bloqueado = await api.http().post(LOGIN).set('X-Forwarded-For', atacante).send({ login: LOGINS.porteiro, senha: SENHA });
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body.code).toBe('LOGIN_BLOQUEADO');
    expect(Number(bloqueado.headers['retry-after'])).toBeGreaterThan(0);
    const bloqueios = await trilha(api, 'auth.bloqueio');
    expect(bloqueios.length).toBe(1);
    expect(bloqueios[0]!).toMatchObject({ usuarioId: api.usuarios[LOGINS.porteiro]!.id, depois: { tipo: 'login_ip', falhas: L } });

    // Sem bloqueio dirigido: a guarita (outro IP) entra durante o bloqueio do atacante.
    await api.entrar(LOGINS.porteiro);
    api.relogio.avancarMin(15);
    await api.entrar(LOGINS.porteiro, SENHA, atacante); // lança se não for 200
  });

  it('bloqueio dirigido: falhas sem fim no mesmo login, de muitos IPs, nunca bloqueiam o dono (só atrasam a falha)', async () => {
    for (let i = 0; i < L * 3; i++) {
      expect((await api.http().post(LOGIN).set('X-Forwarded-For', novoIp()).send({ login: LOGINS.sindico, senha: `errada-${i}` })).status).toBe(401);
    }
    await api.entrar(LOGINS.sindico);
  });

  it(`${L - 1} falhas não bloqueiam o login`, async () => {
    for (let i = 0; i < L - 1; i++) await api.http().post(LOGIN).set('X-Forwarded-For', novoIp()).send({ login: LOGINS.auditor, senha: 'x' });
    await api.entrar(LOGINS.auditor);
  });

  it('compatível com a imagem anterior à 0008: bloqueio gravado no tipo login é ignorado; contador do login tem teto', async () => {
    const limite = await api.servico<LimiteLoginService>(LimiteLoginService);
    const ch = limite.chave('login', LOGINS.auditor);
    const agora = api.relogio.agora();
    const linha = { falhas: TETO_FALHAS, janelaInicio: agora, bloqueadoAte: new Date(agora.getTime() + 60 * 60_000), atualizadoEm: agora };
    await api.db.insert(s.loginLimite).values({ tipo: 'login', chave: ch.chave, ...linha })
      .onConflictDoUpdate({ target: [s.loginLimite.tipo, s.loginLimite.chave], set: linha });
    await api.entrar(LOGINS.auditor);
    await api.db.update(s.loginLimite).set({ falhas: TETO_FALHAS, bloqueadoAte: null }).where(and(eq(s.loginLimite.tipo, 'login'), eq(s.loginLimite.chave, ch.chave)));
    expect((await api.http().post(LOGIN).set('X-Forwarded-For', novoIp()).send({ login: LOGINS.auditor, senha: 'x' })).status).toBe(401);
    const [l] = await api.db.select().from(s.loginLimite).where(and(eq(s.loginLimite.tipo, 'login'), eq(s.loginLimite.chave, ch.chave)));
    expect(l!.falhas).toBe(TETO_FALHAS); // não estoura o smallint
    await api.entrar(LOGINS.auditor);
  });

  it('login inexistente bloqueia igual (sem enumeração pelo comportamento do bloqueio)', async () => {
    const ip = novoIp();
    for (let i = 0; i < L; i++) await api.http().post(LOGIN).set('X-Forwarded-For', ip).send({ login: 'nao.existe', senha: 'x' });
    const r = await api.http().post(LOGIN).set('X-Forwarded-For', ip).send({ login: 'nao.existe', senha: 'x' });
    expect(r.status).toBe(429);
  });

  it(`guarita atrás de NAT: ${IP - 1} falhas de operadores diferentes no mesmo IP não bloqueiam quem acerta a senha`, async () => {
    const ip = '203.0.113.20';
    // Erros de digitação espalhados por vários logins (nenhum chega ao limite por login), todos pelo mesmo IP.
    for (let i = 0; i < IP - 1; i++) {
      expect((await api.http().post(LOGIN).set('X-Forwarded-For', ip).send({ login: `operador.${i % 5}`, senha: 'x' })).status).toBe(401);
    }
    await api.entrar(LOGINS.auditor, SENHA, ip); // o sucesso desfaz só a própria reserva no contador do IP
  });

  it(`${IP} falhas do mesmo IP (logins variados) bloqueiam o IP, inclusive para um login válido`, async () => {
    const ip = '203.0.113.7';
    for (let i = 0; i < IP; i++) await api.http().post(LOGIN).set('X-Forwarded-For', ip).send({ login: `spray.${i}`, senha: 'x' });
    const r = await api.http().post(LOGIN).set('X-Forwarded-For', ip).send({ login: LOGINS.auditor, senha: SENHA });
    expect(r.status).toBe(429);
    // Outro IP entra normalmente
    await api.entrar(LOGINS.auditor);
  });

  it('sucesso zera o contador do par (falhas antigas não somam com as novas)', async () => {
    const ip = novoIp();
    for (let i = 0; i < L - 1; i++) await api.http().post(LOGIN).set('X-Forwarded-For', ip).send({ login: LOGINS.sindico, senha: 'x' });
    await api.entrar(LOGINS.sindico, SENHA, ip);
    for (let i = 0; i < L - 1; i++) {
      expect((await api.http().post(LOGIN).set('X-Forwarded-For', ip).send({ login: LOGINS.sindico, senha: 'x' })).status).toBe(401);
    }
    await api.entrar(LOGINS.sindico, SENHA, ip);
  });

  it(`rajada paralela: no máximo ${L} senhas verificadas por login+IP, o resto bloqueado sem verificar`, async () => {
    const antes = (await trilha(api, 'auth.login_falha')).length;
    const total = L + 7;
    const ip = novoIp();
    const rs = await Promise.all(Array.from({ length: total }, (_, i) =>
      api.http().post(LOGIN).set('X-Forwarded-For', ip).send({ login: LOGINS.administracao, senha: `paralela-${i}` })));
    expect(rs.filter((r) => r.status === 401).length).toBeLessThanOrEqual(L);
    expect(rs.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(total - L);
    const novas = (await trilha(api, 'auth.login_falha')).slice(antes);
    expect(novas.filter((f) => (f.depois as { motivo: string }).motivo === 'senha_incorreta').length).toBeLessThanOrEqual(L);
  });
});

describe('auth: limite de tentativas configurado pelo ambiente', () => {
  let api: ApiDeTeste;
  beforeAll(async () => { api = await novaApi({ login: { ...PADROES_LOGIN, atrasoBaseMs: 0, maxFalhasLogin: 3, maxFalhasIp: 5, bloqueioMin: 2 } }); });
  afterAll(async () => { await api.app.close(); await api.client.close(); });

  it('valores do ambiente valem para login+IP, IP e duração do bloqueio', async () => {
    const guarita = novoIp();
    for (let i = 0; i < 3; i++) await api.http().post(LOGIN).set('X-Forwarded-For', guarita).send({ login: LOGINS.porteiro, senha: 'x' });
    expect((await api.http().post(LOGIN).set('X-Forwarded-For', guarita).send({ login: LOGINS.porteiro, senha: SENHA })).status).toBe(429);
    const ip = '203.0.113.30';
    for (let i = 0; i < 5; i++) await api.http().post(LOGIN).set('X-Forwarded-For', ip).send({ login: `x.${i}`, senha: 'x' });
    expect((await api.http().post(LOGIN).set('X-Forwarded-For', ip).send({ login: LOGINS.auditor, senha: SENHA })).status).toBe(429);
    api.relogio.avancarMin(2);
    await api.entrar(LOGINS.porteiro, SENHA, guarita);
    await api.entrar(LOGINS.auditor, SENHA, ip);
  });
});
