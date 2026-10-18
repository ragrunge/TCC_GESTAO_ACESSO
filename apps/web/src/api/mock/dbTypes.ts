import type {
  AreaComum, AutorizacaoPrevia, AutorizacaoRetirada, Encomenda, EventoAcesso, Funcionario, Importacao, Ocorrencia, Pessoa,
  PontoAcesso, Restricao, Unidade, RegistroAlteracao, UsuarioSistema, VinculoUnidade, Veiculo,
} from '@portaria/domain/types';

/** Estado completo do "banco" em memória (serializável em JSON para o localStorage). Mesmas tabelas do schema. */
export interface DbData {
  versao: number;
  pessoas: Pessoa[];
  funcionarios: Funcionario[];
  unidades: Unidade[];
  areasComuns: AreaComum[];
  pontosAcesso: PontoAcesso[];
  vinculos: VinculoUnidade[];
  veiculos: Veiculo[];
  autorizacoes: AutorizacaoPrevia[];
  restricoes: Restricao[];
  eventos: EventoAcesso[];
  encomendas: Encomenda[];
  autorizacoesRetirada: AutorizacaoRetirada[];
  ocorrencias: Ocorrencia[];
  usuarios: UsuarioSistema[];
  /** Só metadados e contagens (as linhas da planilha ficam em memória até confirmar, como na API sem estado). */
  importacoes: Importacao[];
  /** Trilha de alterações (append-only). */
  auditLog: RegistroAlteracao[];
  /** Instante simulado no momento do último salvamento (o relógio retoma dali ao recarregar). */
  salvoEm: number;
}

/** v3: alinhado ao schema do banco (unidade uuid, ids no lugar de nomes, hash canônico v1). Versão antiga é descartada. */
/** v4: conferência do comprovante (RF-05) no lugar do documento anexado e do checklist `conferencias`. */
export const VERSAO_DB = 4;
