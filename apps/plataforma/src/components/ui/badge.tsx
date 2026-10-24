// Badge do shadcn/ui, nos tons do protótipo.
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export type TomBadge = 'neutro' | 'petroleo' | 'verde' | 'ambar' | 'vermelho';
export const TONS: Record<TomBadge, string> = {
  vermelho: 'bg-perigo-bg text-[#912018] border-perigo-borda',
  ambar: 'bg-aviso-bg text-[#7A2E0E] border-aviso-borda',
  verde: 'bg-ok-bg text-ok border-ok-borda',
  neutro: 'bg-neutro-bg text-neutro-fg border-neutro-borda',
  petroleo: 'bg-primary-claro text-primary-hover border-primary-borda',
};

export function Badge({ variant = 'neutro', className, ...resto }: HTMLAttributes<HTMLSpanElement> & { variant?: TomBadge }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-[10px] py-[2px] text-[13px] font-semibold', TONS[variant], className)} {...resto} />;
}
