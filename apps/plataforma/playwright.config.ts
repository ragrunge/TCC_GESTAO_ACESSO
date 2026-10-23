import { defineConfig, devices } from '@playwright/test';
import { API_E2E, PORTA_API_E2E, PORTA_E2E, SENHA_E2E } from './e2e/ambiente';

// E2E do app do Master contra a API REAL (AppModule) sobre PGlite em memória (`npm run dev:pglite -w apps/api`), com os
// usuários fictícios da plataforma (apps/api/test/e2e/masters.ts) e o provisionamento sobre PGlite. Portas próprias
// (3102/5181), para não colidir com o e2e do apps/web (3101/5180). Sem Docker e sem tocar em produção.
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: `http://localhost:${PORTA_E2E}`, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
  webServer: [
    {
      command: 'npm run dev:pglite',
      cwd: '../api',
      url: `${API_E2E}/api/v1/saude`,
      env: { PORTA_E2E: String(PORTA_API_E2E), E2E_SENHA: SENHA_E2E },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx vite --port ${PORTA_E2E} --strictPort`,
      url: `http://localhost:${PORTA_E2E}/admin/`,
      env: { API_PROXY_ALVO: API_E2E },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
