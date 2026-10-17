import type {
  AutorizacaoPrevia, Encomenda, EventoAcesso, Funcionario, Ocorrencia, Pessoa, Restricao, Unidade,
  RegistroAlteracao, UsuarioSistema, VinculoUnidade, Veiculo,
} from '@portaria/domain/types';

/** Estado completo do "banco" em memória (serializável em JSON para o localStorage). */
export interface DbData {
  versao: number;
  pessoas: Pessoa[];
  funcionarios: Funcionario[];
  unidades: Unidade[];
  vinculos: VinculoUnidade[];
  veiculos: Veiculo[];
  autorizacoes: AutorizacaoPrevia[];
  restricoes: Restricao[];
  eventos: EventoAcesso[];
  encomendas: Encomenda[];
  ocorrencias: Ocorrencia[];
  usuarios: UsuarioSistema[];
  /** Trilha de alterações (append-only). */
  auditLog: RegistroAlteracao[];
  /** Instante simulado no momento do último salvamento (o relógio retoma dali ao recarregar). */
  salvoEm: number;
}

export const VERSAO_DB = 2;
