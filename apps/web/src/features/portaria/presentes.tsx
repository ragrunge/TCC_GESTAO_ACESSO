// Peças comuns de "Presentes agora" (/pessoas) e "Registrar saída" (/saida): a mesma consulta (GET /acessos/presentes,
// RF-20), a coluna Permanência e o destaque da linha pelo estado do prazo (RN-12).
import { useQuery } from '@tanstack/react-query';
import { Clock, TriangleAlert } from 'lucide-react';
import { useApi } from '../../api';
import { CHAVES } from '../../app/consultas';
import { ROTULO_TIPO_VISITA, type EventoView, type PermanenciaView } from '@portaria/domain/types';
import { descreverPermanencia, estadoPermanencia, permanenciaExcedida, type EstadoPermanencia } from '@portaria/domain/rules';

/** Quem está dentro agora: entradas sem saída, da mais recente para a mais antiga. Mesma chave nas duas telas. */
export function usePresentes() {
  const api = useApi();
  return useQuery({ queryKey: CHAVES.presentes, queryFn: () => api.eventos.presentes(), staleTime: 0 });
}

/** Estado do prazo (nulo sem prazo gravado: morador, funcionário, entrada anterior ao controle de prazo). */
export const estadoDoPresente = (e: EventoView, agora: number): EstadoPermanencia | null =>
  e.permanencia ? estadoPermanencia(e.permanencia.prazoAte, agora) : null;

/** Fundo da linha: vermelho expirado; âmbar vencendo, ou sem prazo e acima do alerta antigo de 8 h. */
export function destaquePresente(e: EventoView, agora: number): 'vermelho' | 'ambar' | undefined {
  const estado = estadoDoPresente(e, agora);
  if (estado === 'expirado') return 'vermelho';
  if (estado === 'vence_em_breve' || (!e.permanencia && permanenciaExcedida(e.ocorridoEm, agora))) return 'ambar';
  return undefined;
}

/** Ordem da tela de saída: expirados primeiro, depois os que vencem em breve; dentro do grupo, a ordem recebida. */
export function ordenarParaSaida(lista: EventoView[], agora: number): EventoView[] {
  const peso = (e: EventoView) => { const s = estadoDoPresente(e, agora); return s === 'expirado' ? 0 : s === 'vence_em_breve' ? 1 : 2; };
  return lista.map((e, i) => ({ e, i, p: peso(e) })).sort((a, b) => a.p - b.p || a.i - b.i).map((x) => x.e);
}

/**
 * Coluna Permanência: tempo decorrido e, quando há prazo (visitante/prestador), o tipo de visita e o estado. O estado
 * nunca é só cor: vem em texto ("Vence em 12min", "Expirado há 20min") e com ícone.
 */
export function CelPermanencia({ entradaEm, permanencia, agora }: { entradaEm: number; permanencia: PermanenciaView | null; agora: number }) {
  const min = Math.max(0, Math.floor((agora - entradaEm) / 60000));
  const dur = `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
  if (!permanencia) {
    const excedeu = permanenciaExcedida(entradaEm, agora);
    return (
      <span className={`flex items-center gap-1.5 font-mono ${excedeu ? 'font-semibold text-[#93370D]' : ''}`}>
        {excedeu && <TriangleAlert className="h-4 w-4" strokeWidth={2.4} aria-hidden />}
        {dur}{excedeu && <span className="font-sans text-[12px]">acima de 8h</span>}
      </span>
    );
  }
  const estado = estadoPermanencia(permanencia.prazoAte, agora);
  const cor = estado === 'expirado' ? 'font-semibold text-[#B42318]' : estado === 'vence_em_breve' ? 'font-semibold text-[#93370D]' : 'text-[#56616B]';
  const Icone = estado === 'expirado' ? TriangleAlert : estado === 'vence_em_breve' ? Clock : null;
  return (
    <span className="flex flex-col gap-0.5 leading-tight">
      <span className="font-mono">{dur} <span className="font-sans text-[12px] text-[#56616B]">· {ROTULO_TIPO_VISITA[permanencia.tipoVisita]}</span></span>
      <span className={`flex items-center gap-1 text-[13px] ${cor}`}>
        {Icone && <Icone className="h-4 w-4 shrink-0" strokeWidth={2.4} aria-hidden />}
        {descreverPermanencia(permanencia.prazoAte, agora)}
        {permanencia.prorrogacoes > 0 && <span className="font-normal text-[#56616B]">· prorrogado {permanencia.prorrogacoes}×</span>}
      </span>
    </span>
  );
}
