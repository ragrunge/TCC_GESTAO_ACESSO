/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Modo http: o front chama '/api/v1' na própria origem e o Vite repassa à API local (Docker em 127.0.0.1:3000).
// Mesma origem = o cookie de sessão (HttpOnly, SameSite=Strict) funciona sem CORS, como no rewrite da Vercel.
// Alvo remoto (https, ex.: a API da VPS): o Host precisa ser o do alvo, senão o nginx de lá escolhe outro site.
const API_ALVO = process.env.API_PROXY_ALVO ?? 'http://127.0.0.1:3000';
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
