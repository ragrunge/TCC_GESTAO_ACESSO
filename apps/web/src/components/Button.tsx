import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Loader2, type LucideIcon } from 'lucide-react';

type Variante = 'primario' | 'secundario' | 'perigo' | 'perigoContorno' | 'aviso' | 'contorno' | 'fantasma';
const ESTILO: Record<Variante, string> = {
  primario: 'border border-transparent bg-[#0B5563] text-white font-semibold hover:bg-[#08434E]',
  secundario: 'border border-[#B9C3CA] bg-white text-ink font-medium hover:bg-[#EEF2F4]',
  perigo: 'border border-transparent bg-[#B42318] text-white font-semibold hover:bg-[#912018]',
  perigoContorno: 'border border-[#B42318] bg-white text-[#B42318] font-medium hover:bg-[#FEF3F2]',
  aviso: 'border border-[#FEC84B] bg-[#FEF0C7] text-[#93370D] font-semibold hover:bg-[#FEE9A8]',
  contorno: 'border border-[#0B5563] bg-white text-[#0B5563] font-semibold hover:bg-[#E3F0F2]',
  fantasma: 'border border-transparent bg-transparent text-[#0B5563] font-semibold hover:bg-[#E3F0F2]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  icone?: LucideIcon;
  /** Atalho exibido no botão (ex.: "F2"). Apenas visual: o atalho é tratado pela página. */
  atalho?: string;
  carregando?: boolean;
  /** 48px (botões de confirmação). */
  grande?: boolean;
  /** 40px. */
  pequeno?: boolean;
  children?: ReactNode;
}

const tamanhoBotao = (grande?: boolean, pequeno?: boolean) =>
  grande ? 'h-[48px] px-[18px] text-[15px]' : pequeno ? 'h-[44px] px-[14px] text-[14px] lg:h-[40px]' : 'h-[44px] px-[18px] text-[15px]';
const BASE = 'inline-flex items-center justify-center gap-[10px] rounded-lg transition-colors';

function Tecla({ atalho, variante, bloqueado }: { atalho: string; variante: Variante; bloqueado?: boolean }) {
  return (
    <kbd className={`rounded-[5px] border px-[7px] py-[2px] font-mono text-[13px] font-semibold ${
      variante === 'primario' || variante === 'perigo' ? 'border-white/50' : 'border-[#B9C3CA]'
    } ${bloqueado ? 'border-[#B9C3CA]' : ''}`}>{atalho}</kbd>
  );
}

/** Botões do protótipo: 44px (padrão), 40px (pequeno), 48px (grande); raio 8px. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variante = 'secundario', icone: Icone, atalho, carregando, grande, pequeno, className = '', children, disabled, type = 'button', ...resto }, ref,
) {
  const bloqueado = disabled || carregando;
  return (
    <button
      ref={ref}
      type={type}
      disabled={bloqueado}
      className={`${BASE} disabled:cursor-not-allowed ${tamanhoBotao(grande, pequeno)} ${
        bloqueado ? 'border border-[#D5DDE2] bg-[#EEF2F4] font-semibold text-[#6B7780]' : ESTILO[variante]
      } ${className}`}
      {...resto}
    >
      {carregando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icone ? <Icone className="h-4 w-4" aria-hidden /> : null}
      {children}
      {atalho && <Tecla atalho={atalho} variante={variante} bloqueado={bloqueado} />}
    </button>
  );
});

// O a:hover global (index.css) tem especificidade maior que a classe de cor: o texto do link precisa de !important
const COR_LINK: Partial<Record<Variante, string>> = {
  primario: '!text-white', perigo: '!text-white', secundario: '!text-ink', perigoContorno: '!text-[#B42318]', aviso: '!text-[#93370D]',
};

/**
 * Link de navegação com o visual do Button (ex.: "Nova entrada" em Presentes). Para ação que só troca de tela:
 * continua link (abre em nova aba, leitor de tela anuncia "link"), sem copiar as classes do botão à mão.
 */
export function BotaoLink({ variante = 'secundario', icone: Icone, atalho, grande, pequeno, className = '', children, ...resto }:
  LinkProps & Pick<ButtonProps, 'variante' | 'icone' | 'atalho' | 'grande' | 'pequeno'>) {
  return (
    <Link className={`${BASE} ${tamanhoBotao(grande, pequeno)} ${ESTILO[variante]} ${COR_LINK[variante] ?? ''} ${className}`} {...resto}>
      {Icone && <Icone className="h-4 w-4" aria-hidden />}
      {children}
      {atalho && <Tecla atalho={atalho} variante={variante} />}
    </Link>
  );
}
