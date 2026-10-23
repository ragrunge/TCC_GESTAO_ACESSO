// CLI criar-usuario-plataforma (bootstrap do Master) e serviço provisionador (sidecar da tela "Novo condomínio").
// Plataforma em PGlite com as migrações reais, gravando como app_plataforma (SET ROLE): os GRANTs da 0000 valem.
import type { AddressInfo } from 'node:net';
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lerArgsUsuario, textoCredenciais } from '../src/cli/criar-usuario-plataforma';
import { autorizado, criarServidor, tokenDoAmbiente } from '../src/cli/servidor-provisionador';
import { decifrarSegredoTotp } from '../src/master/segredo-totp';
import { base32 } from '../src/master/totp';
import { criarUsuario, ErroUsuarioPlataforma, reemitir, validarCadastro } from '../src/master/usuario-plataforma';
import { ErroProvisionamento, type ResultadoProvisionamento } from '../src/saas/provisionar';
import { masterSessao, masterUsuario, plataformaAudit } from '../src/saas/schema-plataforma';
import { comoAppPlataforma, novoBancoPlataforma } from './helpers/plataforma';
import { MESTRA_TESTE } from './helpers/saas';

let p: Awaited<ReturnType<typeof novoBancoPlataforma>>;
const f = { hashSenha: (x: string) => hash(x, { memoryCost: 1024, timeCost: 1, parallelism: 1 }), gerarSenha: () => 'abcd-efgh-jkmn-pqrs' };

beforeAll(async () => { p = await novoBancoPlataforma(); });
afterAll(async () => { await p.client.close(); });

describe('argumentos', () => {
  it('criação exige e-mail e nome; reemissão não aceita nome/papel; desconhecido é uso', () => {
    expect(lerArgsUsuario(['--email', 'a@b.c', '--nome', 'Fulano de Tal'])).toMatchObject({ email: 'a@b.c', nome: 'Fulano de Tal', reemitirTotp: false });
    expect(lerArgsUsuario(['--email', 'a@b.c', '--reemitir-totp', '--nova-senha'])).toMatchObject({ reemitirTotp: true, novaSenha: true });
    expect(() => lerArgsUsuario(['--email', 'a@b.c'])).toThrow(/uso/);
    expect(() => lerArgsUsuario(['--nome', 'x'])).toThrow(/uso/);
    expect(() => lerArgsUsuario(['--email', 'a@b.c', '--reemitir-totp', '--nome', 'x'])).toThrow(/só na criação/);
    expect(() => lerArgsUsuario(['--email', 'a@b.c', '--senha', 'x'])).toThrow(/uso/);
    expect(() => validarCadastro({ email: 'sem-arroba', nome: 'Fulano' })).toThrow(/--email/);
    expect(() => validarCadastro({ email: 'a@b.c', nome: 'Fulano', papel: 'sindico' })).toThrow(/--papel/);
  });
});

describe('criar e reemitir', () => {
  let id = '';

  it('cria com senha temporária (troca obrigatória), segredo TOTP cifrado e trilha sem segredo', async () => {
    const c = await comoAppPlataforma(p.client, () => criarUsuario(p.db, MESTRA_TESTE, f, validarCadastro({ email: 'Operador@Exemplo.test', nome: 'Operador Fictício' })));
    id = c.id;
    expect(c).toMatchObject({ email: 'operador@exemplo.test', senhaTemporaria: 'abcd-efgh-jkmn-pqrs' });
    expect(c.totp!.uri).toMatch(/^otpauth:\/\/totp\//);
    const [u] = await p.db.select().from(masterUsuario).where(eq(masterUsuario.id, id));
    expect(u).toMatchObject({ papel: 'master', ativo: true, deveTrocarSenha: true, totpUltimoPasso: null, totpMestraVersao: 1 });
    expect(u!.senhaHash).toMatch(/^\$argon2id\$/);
    expect(base32(decifrarSegredoTotp(MESTRA_TESTE, id, u!))).toBe(c.totp!.segredo);
    const trilha = JSON.stringify(await p.db.select().from(plataformaAudit).where(eq(plataformaAudit.acao, 'master.criar')));
    expect(trilha).toContain(id);
    expect(trilha).not.toContain(c.totp!.segredo);
    expect(trilha).not.toContain('abcd-efgh');
    const texto = textoCredenciais(c, true);
    expect(texto).toContain(c.totp!.uri);
    expect(texto).toContain('abcd-efgh-jkmn-pqrs');
  });

  it('e-mail já cadastrado (sem diferenciar maiúsculas): recusa, nada muda', async () => {
    const antes = await p.db.select().from(masterUsuario);
    await expect(comoAppPlataforma(p.client, () => criarUsuario(p.db, MESTRA_TESTE, f, validarCadastro({ email: 'OPERADOR@exemplo.test', nome: 'Outro Nome' }))))
      .rejects.toBeInstanceOf(ErroUsuarioPlataforma);
    expect(await p.db.select().from(masterUsuario)).toEqual(antes);
  });

  it('reemitir TOTP: segredo novo, anti-replay zerado, sessões revogadas; senha não muda sem --nova-senha', async () => {
    await p.db.update(masterUsuario).set({ totpUltimoPasso: 99, deveTrocarSenha: false, senhaTemporariaExpiraEm: null }).where(eq(masterUsuario.id, id));
    await p.db.insert(masterSessao).values({ tokenHash: 'a'.repeat(64), masterUsuarioId: id, expiraEm: new Date(Date.now() + 3600_000), totpConfirmadoEm: new Date() });
    const [antes] = await p.db.select().from(masterUsuario).where(eq(masterUsuario.id, id));
    const c = await comoAppPlataforma(p.client, () => reemitir(p.db, MESTRA_TESTE, f, 'operador@exemplo.test', { totp: true, senha: false }));
    expect(c.senhaTemporaria).toBeUndefined();
    const [u] = await p.db.select().from(masterUsuario).where(eq(masterUsuario.id, id));
    expect(u!.totpUltimoPasso).toBeNull();
    expect(u!.senhaHash).toBe(antes!.senhaHash);
    expect(u!.deveTrocarSenha).toBe(false);
    expect(base32(decifrarSegredoTotp(MESTRA_TESTE, id, u!))).toBe(c.totp!.segredo);
    const [s] = await p.db.select().from(masterSessao).where(eq(masterSessao.masterUsuarioId, id));
    expect(s!.motivoRevogacao).toBe('credencial_reemitida');
  });

  it('nova senha: temporária com troca obrigatória; e-mail inexistente é recusado', async () => {
    const c = await comoAppPlataforma(p.client, () => reemitir(p.db, MESTRA_TESTE, f, 'operador@exemplo.test', { totp: false, senha: true }));
    expect(c.senhaTemporaria).toBe('abcd-efgh-jkmn-pqrs');
    expect(c.totp).toBeUndefined();
    const [u] = await p.db.select().from(masterUsuario).where(eq(masterUsuario.id, id));
    expect(u!.deveTrocarSenha).toBe(true);
    expect(u!.senhaTemporariaExpiraEm).not.toBeNull();
    await expect(reemitir(p.db, MESTRA_TESTE, f, 'ninguem@exemplo.test', { totp: true, senha: false })).rejects.toThrow(/não encontrado/);
  });

  it('o banco recusa e-mail fora do formato e segredo TOTP com tamanho fora da faixa', async () => {
    const base = { nome: 'X X X', senhaHash: '$argon2id$x', papel: 'master', totpMestraVersao: 1 };
    await expect(p.db.insert(masterUsuario).values({ ...base, email: 'sem-arroba', totpCifrado: Buffer.alloc(48) })).rejects.toThrow();
    await expect(p.db.insert(masterUsuario).values({ ...base, email: 'ok@exemplo.test', totpCifrado: Buffer.alloc(8) })).rejects.toThrow();
  });
});

describe('serviço provisionador (HTTP interno)', () => {
  const TOKEN = 't'.repeat(40);
  const ID = '11111111-1111-4111-8111-111111111111';
  let atraso: Promise<void> | null = null;
  const chamadas: unknown[] = [];
  const srv = criarServidor({
    token: TOKEN,
    async provisionar(entrada, masterUsuarioId) {
      chamadas.push({ entrada, masterUsuarioId });
      if (atraso) await atraso;
      if ((entrada as { codigo?: string }).codigo === 'recusa') throw new ErroProvisionamento('o código recusa já está cadastrado');
      if ((entrada as { codigo?: string }).codigo === 'quebra') throw new Error('erro do pg com SQL e senha=xyz');
      return { situacao: 'provisionado', condominioId: ID, codigo: 'x', banco: 'portaria_abcdefgh', unidades: 1, migracoes: 1, modulos: [], chaves: [], sindico: { login: 's', senhaTemporaria: 'k', expiraEm: 'e' } } as ResultadoProvisionamento;
    },
  });
  let url = '';
  beforeAll(async () => { await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok)); url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`; });
  afterAll(async () => { await new Promise((ok) => srv.close(ok)); });

  const pedir = (corpo: unknown, token = TOKEN, caminho = '/provisionar') =>
    fetch(`${url}${caminho}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) });

  it('token: obrigatório e comparado em tempo constante; rota única', async () => {
    expect(autorizado(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(autorizado(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(autorizado(undefined, TOKEN)).toBe(false);
    expect((await pedir({ entrada: {}, masterUsuarioId: ID }, 'errado')).status).toBe(401);
    expect((await pedir({ entrada: {}, masterUsuarioId: ID }, TOKEN, '/outra')).status).toBe(404);
    expect(chamadas).toEqual([]);
    expect(() => tokenDoAmbiente({ PROVISIONADOR_TOKEN: 'curto' })).toThrow(/32/);
  });

  it('pedido malformado 400, corpo grande 413, recusa 422 com a mensagem, falha 500 sem detalhe, sucesso 200', async () => {
    expect((await pedir('{nao json')).status).toBe(400);
    expect((await pedir({ entrada: {}, masterUsuarioId: 'x' })).status).toBe(400);
    expect((await pedir({ entrada: {}, masterUsuarioId: ID, extra: 1 })).status).toBe(400);
    expect((await pedir({ entrada: { x: 'a'.repeat(70_000) }, masterUsuarioId: ID }).catch(() => ({ status: 413 }))).status).toBe(413);
    const r = await pedir({ entrada: { codigo: 'recusa' }, masterUsuarioId: ID });
    expect([r.status, ((await r.json()) as { erro: string }).erro]).toEqual([422, 'o código recusa já está cadastrado']);
    const q = await pedir({ entrada: { codigo: 'quebra' }, masterUsuarioId: ID });
    expect(q.status).toBe(500);
    expect(JSON.stringify(await q.json())).not.toContain('senha=xyz');
    const ok = await pedir({ entrada: { codigo: 'bom' }, masterUsuarioId: ID });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(((await ok.json()) as { resultado: ResultadoProvisionamento }).resultado.sindico?.senhaTemporaria).toBe('k');
  });

  it('um pedido por vez: o segundo simultâneo recebe 409', async () => {
    let soltar!: () => void;
    atraso = new Promise((ok) => { soltar = ok; });
    const primeiro = pedir({ entrada: { codigo: 'a' }, masterUsuarioId: ID });
    await new Promise((ok) => setTimeout(ok, 50));
    expect((await pedir({ entrada: { codigo: 'b' }, masterUsuarioId: ID })).status).toBe(409);
    soltar();
    expect((await primeiro).status).toBe(200);
    atraso = null;
  });
});
