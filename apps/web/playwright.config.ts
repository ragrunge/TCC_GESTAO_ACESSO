import { defineConfig, devices } from '@playwright/test';
import { API_E2E, PORTA_API_E2E, SENHA_E2E } from './e2e/ambiente';

// E2E do sistema de Gestão de Acesso contra a API REAL (AppModule do NestJS) sobre PGlite em memória, com as migrações reais e
// dados fictícios: `npm run dev:pglite -w apps/api`. Sem Docker e sem tocar em produção. O Vite (porta própria, 5180,
// para não colidir com o dev na 5173) repassa /api para ela pelo proxy, como a Vercel faz em produção.
// Um banco só para a suíte: os testes rodam em série e cada um começa do banco semeado (reset em e2e/helpers.ts).
const PORTA = 5180;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORTA}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1440, height: 900 },
    // A senha digitada no trace é a do e2e (fictícia, só da API de teste).
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      // A API recusa subir com PORTARIA_AMBIENTE=producao, NODE_ENV=production ou DATABASE_URL no ambiente.
      command: 'npm run dev:pglite',
      cwd: '../api',
      url: `${API_E2E}/api/v1/saude`,
      env: { PORTA_E2E: String(PORTA_API_E2E), E2E_SENHA: SENHA_E2E },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `npx vite --port ${PORTA} --strictPort`,
      url: `http://localhost:${PORTA}`,
      env: { API_PROXY_ALVO: API_E2E },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
