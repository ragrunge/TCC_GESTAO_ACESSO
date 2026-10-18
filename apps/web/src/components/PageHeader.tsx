import type { ReactNode } from 'react';

/** Cabeçalho de página do protótipo: h1 26px/600, subtítulo em #56616B, ações alinhadas à base. */
export function PageHeader({ titulo, descricao, acoes, tamanho = 26 }: { titulo: ReactNode; descricao?: ReactNode; acoes?: ReactNode; tamanho?: 26 | 30 }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h1 className={`font-semibold ${tamanho === 30 ? 'text-[30px]' : 'text-[26px] tracking-[-0.01em]'}`}>{titulo}</h1>
        {descricao && <p className="mt-1 text-[#56616B]">{descricao}</p>}
      </div>
      {acoes && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
    </div>
  );
}
