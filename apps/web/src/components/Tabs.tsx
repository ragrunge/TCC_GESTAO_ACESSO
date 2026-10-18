import { useRef, type ReactNode } from 'react';

export interface Aba<T extends string> { id: T; rotulo: ReactNode }

/** Abas do protótipo: altura 48px, sublinhado de 3px petróleo na ativa. Acessíveis (role=tablist, setas). */
export function Tabs<T extends string>({ abas, ativa, onChange, rotulo }: { abas: Aba<T>[]; ativa: T; onChange: (id: T) => void; rotulo: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label={rotulo} className="flex gap-1 border-b border-[#E6EAED] px-4">
      {abas.map((a, i) => (
        <button
          key={a.id}
          ref={(el) => { refs.current[i] = el; }}
          role="tab"
          type="button"
          aria-selected={a.id === ativa}
          tabIndex={a.id === ativa ? 0 : -1}
          onClick={() => onChange(a.id)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const prox = (i + (e.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length;
            onChange(abas[prox].id);
            refs.current[prox]?.focus();
          }}
          className={`h-[48px] border-b-[3px] px-[14px] font-semibold ${a.id === ativa ? 'border-[#0B5563] text-[#0B5563]' : 'border-transparent text-[#56616B] hover:text-ink'}`}
        >
          {a.rotulo}
        </button>
      ))}
    </div>
  );
}
