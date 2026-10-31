/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// O front chama '/api/v1' na própria origem e o Vite repassa à API. Mesma origem = o cookie de sessão (HttpOnly,
// SameSite=Strict) funciona sem CORS, como no rewrite da Vercel.
// Alvo padrão: a API local sobre PGlite (`npm run dev:pglite -w apps/api` ou `npm run local`, porta 3101, dados
// fictícios). API_PROXY_ALVO sobrepõe (o e2e aponta para a API de teste dele; ver playwright.config.ts).
// Alvo remoto (https): o Host precisa ser o do alvo, senão o proxy reverso de lá escolhe outro site.
const API_ALVO = process.env.API_PROXY_ALVO ?? 'http://127.0.0.1:3101';
const proxy = { '/api': { target: API_ALVO, changeOrigin: API_ALVO.startsWith('https:'), secure: true } };

// PWA: só o SHELL (JS/CSS/HTML/ícones/fontes do build) fica em cache, para o app ser instalável e abrir rápido.
// REGRA DURA (LGPD + trilha append-only): NADA de /api no cache do service worker. Por isso: sem runtimeCaching,
// `navigateFallbackDenylist` barra /api, e não há fila offline (outra fase, com decisão de arquitetura).
// `prompt`: a versão nova só entra quando a pessoa clica em "Atualizar" (nunca recarrega no meio de um cadastro).
// O manifest é o `public/site.webmanifest` (já referenciado no index.html), por isso `manifest: false`.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
        globIgnores: ['og-image.png'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5173, proxy },
  preview: { proxy },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
