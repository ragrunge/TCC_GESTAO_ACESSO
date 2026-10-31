// Alert do shadcn/ui, com ícone por tom (a cor nunca é a única pista: o ícone e o texto dizem o mesmo).
import { AlertTriangle, Ban, Check, Info } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { TONS, type TomBadge } from './badge';

const ICONES = { vermelho: Ban, ambar: AlertTriangle, verde: Check, neutro: Info, petroleo: Info };

export function Alert({ variant = 'neutro', title, children, className, ...resto }: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & { variant?: TomBadge; title?: ReactNode }) {
  const Icone = ICONES[variant];
  return (
    <div className={cn('flex items-start gap-[10px] rounded-lg border px-[14px] py-3', TONS[variant], 'font-normal', className)} {...resto}>
      <Icone className="mt-[2px] h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="text-[16px] font-semibold">{title}</p>}
        {children && <div className={cn('text-[14px]', title ? 'mt-0.5' : null)}>{children}</div>}
      </div>
    </div>
  );
}
