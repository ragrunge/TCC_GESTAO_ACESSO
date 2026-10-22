import { useCatalogo } from '../app/catalogo';
import { createContext, useContext, type CSSProperties, type MouseEventHandler, type ReactNode } from 'react';

/**
 * Listas em grade do protótipo: cabeçalho 13px/600 #56616B em caixa normal, linhas de uma linha só,
 * divisores #EEF1F3. As colunas são definidas uma vez (grid-template-columns) e valem para cabeçalho e linhas.
 */
const ColsCtx = createContext<{ cols: string; empilhar: boolean }>({ cols: '1fr', empilhar: false });

/**
 * Largura mínima da grade, somada das colunas (px fixos; fr conta 120px por fração) mais gaps e padding das linhas.
 * Abaixo disso a lista rola na horizontal DENTRO do cartão, nunca a página.
 */
export function larguraMinima(colunas: string): number {
  const cols = colunas.trim().split(/\s+/);
  const soma = cols.reduce((acc, c) => {
    const px = /^(\d+(?:\.\d+)?)px$/.exec(c);
    if (px) return acc + Number(px[1]);
    const fr = /(\d+(?:\.\d+)?)fr/.exec(c);
    return acc + (fr ? 120 * Number(fr[1]) : 100);
  }, 0);
  return Math.ceil(soma + 12 * (cols.length - 1) + 40);
}

/**
 * `empilhar`: abaixo de md as linhas viram cartões de 2 colunas (sem cabeçalho, sem rolagem lateral): para listas
 * operacionais do celular, em que a ação da linha não pode ficar escondida atrás da rolagem. Dê `col-span-2 md:col-span-1`
 * às células largas. Sem `empilhar`, a lista rola na horizontal dentro do cartão.
 */
export function Lista({ legenda, colunas, children, className = '', empilhar = false }: { legenda: string; colunas: string; children: ReactNode; className?: string; empilhar?: boolean }) {
  const min = larguraMinima(colunas);
  return (
    <ColsCtx.Provider value={{ cols: colunas, empilhar }}>
      <div role="table" aria-label={legenda} className={`overflow-x-auto rounded-[10px] border border-[#DCE1E5] bg-white ${className}`}>
        <div style={{ '--lw': `${min}px` } as CSSProperties} className={empilhar ? 'md:min-w-[var(--lw)]' : 'min-w-[var(--lw)]'}>{children}</div>
      </div>
    </ColsCtx.Provider>
  );
}

/** Cartão de lista com título (para listas dentro de uma tela maior). */
export function ListaCab({ rotulos, padY = 12, className = '' }: { rotulos: string[]; padY?: 10 | 12; className?: string }) {
  const { cols, empilhar } = useContext(ColsCtx);
  return (
    <div role="row" style={{ gridTemplateColumns: cols }}
      className={`${empilhar ? 'hidden md:grid' : 'grid'} gap-3 border-b border-[#E6EAED] px-5 text-[13px] font-semibold text-[#56616B] ${padY === 10 ? 'py-[10px]' : 'py-3'} ${className}`}>
      {rotulos.map((r, i) => <span key={i} role="columnheader" className={r ? '' : 'sr-only'}>{r || 'Ações'}</span>)}
    </div>
  );
}

const FUNDO = { ambar: 'bg-[#FFFAEB]', novo: 'bg-[#F0F8F9]', vermelho: 'bg-[#FEF3F2]', selecionada: 'bg-[#F0F8F9]' } as const;

export function ListaLinha({ children, destaque, onClick, minH = 48, padY = 9, className = '', ariaLabel }: {
  children: ReactNode; destaque?: keyof typeof FUNDO; onClick?: MouseEventHandler<HTMLElement>; minH?: number; padY?: number; className?: string; ariaLabel?: string;
}) {
  const { cols, empilhar } = useContext(ColsCtx);
  const estilo = { ...(empilhar ? { '--cols': cols } : { gridTemplateColumns: cols }), minHeight: minH, paddingTop: padY, paddingBottom: padY } as CSSProperties;
  const base = `grid w-full ${empilhar ? 'grid-cols-2 md:[grid-template-columns:var(--cols)]' : ''} items-center gap-3 border-b border-[#EEF1F3] px-5 text-left ${destaque ? FUNDO[destaque] : 'bg-white'}`;
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
/** Célula de unidade: mostra o código "D-32" (resolvido pelo catálogo) ou `texto` (ex.: rótulo da view, área comum). */
export function CelUnidade({ id, texto, className = '' }: { id: string | null; texto?: string | null; className?: string }) {
  const { codigo } = useCatalogo();
  const t = texto ?? (id ? codigo(id) : null);
  return <span role="cell" className={`font-mono font-semibold ${className}`}>{t ?? <span className="font-sans font-normal text-[#56616B]">—</span>}</span>;
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="px-5 py-8 text-center text-[#56616B]">{children}</div>;
}
