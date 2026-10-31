import type { HTMLAttributes, ReactNode } from 'react';

/** Cartão do protótipo: fundo branco, borda #DCE1E5, raio 10px. Título 16px/600 com divisor. */
export function Card({ titulo, acoes, children, className = '', semPadding, ...resto }: {
  titulo?: ReactNode; acoes?: ReactNode; children: ReactNode; semPadding?: boolean;
} & Omit<HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <section className={`rounded-[10px] border border-[#DCE1E5] bg-white ${className}`} {...resto}>
      {(titulo || acoes) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6EAED] px-5 py-[14px]">
          <h2 className="text-[16px] font-semibold">{titulo}</h2>
          {acoes}
        </header>
      )}
      <div className={semPadding ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

/** Cartão numerado do fluxo de entrada ("1 Pessoa", "2 Unidade de destino"...). */
export function CartaoPasso({ n, titulo, children, id }: { n: number; titulo: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-[10px] border border-[#DCE1E5] bg-white p-5">
      <div className="mb-[14px] flex items-center gap-[10px]">
        <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-[#0B5563] text-[13px] font-bold text-white">{n}</span>
        <h2 className="text-[17px] font-semibold">{titulo}</h2>
      </div>
      {children}
    </section>
  );
}
