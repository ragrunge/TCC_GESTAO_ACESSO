// Constantes do e2e do app do Master. Tudo fictício e só da API de teste (apps/api/test/e2e): a senha é a do modo e2e
// (não vale em nenhum outro ambiente). Sem segundo fator desde 2026-10-23 (SAAS-08).

export const PORTA_API_E2E = 3102;
export const PORTA_E2E = 5181;
export const API_E2E = `http://127.0.0.1:${PORTA_API_E2E}`;
export const SENHA_E2E = 'senha-e2e-portaria-parque';
export const MASTER = 'master@exemplo.test';
export const NOVO_MASTER = 'novo.master@exemplo.test';
