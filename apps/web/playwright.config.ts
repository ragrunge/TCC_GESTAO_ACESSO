import { defineConfig, devices } from '@playwright/test';

// E2E do Portaria Parque. O app usa API mock em localStorage; cada teste começa com storage limpo (ver e2e/helpers.ts).
// Porta própria (5180) para não colidir com o servidor de desenvolvimento aberto na 5173.
const PORTA = 5180;

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['http/**'], // e2e contra a API real: playwright.http.config.ts (npm run test:e2e:http)
  outputDir: './test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  fullyParallel: true,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://localhost:${PORTA}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx vite --port ${PORTA} --strictPort`,
    url: `http://localhost:${PORTA}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
