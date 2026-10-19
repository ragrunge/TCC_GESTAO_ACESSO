// API de verdade (AppModule, guards e filtro globais, configurarApp) sobre um PGlite com as migrações reais.
// HTTP real via supertest: o defeito de wiring de decorator (pipe, guard, @Publico) só aparece assim.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from '@node-rs/argon2';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { type Config, CONFIG, nomeCookie, PADROES_LOGIN } from '../../src/config/config';
import { RELOGIO } from '../../src/comum/relogio';
import { DB, PG_POOL } from '../../src/database/database.module';
import * as s from '../../src/db/schema';
import { seedEstrutura } from '../../src/db/seed';
import { seedUsuariosDev, USUARIOS_DEV } from '../../src/db/seed-usuarios';
import { configurarApp } from '../../src/plataforma';
import { ENVIO_ANCORA, type EnvioAncora, type ResumoSelo, SemDestinoAncora } from '../../src/selo/ancora';
import { CHAVE_HMAC_TESTE, PASTA_MIGRACOES } from './banco';

export const SENHA = 'senha-de-teste-bem-longa';
export const LOGINS = { sindico: 'roberto.faria', administracao: 'paula.nogueira', porteiro: 'joao.lima', auditor: 'luiza.campos' } as const;
export type PapelTeste = keyof typeof LOGINS;

export class RelogioDeTeste {
  constructor(public atual = new Date('2026-10-17T12:00:00.000Z')) {}
  agora() { return new Date(this.atual); }
  avancarMin(min: number) { this.atual = new Date(this.atual.getTime() + min * 60_000); }
}

let dirSeq = 0;

export function configDeTeste(extra: Partial<Config> = {}): Config {
  return {
    ambiente: 'dev',
    trustProxy: 1, // os testes simulam IPs distintos com X-Forwarded-For
    corsOrigens: [],
    cookie: { secure: true, nome: nomeCookie(true) },
    sessao: { absolutaMin: 720, inatividadeMin: 30, toqueSeg: 60 },
    login: { ...PADROES_LOGIN, atrasoBaseMs: 0 },
    // Parâmetros baixos SÓ no teste (velocidade); produção usa PADROES_ARGON2 (spec §5.1).
    argon2: { memoriaKib: 1024, iteracoes: 1, paralelismo: 1, concorrencia: 2, filaMax: 50 },
    hmacCpfKey: CHAVE_HMAC_TESTE,
    importacao: { prazoLegadoDias: 90 },
    // Pasta temporária por API de teste (novaApi): o conteúdo cifrado fica nela e o teste confere que não há texto claro.
    documentos: { kek: Buffer.alloc(32, 9), kekVersao: 1, dir: join(tmpdir(), `portaria-docs-${process.pid}-${++dirSeq}`) },
    // Sem destino de âncora e sem agendador: os testes chamam as rotinas sob demanda (e trocam o envio por um falso).
    ancora: { github: false, emails: [], remetente: 'portaria@localhost', smtp: null, arquivo: null },
    jobs: { agendador: false, intervaloMin: 10, horaRetencaoBrt: 3 },
    retencao: { anexoOcorrenciaAnos: null },
    ...extra,
  };
}

let ipSeq = 0;
/** IP único por chamada (o limite por IP não interfere entre testes que não o exercitam). */
export const novoIp = () => `10.0.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

/** Âncora falsa para os testes: guarda o que seria enviado; `falhar` simula SMTP fora do ar. */
export class AncoraDeTeste implements EnvioAncora {
  enviados: ResumoSelo[] = [];
  falhar = false;
  constructor(public lista = ['e-mail: conselho@exemplo.org']) {}
  destinos() { return this.lista; }
  async enviar(r: ResumoSelo) {
    if (!this.lista.length) throw new SemDestinoAncora();
    if (this.falhar) throw Object.assign(new Error('smtp fora'), { code: 'ECONNREFUSED' });
    this.enviados.push(r);
    return this.lista.join('; ');
  }
}

export async function novaApi(extra: Partial<Config> = {}, opcoes: { ancora?: EnvioAncora } = {}) {
  const client = new PGlite();
  await client.exec('CREATE ROLE app_migrator NOLOGIN; CREATE ROLE app_rw NOLOGIN;');
  const db = drizzle(client, { schema: s });
  await migrate(db, { migrationsFolder: PASTA_MIGRACOES });
  await seedEstrutura(db);
  const config = configDeTeste(extra);
  const senhaHash = await hash(SENHA, { memoryCost: config.argon2.memoriaKib, timeCost: 1, parallelism: 1 });
  await seedUsuariosDev(db, { senhaHash, deveTrocarSenha: false });
  const relogio = new RelogioDeTeste();

  let construtor = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PG_POOL).useValue({ end: async () => undefined })
    .overrideProvider(DB).useValue(db)
    .overrideProvider(CONFIG).useValue(config)
    .overrideProvider(RELOGIO).useValue(relogio);
  if (opcoes.ancora) construtor = construtor.overrideProvider(ENVIO_ANCORA).useValue(opcoes.ancora);
  const mod = await construtor.compile();
  const app = mod.createNestApplication<NestExpressApplication>({ logger: false });
  configurarApp(app, config);
  await app.listen(0, '127.0.0.1'); // uma porta só: o supertest não abre um servidor por requisição

  const usuarios = Object.fromEntries(
    (await db.select().from(s.usuarioSistema)).map((u) => [u.login, u]),
  ) as Record<string, typeof s.usuarioSistema.$inferSelect>;

  const http = () => request(app.getHttpServer());

  /** Login; devolve o cabeçalho Cookie pronto para as próximas chamadas (o agente do supertest não envia Secure em http). */
  async function entrar(login: string, senha = SENHA, ip = novoIp()) {
    const r = await http().post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ login, senha });
    if (r.status !== 200) throw new Error(`login de ${login} falhou: ${r.status} ${JSON.stringify(r.body)}`);
    return { cookie: cookieDe(r.headers['set-cookie']), corpo: r.body.data, ip };
  }
  const como = (papel: PapelTeste) => entrar(LOGINS[papel]);

  return { app: app as INestApplication, client, db, config, relogio, usuarios, http, entrar, como, USUARIOS_DEV };
}

export type ApiDeTeste = Awaited<ReturnType<typeof novaApi>>;

/** "nome=valor" do Set-Cookie de sessão (para mandar de volta em Cookie). */
export function cookieDe(setCookie: string | string[] | undefined): string {
  const linhas = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const linha = linhas.find((l) => l.startsWith(nomeCookie(true)) || l.startsWith(nomeCookie(false)));
  if (!linha) throw new Error('resposta sem cookie de sessão');
  return linha.split(';')[0]!;
}

/** Linhas do audit_log por ação, em ordem. */
export async function trilha(api: ApiDeTeste, acao?: string) {
  const linhas = await api.db.select().from(s.auditLog).orderBy(s.auditLog.seq);
  return acao ? linhas.filter((l) => l.acao === acao) : linhas;
}
