import { defineConfig, devices } from '@playwright/test';

// E2E contra a API REAL (Docker local em 127.0.0.1:3000), separado da suíte padrão (mock): `npm run test:e2e:http`.
// Vite em modo http numa porta própria (5182), com o proxy /api -> API. Sem API de pé, os testes se pulam sozinhos.
const PORTA = 5182;

export default defineConfig({
  testDir: './e2e/http',
  outputDir: './test-results/http',
  reporter: [['list']],
  fullyParallel: false,
  workers: 1, // um fluxo só, com estado no banco real
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORTA}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1440, height: 900 },
    // Sem trace/vídeo: o trace grava o que é digitado (senha do seed e senhas temporárias) em disco.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium-http', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx vite --port ${PORTA} --strictPort`,
    url: `http://localhost:${PORTA}`,
    env: { VITE_API_MODE: 'http', VITE_API_URL: '/api/v1' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
