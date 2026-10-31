import type { ReactNode } from 'react';

/** Cabeçalho de página do protótipo: h1 26px/600, subtítulo em #56616B, ações alinhadas à base. */
export function PageHeader({ titulo, descricao, acoes, tamanho = 26 }: { titulo: ReactNode; descricao?: ReactNode; acoes?: ReactNode; tamanho?: 26 | 30 }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className={`font-semibold ${tamanho === 30 ? 'text-[24px] sm:text-[30px]' : 'text-[22px] tracking-[-0.01em] sm:text-[26px]'}`}>{titulo}</h1>
        {descricao && <p className="mt-1 text-[#56616B]">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </div>
  );
}
