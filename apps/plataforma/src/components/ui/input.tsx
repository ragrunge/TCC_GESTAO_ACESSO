// Input do shadcn/ui com a altura (44 px, alvo de toque) e as cores do protótipo.
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export const CLASSE_CAMPO = 'w-full min-w-0 rounded-lg border border-campo bg-white px-3 text-[15px] text-ink placeholder:text-[#56616B]/70 '
  + 'disabled:bg-neutro-bg disabled:text-ink-suave aria-[invalid=true]:border-perigo';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, type = 'text', ...resto }, ref) {
  return <input ref={ref} type={type} className={cn(CLASSE_CAMPO, 'h-[44px]', type === 'file' && 'py-2 file:mr-3 file:rounded-md file:border-0 file:bg-primary-claro file:px-3 file:py-1 file:font-semibold file:text-primary', className)} {...resto} />;
});
