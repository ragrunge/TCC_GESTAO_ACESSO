// Cria (ou reemite a credencial de) um usuário da plataforma, o "Master" (docs/05_arquitetura_saas.md SAAS-07/08;
// docs/deploy.md seção 18). Regras em src/master/usuario-plataforma.ts. Na VPS, num TERMINAL COMUM (nunca pelo `!` do
// Claude Code nem por ferramenta que guarde a saída: ela traz a senha temporária e o segredo TOTP):
//
//   docker compose --profile plataforma run --rm usuario-plataforma-cli --email <e-mail> --nome "<nome>" [--papel master|suporte]
//   docker compose --profile plataforma run --rm usuario-plataforma-cli --email <e-mail> --reemitir-totp [--nova-senha]
//   docker compose --profile plataforma run --rm usuario-plataforma-cli --email <e-mail> --nova-senha
//
// Ambiente: DATABASE_URL_PLATAFORMA (app_plataforma no banco plataforma) e PORTARIA_CHAVE_MESTRA(_VERSAO), que cifra o
// segredo TOTP. Saída: a senha temporária (72 h, troca obrigatória no primeiro login), o segredo TOTP em base32 e a URI
// otpauth:// para o aplicativo autenticador, UMA vez. Nada disso fica gravado em claro. Códigos: 0 ok; 1 recusa; 2 uso.
import { hash } from '@node-rs/argon2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { gerarSenhaTemporaria } from '../auth/senha.service';
import { PADROES_ARGON2 } from '../config/config';
import { carregarChaveMestra } from '../saas/chave-mestra';
import { type DbPlataforma, urlPlataforma } from '../saas/plataforma-db';
import * as sp from '../saas/schema-plataforma';
import { type Credenciais, criarUsuario, ErroUsuarioPlataforma, reemitir, validarCadastro } from '../master/usuario-plataforma';

const USO = [
  'uso: criar-usuario-plataforma.js --email <e-mail> --nome "<nome>" [--papel master|suporte]',
  '     criar-usuario-plataforma.js --email <e-mail> [--reemitir-totp] [--nova-senha]',
].join('\n');

export class ErroUsoCli extends Error {}

export interface ArgsCli { email?: string; nome?: string; papel?: string; reemitirTotp: boolean; novaSenha: boolean }

export function lerArgsUsuario(argv: string[]): ArgsCli {
  const a: ArgsCli = { reemitirTotp: false, novaSenha: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if ((k === '--email' || k === '--nome' || k === '--papel') && v !== undefined && !v.startsWith('--')) {
      a[k.slice(2) as 'email' | 'nome' | 'papel'] = v;
      i++;
    } else if (k === '--reemitir-totp') a.reemitirTotp = true;
    else if (k === '--nova-senha') a.novaSenha = true;
    else throw new ErroUsoCli(USO);
  }
  if (!a.email) throw new ErroUsoCli(USO);
  const reemissao = a.reemitirTotp || a.novaSenha;
  if (reemissao && (a.nome || a.papel)) throw new ErroUsoCli(`${USO}\n(--nome e --papel só na criação)`);
  if (!reemissao && !a.nome) throw new ErroUsoCli(USO);
  return a;
}

/** Bloco do terminal. A URI vai inteira (o operador gera o QR localmente, ou digita o segredo no aplicativo). */
export function textoCredenciais(c: Credenciais, criado: boolean): string {
  const linhas = ['', '============ CREDENCIAIS DA PLATAFORMA (mostradas UMA vez; não ficam guardadas) ============',
    `  ${criado ? 'usuário criado' : 'credencial reemitida'}: ${c.email}`];
  if (c.senhaTemporaria) linhas.push(`  senha temporária:      ${c.senhaTemporaria}`, `  válida até:            ${c.senhaExpiraEm} (troca obrigatória no primeiro login)`);
  if (c.totp) {
    linhas.push('  segundo fator (TOTP, SHA1, 6 dígitos, 30 s): cadastre no aplicativo autenticador AGORA',
      `  segredo (digitação):   ${c.totp.segredo.replace(/(.{4})/g, '$1 ').trim()}`,
      `  URI otpauth:           ${c.totp.uri}`);
  }
  linhas.push(criado ? '  Entregue por canal fora do sistema.' : '  Entregue por canal fora do sistema. Sessões abertas deste usuário foram encerradas.',
    '=============================================================================================', '');
  return linhas.join('\n');
}

async function principal(): Promise<number> {
  let args: ArgsCli;
  let url: string;
  let mestra: ReturnType<typeof carregarChaveMestra>;
  try {
    args = lerArgsUsuario(process.argv.slice(2));
    url = urlPlataforma(process.env);
    mestra = carregarChaveMestra(process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return e instanceof ErroUsoCli ? 2 : 1;
  }
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  pool.on('error', () => undefined);
  try {
    const db = drizzle(pool, { schema: sp }) as unknown as DbPlataforma;
    const f = {
      hashSenha: (s: string) => hash(s, { memoryCost: PADROES_ARGON2.memoriaKib, timeCost: PADROES_ARGON2.iteracoes, parallelism: PADROES_ARGON2.paralelismo }),
      gerarSenha: () => gerarSenhaTemporaria(),
    };
    const reemissao = args.reemitirTotp || args.novaSenha;
    const c = reemissao
      ? await reemitir(db, mestra, f, args.email!, { totp: args.reemitirTotp, senha: args.novaSenha })
      : await criarUsuario(db, mestra, f, validarCadastro(args));
    console.log(textoCredenciais(c, !reemissao));
    return 0;
  } catch (e) {
    if (e instanceof ErroUsuarioPlataforma) { console.error(`RECUSADO: ${e.message}`); return 1; }
    console.error(`RECUSADO: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    mestra.chave.fill(0);
    await pool.end().catch(() => undefined);
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  principal().then((c) => { process.exitCode = c; }, (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
