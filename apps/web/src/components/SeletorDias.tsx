import { DIAS_SEMANA_ABREV } from '@portaria/domain/time';

/**
 * Dias da semana em pílulas (Claude Design): marcado = petróleo cheio com texto branco, desmarcado = branco com borda.
 * O checkbox nativo continua lá (escondido) para teclado e leitor de tela; o anel de foco vai para a pílula.
 * `valor`: índices 0 (domingo) a 6 (sábado), devolvidos em ordem.
 */
export function SeletorDias({ valor, onChange }: { valor: number[]; onChange: (dias: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {DIAS_SEMANA_ABREV.map((n, i) => {
        const on = valor.includes(i);
        return (
          <label key={n}
            className={`inline-flex h-11 min-w-[56px] cursor-pointer select-none items-center justify-center rounded-full border px-3 text-[14px] font-semibold capitalize transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#0B5563] ${
              on ? 'border-[#0B5563] bg-[#0B5563] text-white' : 'border-[#B9C3CA] bg-white text-ink hover:bg-[#EEF2F4]'}`}>
            <input type="checkbox" className="sr-only" checked={on}
              onChange={(e) => onChange(e.target.checked ? [...valor, i].sort((a, b) => a - b) : valor.filter((x) => x !== i))} />
            {n}
          </label>
        );
      })}
    </div>
  );
}
