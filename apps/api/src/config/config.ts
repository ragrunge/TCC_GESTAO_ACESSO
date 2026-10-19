// Configuração da API, lida UMA vez do ambiente e validada no boot: valor ausente ou ambíguo derruba o processo
// em vez de virar um default silencioso (ex.: COOKIE_SECURE=1 não significa nada e é recusado).
import { Buffer } from 'node:buffer';

export const CONFIG = Symbol('CONFIG');

export type Ambiente = 'dev' | 'producao';

export interface Config {
  ambiente: Ambiente;
  /** false: sem proxy (req.ip = socket). Número: quantos saltos de proxy confiáveis há na frente da API. */
  trustProxy: false | number;
  /** Origens exatas para CORS com credenciais. Vazio: CORS desligado (produção usa a mesma origem via rewrite). */
  corsOrigens: string[];
  cookie: { secure: boolean; nome: string };
  sessao: { absolutaMin: number; inatividadeMin: number; /** intervalo mínimo entre gravações de ultimo_uso_em */ toqueSeg: number };
  login: {
    maxFalhasLogin: number;
    maxFalhasIp: number;
    janelaMin: number;
    bloqueioMin: number;
    /** atraso crescente nas falhas: base * 2^(n-1), limitado a atrasoMaxMs */
    atrasoBaseMs: number;
    atrasoMaxMs: number;
  };
  /** spec §5.1: 64 MiB, 3 iterações, paralelismo 1. `concorrencia` limita hashes simultâneos POR PROCESSO (memória). */
  argon2: { memoriaKib: number; iteracoes: number; paralelismo: number; concorrencia: number; filaMax: number };
  /** Chave do HMAC do CPF; a API deriva dela (HKDF) uma subchave para o login_limite, sem reusar a chave em si. */
  hmacCpfKey: Buffer;
  /**
   * Importação da planilha (RF-11, RN-09): prazo, em dias, para regularizar o vínculo legado. O valor é definido em
   * assembleia (`IMPORTACAO_PRAZO_LEGADO_DIAS`, padrão 90, de 1 a 730).
   */
  importacao: { prazoLegadoDias: number };
  /**
   * Anexos cifrados (RNF-03, spec §9.2): KEK de 32 bytes (`PORTARIA_KEK`, base64) e a versão dela (`PORTARIA_KEK_VERSAO`),
   * gravada em `documento.chave_versao`; `dir` é a pasta dos arquivos cifrados (`PORTARIA_DOCUMENTOS_DIR`), fora do banco.
   */
  documentos: { kek: Buffer; kekVersao: number; dir: string };
}

/**
 * Padrões da spec §5.1 (§14 nº 27): 10 falhas por login e 30 por IP numa janela de 15 min bloqueiam por 15 min.
 * O IP é mais folgado porque a guarita sai por um único IP (NAT) e vários operadores dividem o contador; o limite que
 * protege cada conta é o por login. Os quatro números são ajustáveis por ambiente (LOGIN_MAX_FALHAS_LOGIN,
 * LOGIN_MAX_FALHAS_IP, LOGIN_JANELA_MIN, LOGIN_BLOQUEIO_MIN); vazio ou ausente usa o padrão. O atraso crescente não.
 */
export const PADROES_LOGIN: Config['login'] = {
  maxFalhasLogin: 10, maxFalhasIp: 30, janelaMin: 15, bloqueioMin: 15, atrasoBaseMs: 250, atrasoMaxMs: 3000,
};
/** Prazo de regularização do legado (RN-09) quando a assembleia não definiu outro. */
export const PRAZO_LEGADO_PADRAO_DIAS = 90;
export const PADROES_ARGON2: Config['argon2'] = { memoriaKib: 64 * 1024, iteracoes: 3, paralelismo: 1, concorrencia: 2, filaMax: 50 };

export const nomeCookie = (secure: boolean) => (secure ? '__Host-portaria_sessao' : 'portaria_sessao');

class ErroConfig extends Error {}

function exigir(env: NodeJS.ProcessEnv, nome: string): string {
  const v = env[nome];
  if (v === undefined || v.trim() === '') throw new ErroConfig(`${nome} não definida`);
  return v.trim();
}

function booleano(env: NodeJS.ProcessEnv, nome: string): boolean {
  const v = exigir(env, nome);
  // Só 'true'/'false': coerção por truthiness ligaria a flag com a string 'false'.
  if (v !== 'true' && v !== 'false') throw new ErroConfig(`${nome} deve ser 'true' ou 'false'`);
  return v === 'true';
}

function inteiro(env: NodeJS.ProcessEnv, nome: string, padrao: number, min: number, max: number): number {
  const bruto = env[nome]?.trim();
  if (bruto === undefined || bruto === '') return padrao;
  if (!/^\d+$/.test(bruto)) throw new ErroConfig(`${nome} deve ser inteiro`);
  const n = Number(bruto);
  if (n < min || n > max) throw new ErroConfig(`${nome} deve estar entre ${min} e ${max}`);
  return n;
}

/** Pasta padrão dos anexos cifrados no container (volume `documentos` do compose). */
export const DOCUMENTOS_DIR_PADRAO = '/var/lib/portaria/documentos';

function carregarDocumentos(env: NodeJS.ProcessEnv): Config['documentos'] {
  const kek = Buffer.from(exigir(env, 'PORTARIA_KEK'), 'base64');
  // AES-256: exatamente 32 bytes. Mais ou menos que isso é chave colada errada, não "mais segura".
  if (kek.length !== 32) throw new ErroConfig('PORTARIA_KEK precisa ter exatamente 32 bytes (base64)');
  const kekVersao = inteiro(env, 'PORTARIA_KEK_VERSAO', 0, 1, 32767);
  if (kekVersao === 0) throw new ErroConfig('PORTARIA_KEK_VERSAO não definida');
  const dir = env.PORTARIA_DOCUMENTOS_DIR?.trim() || DOCUMENTOS_DIR_PADRAO;
  if (!dir.startsWith('/')) throw new ErroConfig('PORTARIA_DOCUMENTOS_DIR deve ser um caminho absoluto');
  return { kek, kekVersao, dir };
}

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const ambiente = exigir(env, 'PORTARIA_AMBIENTE');
  if (ambiente !== 'dev' && ambiente !== 'producao') throw new ErroConfig("PORTARIA_AMBIENTE deve ser 'dev' ou 'producao'");

  const secure = booleano(env, 'COOKIE_SECURE');
  // Cookie sem Secure só faz sentido em http://localhost. Em produção, recusar no boot é mais barato que descobrir depois.
  if (ambiente === 'producao' && !secure) throw new ErroConfig('COOKIE_SECURE=false não é permitido com PORTARIA_AMBIENTE=producao');

  const tp = exigir(env, 'TRUST_PROXY');
  let trustProxy: false | number;
  if (tp === 'false') trustProxy = false;
  else if (/^[1-3]$/.test(tp)) trustProxy = Number(tp);
  else throw new ErroConfig("TRUST_PROXY deve ser 'false' ou o número de proxies confiáveis (1 a 3)");

  const corsOrigens = (env.CORS_ORIGENS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const o of corsOrigens) {
    let origem: string;
    try { origem = new URL(o).origin; } catch { throw new ErroConfig(`CORS_ORIGENS: origem inválida (${o})`); }
    // Origem exata (sem barra, sem caminho, sem curinga): CORS que reflete Origin anula o SameSite.
    if (origem !== o) throw new ErroConfig(`CORS_ORIGENS: use a origem exata, sem caminho nem barra final (${o})`);
  }

  const absolutaMin = inteiro(env, 'SESSAO_ABSOLUTA_MIN', 720, 5, 24 * 60);
  const inatividadeMin = inteiro(env, 'SESSAO_INATIVIDADE_MIN', 30, 1, 24 * 60);
  if (inatividadeMin > absolutaMin) throw new ErroConfig('SESSAO_INATIVIDADE_MIN não pode passar de SESSAO_ABSOLUTA_MIN');

  const hmacCpfKey = Buffer.from(exigir(env, 'PORTARIA_HMAC_CPF_KEY'), 'base64');
  if (hmacCpfKey.length < 32) throw new ErroConfig('PORTARIA_HMAC_CPF_KEY precisa de pelo menos 32 bytes (base64)');

  return {
    ambiente,
    trustProxy,
    corsOrigens,
    cookie: { secure, nome: nomeCookie(secure) },
    sessao: { absolutaMin, inatividadeMin, toqueSeg: 60 },
    login: {
      ...PADROES_LOGIN,
      // Faixas: abaixo do mínimo o erro de digitação bloqueia a guarita; acima do máximo o limite deixa de proteger.
      maxFalhasLogin: inteiro(env, 'LOGIN_MAX_FALHAS_LOGIN', PADROES_LOGIN.maxFalhasLogin, 3, 50),
      maxFalhasIp: inteiro(env, 'LOGIN_MAX_FALHAS_IP', PADROES_LOGIN.maxFalhasIp, 3, 500),
      janelaMin: inteiro(env, 'LOGIN_JANELA_MIN', PADROES_LOGIN.janelaMin, 1, 24 * 60),
      bloqueioMin: inteiro(env, 'LOGIN_BLOQUEIO_MIN', PADROES_LOGIN.bloqueioMin, 1, 24 * 60),
    },
    argon2: { ...PADROES_ARGON2 },
    hmacCpfKey,
    importacao: { prazoLegadoDias: inteiro(env, 'IMPORTACAO_PRAZO_LEGADO_DIAS', PRAZO_LEGADO_PADRAO_DIAS, 1, 730) },
    documentos: carregarDocumentos(env),
  };
}
