/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// O app do Master chama '/api/v1' na própria origem e o Vite repassa à API (em produção, o rewrite da Vercel). Mesma
// origem = o cookie da plataforma (HttpOnly, SameSite=Strict, Path=/api/v1/plataforma) funciona sem CORS.
// Alvo PADRÃO: a API LOCAL de teste (PGlite em memória, dados fictícios: `npm run dev:pglite -w apps/api`), NUNCA a
// produção. Daqui se cria condomínio (banco novo, senha de síndico) e se liga/desliga módulo: apontar para a produção
// é decisão explícita, pela variável de shell API_PROXY_ALVO, e só para consultar.
const API_ALVO = process.env.API_PROXY_ALVO ?? 'http://127.0.0.1:3101';
const proxy = { '/api': { target: API_ALVO, changeOrigin: API_ALVO.startsWith('https:'), secure: true } };

// Servido em /admin/ dentro do mesmo site (e projeto Vercel) do apps/web. As chamadas à API seguem absolutas (/api/v1).
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: { port: 5174, proxy },
  preview: { proxy },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
