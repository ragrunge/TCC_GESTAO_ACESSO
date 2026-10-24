// Button do shadcn/ui (Radix Slot para `asChild`), com as cores do protótipo aprovado (tailwind.config.js).
import { Slot } from '@radix-ui/react-slot';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export type VarianteBotao = 'default' | 'secondary' | 'outline' | 'ghost';
export type TamanhoBotao = 'default' | 'sm';

const VARIANTES: Record<VarianteBotao, string> = {
  default: 'border border-transparent bg-primary text-white font-semibold hover:bg-[#08434E]',
  secondary: 'border border-campo bg-white text-ink font-medium hover:bg-neutro-bg',
  outline: 'border border-primary bg-white text-primary font-semibold hover:bg-primary-claro',
  ghost: 'border border-transparent bg-transparent text-primary font-semibold hover:bg-primary-claro',
};
const TAMANHOS: Record<TamanhoBotao, string> = {
  default: 'h-[44px] px-[18px] text-[15px] gap-[10px]',
  sm: 'h-9 px-3 text-[14px] gap-2',
};
// `disabled:` vem depois de `hover:` na ordem do Tailwind: o visual de bloqueado vence qualquer variante.
const BASE = 'inline-flex shrink-0 items-center justify-center rounded-lg no-underline transition-colors disabled:cursor-not-allowed '
  + 'disabled:border-linha disabled:bg-neutro-bg disabled:text-[#6B7780] disabled:font-semibold';

export function classesBotao(variant: VarianteBotao = 'secondary', size: TamanhoBotao = 'default') {
  return cn(BASE, VARIANTES[variant], TAMANHOS[size]);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: VarianteBotao;
  size?: TamanhoBotao;
  /** Mostra o spinner e bloqueia (aria-busy). */
  loading?: boolean;
  /** Renderiza o filho (ex.: <Link>) com o visual do botão. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'default', loading, asChild, className, children, disabled, type, ...resto }, ref,
) {
  if (asChild) return <Slot ref={ref} className={cn(classesBotao(variant, size), className)} {...resto}>{children}</Slot>;
  return (
    <button ref={ref} type={type ?? 'button'} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cn(classesBotao(variant, size), className)} {...resto}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
