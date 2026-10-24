// Contrato da API do Master (/api/v1/plataforma/*; docs/api/openapi.json). Sucesso vem em `{ data }`.
import type { Modulo } from '@portaria/domain/modulos';
import type { PapelPlataforma } from '@portaria/domain/rbac-plataforma';
import { criarCliente, type ClienteHttp } from './cliente';

/** Chave da lista no React Query (só cadastro da plataforma; nunca a senha do síndico). */
export const CHAVE_CONDOMINIOS = ['plataforma', 'condominios'] as const;

export interface UsuarioPlataforma { id: string; nome: string; email: string; papel: PapelPlataforma; deveTrocarSenha: boolean }
export interface SessaoInfo { expiraEm: string; inatividadeMin: number }
export type Situacao = 'provisionando' | 'ativo' | 'suspenso' | 'encerrado' | 'excluido';
export interface CondominioPlataforma {
  id: string; codigo: string; nome: string; cidade: string | null; uf: string | null; plano: string; situacao: Situacao; modulos: Modulo[]; criadoEm: string;
}
export interface NovoCondominio {
  codigo: string; nome: string; cidade: string; uf: string; plano?: string;
  estrutura: { agrupamento: 'Bloco' | 'Torre'; blocos: string[]; andares: number[]; finais: number[]; ausentes: string[] };
  areasComuns: string[];
  sindico: { nome: string; login: string };
}
export interface SenhaSindico { login: string; senhaTemporaria: string; expiraEm: string }
export interface ResultadoCriacao { situacao: 'provisionado' | 'retomado' | 'ja_provisionado'; condominio: CondominioPlataforma; sindico: SenhaSindico | null }

export interface ApiPlataforma {
  cliente: ClienteHttp;
  login(email: string, senha: string): Promise<{ usuario: UsuarioPlataforma; sessao: SessaoInfo }>;
  me(): Promise<{ usuario: UsuarioPlataforma; sessao: SessaoInfo }>;
  logout(): Promise<void>;
  trocarSenha(senhaAtual: string, novaSenha: string): Promise<UsuarioPlataforma>;
  condominios(): Promise<CondominioPlataforma[]>;
  criarCondominio(dados: NovoCondominio): Promise<ResultadoCriacao>;
  modulos(id: string, modulos: Modulo[]): Promise<CondominioPlataforma>;
}

export function criarApi(cliente: ClienteHttp = criarCliente(import.meta.env.VITE_API_URL ?? '/api/v1')): ApiPlataforma {
  const { http } = cliente;
  const dados = <T>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);
  return {
    cliente,
    login: (email, senha) => dados(http.post('/plataforma/auth/login', { email, senha })),
    me: () => dados(http.get('/plataforma/auth/me')),
    logout: async () => { await http.post('/plataforma/auth/logout'); },
    trocarSenha: (senhaAtual, novaSenha) => dados<{ usuario: UsuarioPlataforma }>(http.post('/plataforma/auth/trocar-senha', { senhaAtual, novaSenha })).then((r) => r.usuario),
    condominios: () => dados(http.get('/plataforma/condominios')),
    criarCondominio: (d) => dados(http.post('/plataforma/condominios', d)),
    modulos: (id, modulos) => dados(http.patch(`/plataforma/condominios/${encodeURIComponent(id)}/modulos`, { modulos })),
  };
}
