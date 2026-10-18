import { useCatalogo } from '../app/catalogo';
import { createContext, useContext, type CSSProperties, type MouseEventHandler, type ReactNode } from 'react';

/**
 * Listas em grade do protótipo: cabeçalho 13px/600 #56616B em caixa normal, linhas de uma linha só,
 * divisores #EEF1F3. As colunas são definidas uma vez (grid-template-columns) e valem para cabeçalho e linhas.
 */
const ColsCtx = createContext('1fr');

export function Lista({ legenda, colunas, children, className = '' }: { legenda: string; colunas: string; children: ReactNode; className?: string }) {
  return (
    <ColsCtx.Provider value={colunas}>
      <div role="table" aria-label={legenda} className={`overflow-hidden rounded-[10px] border border-[#DCE1E5] bg-white ${className}`}>{children}</div>
    </ColsCtx.Provider>
  );
}

/** Cartão de lista com título (para listas dentro de uma tela maior). */
export function ListaCab({ rotulos, padY = 12, className = '' }: { rotulos: string[]; padY?: 10 | 12; className?: string }) {
  const cols = useContext(ColsCtx);
  return (
    <div role="row" style={{ gridTemplateColumns: cols }}
      className={`grid gap-3 border-b border-[#E6EAED] px-5 text-[13px] font-semibold text-[#56616B] ${padY === 10 ? 'py-[10px]' : 'py-3'} ${className}`}>
      {rotulos.map((r, i) => <span key={i} role="columnheader" className={r ? '' : 'sr-only'}>{r || 'Ações'}</span>)}
    </div>
  );
}

const FUNDO = { ambar: 'bg-[#FFFAEB]', novo: 'bg-[#F0F8F9]', vermelho: 'bg-[#FEF3F2]', selecionada: 'bg-[#F0F8F9]' } as const;

export function ListaLinha({ children, destaque, onClick, minH = 48, padY = 9, className = '', ariaLabel }: {
  children: ReactNode; destaque?: keyof typeof FUNDO; onClick?: MouseEventHandler<HTMLElement>; minH?: number; padY?: number; className?: string; ariaLabel?: string;
}) {
  const cols = useContext(ColsCtx);
  const estilo: CSSProperties = { gridTemplateColumns: cols, minHeight: minH, paddingTop: padY, paddingBottom: padY };
  const base = `grid w-full items-center gap-3 border-b border-[#EEF1F3] px-5 text-left ${destaque ? FUNDO[destaque] : 'bg-white'}`;
  if (onClick) {
    return (
      <button type="button" role="row" aria-label={ariaLabel} onClick={onClick} style={estilo}
        className={`${base} text-ink hover:bg-[#F5F8F9] ${className}`}>{children}</button>
    );
  }
  return <div role="row" style={estilo} className={`${base} ${className}`}>{children}</div>;
}

export const Cel = ({ children, className = '' }: { children?: ReactNode; className?: string }) => (
  <span role="cell" className={`min-w-0 ${className}`}>{children}</span>
);
/** Texto de unidade na lista: mono, negrito. */
/** Célula de unidade: mostra o código "T4-32" (resolvido pelo catálogo) ou `texto` (ex.: rótulo da view, área comum). */
export function CelUnidade({ id, texto, className = '' }: { id: string | null; texto?: string | null; className?: string }) {
  const { codigo } = useCatalogo();
  const t = texto ?? (id ? codigo(id) : null);
  return <span role="cell" className={`font-mono font-semibold ${className}`}>{t ?? <span className="font-sans font-normal text-[#56616B]">—</span>}</span>;
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="px-5 py-8 text-center text-[#56616B]">{children}</div>;
}
