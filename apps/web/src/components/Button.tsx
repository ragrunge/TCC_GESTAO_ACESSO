import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';

type Variante = 'primario' | 'secundario' | 'perigo' | 'perigoContorno' | 'aviso' | 'contorno' | 'fantasma';
const ESTILO: Record<Variante, string> = {
  primario: 'border border-transparent bg-[#0B5563] text-white font-semibold hover:bg-[#08434E]',
  secundario: 'border border-[#B9C3CA] bg-white text-ink font-medium hover:bg-[#EEF2F4]',
  perigo: 'border border-transparent bg-[#B42318] text-white font-semibold hover:bg-[#912018]',
  perigoContorno: 'border border-[#FDA29B] bg-white text-[#B42318] font-medium hover:bg-[#FEF3F2]',
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

/** Botões do protótipo: 44px (padrão), 40px (pequeno), 48px (grande); raio 8px. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variante = 'secundario', icone: Icone, atalho, carregando, grande, pequeno, className = '', children, disabled, type = 'button', ...resto }, ref,
) {
  const tamanho = grande ? 'h-[48px] px-[18px] text-[15px]' : pequeno ? 'h-[44px] px-[14px] text-[14px] lg:h-[40px]' : 'h-[44px] px-[18px] text-[15px]';
  const bloqueado = disabled || carregando;
  return (
    <button
      ref={ref}
      type={type}
      disabled={bloqueado}
      className={`inline-flex items-center justify-center gap-[10px] rounded-lg transition-colors disabled:cursor-not-allowed ${tamanho} ${
        bloqueado ? 'border border-[#D5DDE2] bg-[#EEF2F4] font-semibold text-[#6B7780]' : ESTILO[variante]
      } ${className}`}
      {...resto}
    >
      {carregando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icone ? <Icone className="h-4 w-4" aria-hidden /> : null}
      {children}
      {atalho && (
        <kbd className={`rounded-[5px] border px-[7px] py-[2px] font-mono text-[13px] font-semibold ${
          variante === 'primario' || variante === 'perigo' ? 'border-white/50' : 'border-[#B9C3CA]'
        } ${bloqueado ? 'border-[#B9C3CA]' : ''}`}>{atalho}</kbd>
      )}
    </button>
  );
});
