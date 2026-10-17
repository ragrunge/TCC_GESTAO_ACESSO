import { Ban, TriangleAlert } from 'lucide-react';
import { Badge, type Tom } from '../../components/Badge';
import { ROTULO_CATEGORIA, ROTULO_MEIO, ROTULO_MEIO_CURTO, type EventoView } from '@portaria/domain/types';
import { fmtDataCurta, fmtHora, inicioDoDia } from '@portaria/domain/time';

/** Nome de quem autorizou, no formato curto das listas (uma linha só). */
export function textoAutorizacao(ev: EventoView): string {
  if (ev.tipo === 'negado') return 'Entrada não permitida';
  if (ev.tipo === 'saida') return 'Saída registrada';
  if (ev.tipo === 'correcao') return 'Correção de registro';
  if (ev.tipo === 'recusado') return `Recusado por ${ev.autorizadoPorNome ?? '—'}`;
  if (!ev.autorizadoPorTipo) return '—';
  if (ev.autorizadoPorTipo === 'excecao_porteiro') return ev.operadorNome;
  if (ev.autorizadoPorTipo === 'escala') return 'Escala do condomínio';
  return ev.autorizadoPorNome ?? '—';
}
export const textoMeioLongo = (ev: EventoView) =>
  ev.tipo === 'negado' ? 'Entrada negada (restrição)'
    : ev.tipo === 'recusado' ? `Visita recusada pelo morador (${ev.autorizadoPorTipo ? ROTULO_MEIO[ev.autorizadoPorTipo].toLowerCase() : '—'})`
    : ev.autorizadoPorTipo ? ROTULO_MEIO[ev.autorizadoPorTipo] : '—';

/** Chip do meio de autorização: neutro; âmbar na exceção; vermelho no negado. */
export function chipDoEvento(ev: EventoView): { texto: string; tom: Tom; icone?: typeof Ban } {
  if (ev.tipo === 'negado') return { texto: 'Negado', tom: 'vermelho', icone: Ban };
  if (ev.tipo === 'recusado') return { texto: 'Recusado', tom: 'ambar', icone: Ban };
  if (ev.tipo === 'saida') return { texto: 'Saída', tom: 'neutro' };
  if (ev.tipo === 'correcao') return { texto: 'Correção', tom: 'petroleo' };
  if (ev.autorizadoPorTipo === 'excecao_porteiro') return { texto: 'Exceção', tom: 'ambar', icone: TriangleAlert };
  if (ev.autorizacaoSemSolicitante) return { texto: 'Sem solicitante', tom: 'ambar', icone: TriangleAlert };
  return { texto: ev.autorizadoPorTipo ? ROTULO_MEIO_CURTO[ev.autorizadoPorTipo] : '—', tom: 'neutro' };
}

/** Célula "Autorização": chip do meio + nome de quem autorizou + chip Retroativo. */
export function AutorizacaoEvento({ ev, detalheRetro }: { ev: EventoView; detalheRetro?: boolean }) {
  const c = chipDoEvento(ev);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <Badge tom={c.tom} icone={c.icone}>{c.texto}</Badge>
      <span className="truncate text-[14px]">{textoAutorizacao(ev)}</span>
      {ev.retroativo && (
        <Badge tom="petroleo" tamanho="sm">
          {detalheRetro ? `Retroativo · Hora real ${fmtHora(ev.ocorridoEm)} · lançado às ${fmtHora(ev.registradoEm)}` : 'Retroativo'}
        </Badge>
      )}
    </span>
  );
}

export const rotuloCategoria = (ev: EventoView) => ROTULO_CATEGORIA[ev.categoriaPessoa];

/** Hora na lista: só HH:MM se for hoje; senão "dd/mm HH:MM". */
export function quandoCurto(ts: number, agora: number): string {
  return inicioDoDia(ts) === inicioDoDia(agora) ? fmtHora(ts) : `${fmtDataCurta(ts)} ${fmtHora(ts)}`;
}

/** Fundo da linha: âmbar para exceção, vermelho claro para negado. */
export const destaqueEvento = (ev: EventoView) =>
  ev.tipo === 'negado' ? ('vermelho' as const)
    : ev.autorizadoPorTipo === 'excecao_porteiro' || ev.autorizacaoSemSolicitante ? ('ambar' as const) : undefined;
