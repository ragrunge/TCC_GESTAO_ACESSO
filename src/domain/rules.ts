// Regras de negócio puras (sem React, sem I/O). Usadas pela UI (para habilitar botões)
// e, principalmente, pelo mock do "servidor" (que é quem realmente decide).
import type {
  AutorizacaoPrevia, CategoriaPessoa, Conferencia, Funcionario, MeioAutorizacao,
  Restricao, VinculoUnidade,
} from './types';
import { DIA, DIAS_SEMANA_ABREV, hhmmParaMin, minutosDoDia, partes } from './time';

export const MIN_JUSTIFICATIVA = 15;
export const DIAS_ENCOMENDA_ATRASADA = 7;
export const HORAS_PERMANENCIA_ALERTA = 8;

export interface ErroRegra { status: number; code: string; message: string }

export const justificativaValida = (t?: string | null) => (t ?? '').trim().length >= MIN_JUSTIFICATIVA;

// ----- Vínculo --------------------------------------------------------------------------------

/**
 * Vínculo válido = aprovado dentro da vigência OU legado dentro do prazo de regularização (RN-09).
 * Mesma regra para autorizar visitante por interfone e para retirar encomenda.
 * Datas de fim/prazo valem até o fim do dia.
 */
export function vinculoValido(v: VinculoUnidade, agora: number): boolean {
  if (v.status === 'aprovado') {
    if (v.vigenciaInicio !== null && agora < v.vigenciaInicio) return false;
    if (v.vigenciaFim !== null && agora >= v.vigenciaFim + DIA) return false;
    return true;
  }
  if (v.status === 'legado') return v.prazoRegularizacao !== null && agora < v.prazoRegularizacao + DIA;
  return false;
}

export const vinculosValidosDaUnidade = (vs: readonly VinculoUnidade[], unidadeId: string, agora: number) =>
  vs.filter((v) => v.unidadeId === unidadeId && vinculoValido(v, agora));

export const pessoaTemVinculoValido = (vs: readonly VinculoUnidade[], pessoaId: string, unidadeId: string, agora: number) =>
  vs.some((v) => v.pessoaId === pessoaId && v.unidadeId === unidadeId && vinculoValido(v, agora));

/** RN-08: encomenda só é entregue a pessoa com vínculo válido na unidade de destino. */
export function podeEntregarEncomenda(
  vs: readonly VinculoUnidade[], pessoaId: string, unidadeId: string, agora: number,
): { ok: true } | { ok: false; motivo: string } {
  return pessoaTemVinculoValido(vs, pessoaId, unidadeId, agora)
    ? { ok: true }
    : { ok: false, motivo: `Esta pessoa não tem vínculo com a ${unidadeId}. Contate a unidade.` };
}

/** Aprovar vínculo com algum item que não confere exige justificativa (≥ 15 caracteres). */
export const exigeJustificativaParaAprovar = (cs: readonly Conferencia[]) => cs.some((c) => !c.ok);

export function validarDecisaoVinculo(
  decisao: 'aprovar' | 'rejeitar', justificativa: string | undefined, conferencias: readonly Conferencia[],
): ErroRegra | null {
  const j = (justificativa ?? '').trim();
  if (decisao === 'rejeitar' && j.length === 0) {
    return { status: 422, code: 'JUSTIFICATIVA_OBRIGATORIA', message: 'Rejeitar um vínculo exige justificativa.' };
  }
  if (decisao === 'aprovar' && exigeJustificativaParaAprovar(conferencias) && !justificativaValida(j)) {
    return {
      status: 422, code: 'JUSTIFICATIVA_OBRIGATORIA',
      message: `Há itens que não conferem: aprovar exige justificativa de pelo menos ${MIN_JUSTIFICATIVA} caracteres.`,
    };
  }
  return null;
}

// ----- Restrição ------------------------------------------------------------------------------

/** Restrições vigentes (RF-16): não revogadas, não expiradas; as de escopo condomínio só depois de aprovadas. */
export function restricoesVigentes(
  rs: readonly Restricao[], pessoaId: string, unidadeId: string | null, agora: number,
): Restricao[] {
  // Restrição de condomínio vale mesmo sem unidade de destino (ex.: funcionário em escala).
  return rs.filter((r) => {
    if (r.pessoaId !== pessoaId || r.revogadaEm !== null || agora > r.validaAte) return false;
    if (r.escopo === 'condominio') return r.aprovadaEm !== null;
    return unidadeId !== null && r.unidadeId === unidadeId;
  });
}

// ----- Autorização prévia ---------------------------------------------------------------------

export type EstadoAutorizacao = 'valida' | 'fora_da_janela' | 'expirada' | 'ainda_nao_vale' | 'revogada';

/** Considera validade (data) e janela (dias da semana + horário) usando o relógio informado. */
export function estadoAutorizacaoPrevia(ap: AutorizacaoPrevia, agora: number): EstadoAutorizacao {
  if (ap.revogadaEm !== null) return 'revogada';
  if (agora > ap.validaAte) return 'expirada';
  if (agora < ap.validaDe) return 'ainda_nao_vale';
  const p = partes(agora);
  if (ap.diasSemana && !ap.diasSemana.includes(p.dow)) return 'fora_da_janela';
  if (ap.horaInicio && ap.horaFim) {
    const m = minutosDoDia(agora);
    if (m < hhmmParaMin(ap.horaInicio) || m > hhmmParaMin(ap.horaFim)) return 'fora_da_janela';
  }
  return 'valida';
}

const hAbrev = (s: string) => {
  const [h, m] = s.split(':');
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
};

/** "seg a sex, 8h–18h" */
export function descreverJanela(ap: Pick<AutorizacaoPrevia, 'diasSemana' | 'horaInicio' | 'horaFim'>): string {
  let dias = 'todos os dias';
  const d = ap.diasSemana;
  if (d && d.length > 0 && d.length < 7) {
    const ord = [...d].sort((a, b) => a - b);
    const contiguo = ord.every((x, i) => i === 0 || x === ord[i - 1] + 1);
    dias = contiguo && ord.length > 2
      ? `${DIAS_SEMANA_ABREV[ord[0]]} a ${DIAS_SEMANA_ABREV[ord[ord.length - 1]]}`
      : ord.map((x) => DIAS_SEMANA_ABREV[x]).join(', ');
  }
  const horas = ap.horaInicio && ap.horaFim ? `, ${hAbrev(ap.horaInicio)}–${hAbrev(ap.horaFim)}` : '';
  return dias + horas;
}

/** "15h–17h" (para a mensagem de fora do horário). */
export const descreverHorario = (ap: Pick<AutorizacaoPrevia, 'horaInicio' | 'horaFim'>) =>
  ap.horaInicio && ap.horaFim ? `${hAbrev(ap.horaInicio)}–${hAbrev(ap.horaFim)}` : 'sem horário definido';

// ----- Meios de autorização -------------------------------------------------------------------

export function meiosAceitos(categoria: CategoriaPessoa): MeioAutorizacao[] {
  const base: MeioAutorizacao[] = ['interfone', 'morador_presente', 'autorizacao_previa', 'excecao_porteiro'];
  // Escala só existe para funcionário do condomínio (correção 5)
  return categoria === 'funcionario' ? [...base, 'escala'] : base;
}

export function escalaVigente(f: Funcionario | undefined, agora: number): boolean {
  if (!f || !f.ativo) return false;
  const p = partes(agora);
  if (!f.escala.diasSemana.includes(p.dow)) return false;
  const m = minutosDoDia(agora);
  return m >= hhmmParaMin(f.escala.horaInicio) && m <= hhmmParaMin(f.escala.horaFim);
}

// ----- Entrada (RN-01, RF-13, RF-17, RN-07) ---------------------------------------------------

export interface DadosAutorizacao {
  categoriaPessoa: CategoriaPessoa;
  unidadeDestinoId?: string | null;
  autorizadoPorTipo?: MeioAutorizacao | null;
  autorizadoPorPessoaId?: string | null;
  autorizadoPorNome?: string | null;
  autorizacaoPreviaId?: string | null;
  justificativa?: string | null;
}

export interface ContextoAutorizacao {
  /** Instante do acesso (no retroativo, a hora real informada). */
  quando: number;
  /** Pessoas com vínculo válido na unidade de destino. */
  moradoresValidosIds: ReadonlySet<string>;
  /** Autorizações prévias da pessoa para a unidade. */
  autorizacoes: readonly AutorizacaoPrevia[];
  funcionario?: Funcionario;
}

const e422 = (code: string, message: string): ErroRegra => ({ status: 422, code, message });

/** Valida o autorizador de uma entrada. Retorna null se estiver tudo certo. */
export function validarAutorizacaoEntrada(d: DadosAutorizacao, ctx: ContextoAutorizacao): ErroRegra | null {
  if (d.categoriaPessoa !== 'funcionario' && !d.unidadeDestinoId) {
    return e422('UNIDADE_OBRIGATORIA', 'Informe a unidade de destino.');
  }
  if (d.categoriaPessoa === 'morador') return null;
  const tipo = d.autorizadoPorTipo;
  if (!tipo) return e422('AUTORIZADO_POR_OBRIGATORIO', 'Informe quem autorizou a entrada (RN-01).');
  if (!meiosAceitos(d.categoriaPessoa).includes(tipo)) {
    return e422('MEIO_INVALIDO_PARA_TIPO', 'Este meio de autorização não se aplica ao tipo de pessoa.');
  }
  switch (tipo) {
    case 'interfone':
    case 'morador_presente':
      if (!d.autorizadoPorPessoaId) {
        return e422('AUTORIZADO_POR_SEM_IDENTIFICACAO', 'Informe o morador que autorizou (nome obrigatório).');
      }
      if (!ctx.moradoresValidosIds.has(d.autorizadoPorPessoaId)) {
        return e422('AUTORIZADOR_SEM_VINCULO', 'O autorizador não tem vínculo válido (aprovado ou legado no prazo) com a unidade.');
      }
      return null;
    case 'excecao_porteiro':
      return justificativaValida(d.justificativa)
        ? null
        : e422('JUSTIFICATIVA_OBRIGATORIA', `A exceção exige justificativa de pelo menos ${MIN_JUSTIFICATIVA} caracteres (RF-17).`);
    case 'autorizacao_previa': {
      const ap = ctx.autorizacoes.find((a) => a.id === d.autorizacaoPreviaId);
      if (!ap || estadoAutorizacaoPrevia(ap, ctx.quando) !== 'valida') {
        return e422('AUTORIZACAO_PREVIA_INVALIDA', 'Autorização prévia inexistente, vencida ou fora da janela de dias/horário (RN-07).');
      }
      return null;
    }
    case 'escala':
      return escalaVigente(ctx.funcionario, ctx.quando)
        ? null
        : e422('ESCALA_FORA_DO_HORARIO', 'O funcionário não está em horário de escala.');
  }
}

/** Ajuda para a UI: pode habilitar "Confirmar entrada"? */
export const podeConfirmarEntrada = (d: DadosAutorizacao, ctx: ContextoAutorizacao) =>
  validarAutorizacaoEntrada(d, ctx) === null;

// ----- Permanência e encomendas ---------------------------------------------------------------

export const permanenciaExcedida = (entradaEm: number, agora: number) =>
  agora - entradaEm > HORAS_PERMANENCIA_ALERTA * 3600 * 1000;

// Nunca negativo: o relógio da tela pode estar alguns segundos atrás do registro recém-criado.
export const diasDesde = (ts: number, agora: number) => Math.max(0, Math.floor((agora - ts) / DIA));
export const encomendaAtrasada = (recebidaEm: number, agora: number) => diasDesde(recebidaEm, agora) > DIAS_ENCOMENDA_ATRASADA;
