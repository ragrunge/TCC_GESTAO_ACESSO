import { useId, type ReactNode } from 'react';

/**
 * Interruptor liga/desliga (Claude Design): trilho 48×28 petróleo quando ligado, cinza quando desligado, rótulo em
 * negrito e explicação embaixo. É um checkbox nativo com role="switch" (anuncia "ligado/desligado", espaço alterna),
 * escondido atrás do desenho; o anel de foco vai para o trilho.
 */
export function Interruptor({ ligado, onChange, rotulo, dica, className = '' }: {
  ligado: boolean; onChange: (ligado: boolean) => void; rotulo: ReactNode; dica?: ReactNode; className?: string;
}) {
  const id = useId();
  return (
    <label className={`flex min-h-[44px] cursor-pointer items-center gap-3 ${className}`}>
      <input type="checkbox" role="switch" className="peer sr-only" aria-labelledby={`${id}-r`} aria-describedby={dica ? `${id}-d` : undefined} checked={ligado} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#0B5563] ${ligado ? 'bg-[#0B5563]' : 'bg-[#8A97A0]'}`}>
        <span className={`absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-[left] motion-reduce:transition-none ${ligado ? 'left-[23px]' : 'left-[3px]'}`} />
      </span>
      <span className="flex flex-col">
        <span id={`${id}-r`} className="font-semibold">{rotulo}</span>
        {dica && <span id={`${id}-d`} className="text-[13px] text-[#56616B]">{dica}</span>}
      </span>
    </label>
  );
}
