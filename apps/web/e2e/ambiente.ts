// Constantes do e2e compartilhadas pelo playwright.config.ts e pelas specs. A API de teste (apps/api/test/e2e) roda
// sobre PGlite em memória, com dados fictícios; a senha é dela, não vale em nenhum outro ambiente.
export const PORTA_API_E2E = 3101;
export const API_E2E = `http://127.0.0.1:${PORTA_API_E2E}`;
export const SENHA_E2E = 'senha-e2e-portaria-parque';
