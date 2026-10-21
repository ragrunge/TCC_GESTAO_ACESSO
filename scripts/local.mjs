// `npm run local`: sobe o sistema inteiro na máquina, sem Docker e sem tocar na produção.
// API de verdade sobre PGlite em memória (migrações reais + dados fictícios, apps/api/test/e2e) e o front com o proxy
// apontando para ela. O banco nasce limpo a cada execução e some ao parar (Ctrl+C).
import { spawn } from 'node:child_process';

const PORTA_API = 3101;
const API = `http://127.0.0.1:${PORTA_API}`;
const SENHA = 'senha-e2e-portaria-parque'; // a mesma de apps/api/test/e2e/servidor.ts; só vale neste modo
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const filhos = [];
function rodar(args, env) {
  const p = spawn(npm, args, { stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' });
  p.on('exit', (codigo) => encerrar(codigo ?? 1));
  filhos.push(p);
  return p;
}

let encerrando = false;
function encerrar(codigo) {
  if (encerrando) return;
  encerrando = true;
  for (const p of filhos) if (p.exitCode === null) p.kill('SIGTERM');
  process.exit(codigo);
}
process.once('SIGINT', () => encerrar(0));
process.once('SIGTERM', () => encerrar(0));

async function esperarApi() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${API}/api/v1/saude`);
      if (r.ok) return;
    } catch { /* ainda subindo */ }
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  console.error(`a API local não respondeu em ${API} depois de 2 minutos`);
  encerrar(1);
}

rodar(['run', 'dev:pglite', '-w', 'apps/api'], { PORTA_E2E: String(PORTA_API), E2E_SENHA: SENHA });
await esperarApi();
rodar(['run', 'dev', '-w', 'apps/web'], { API_PROXY_ALVO: API });

console.log(`
  Sistema local (dados fictícios, banco em memória)
  Front:   http://localhost:5173
  Swagger: ${API}/api/v1/docs
  Login:   roberto.faria (síndico), paula.nogueira (administração), joao.lima (porteiro), luiza.campos (auditor)
  Senha:   ${SENHA}
  Ctrl+C para parar (o banco é descartado).
`);
