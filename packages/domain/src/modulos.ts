// Módulos por condomínio (docs/05_arquitetura_saas.md, "Módulos por condomínio", 2026-10-22). Fonte única da lista para a
// plataforma (coluna `condominio.modulos`, CHECK e default da migração drizzle-plataforma/0002), para a API (recusa de
// rota de módulo desligado, fase posterior) e para os fronts (menu do condomínio, tela de licenças do Master).
//
// Só o que é opcional por contrato entra aqui. O núcleo da portaria nunca desliga: autenticação, usuários, unidades,
// pessoas, vínculos, eventos de acesso, restrições (RF-16: a portaria confere restrição em toda entrada), trilha,
// selo e LGPD (obrigação legal do controlador).
//
// Mudar esta lista exige migração da plataforma (o CHECK e o default repetem os valores; o teste
// test/saas-provisionar.test.ts confere a migração contra esta lista). Módulo novo nasce DESLIGADO nos condomínios
// existentes, a menos que a migração diga o contrário (decisão comercial, não técnica).

export const MODULOS = [
  'encomendas',
  'ocorrencias',
  'autorizacoes_previas',
  'importacao',
  'veiculos',
  'funcionarios',
  'relatorios',
] as const;

export type Modulo = (typeof MODULOS)[number];

/** Rótulo exibido (tela de licenças do Master, aviso de módulo desligado). */
export const ROTULO_MODULO: Record<Modulo, string> = {
  encomendas: 'Encomendas',
  ocorrencias: 'Ocorrências',
  autorizacoes_previas: 'Autorizações prévias',
  importacao: 'Importação de planilha',
  veiculos: 'Veículos',
  funcionarios: 'Funcionários',
  relatorios: 'Relatórios',
};

/** Padrão de um condomínio novo: todos os módulos existentes ligados. */
export const MODULOS_PADRAO: readonly Modulo[] = MODULOS;

export const ehModulo = (m: string): m is Modulo => (MODULOS as readonly string[]).includes(m);
