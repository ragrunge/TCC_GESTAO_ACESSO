/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// O front chama '/api/v1' na própria origem e o Vite repassa à API. Mesma origem = o cookie de sessão (HttpOnly,
// SameSite=Strict) funciona sem CORS, como no rewrite da Vercel.
// Alvo padrão: a API de PRODUÇÃO da VPS (dado real; a trilha é append-only: não testar escrita ali). API_PROXY_ALVO
// sobrepõe (o e2e aponta para a API de teste sobre PGlite; ver playwright.config.ts).
// Alvo remoto (https): o Host precisa ser o do alvo, senão o nginx de lá escolhe outro site.
const API_ALVO = process.env.API_PROXY_ALVO ?? 'https://179-197-78-78.sslip.io';
const proxy = { '/api': { target: API_ALVO, changeOrigin: API_ALVO.startsWith('https:'), secure: true } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { proxy },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
