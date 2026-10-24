// Indicador de passos do assistente (o shadcn/ui não tem um pronto; feito com as mesmas peças). Lista ordenada com
// aria-current="step" no passo atual e o estado escrito ("concluído"), não só desenhado.
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

export function Stepper({ passos, atual, className }: { passos: readonly string[]; atual: number; className?: string }) {
  return (
    <nav aria-label="Etapas" className={className}>
      <p className="mb-2 text-[13px] font-medium text-ink-suave">Passo {atual + 1} de {passos.length}</p>
      <ol className="grid gap-2 sm:grid-cols-4">
        {passos.map((p, i) => {
          const feito = i < atual;
          const agora = i === atual;
          return (
            <li key={p} aria-current={agora ? 'step' : undefined}
              className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-[14px]',
                agora ? 'border-primary bg-primary-claro font-semibold text-primary' : feito ? 'border-linha bg-white text-ink' : 'border-linha bg-white text-ink-suave')}>
              <span aria-hidden className={cn('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold',
                agora || feito ? 'bg-primary text-white' : 'border border-campo bg-white text-ink-suave')}>
                {feito ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
              </span>
              <span>{p}{feito && <span className="sr-only"> (concluído)</span>}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
