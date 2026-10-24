// NativeSelect do shadcn/ui: o <select> do navegador com o visual dos campos. Escolhido no lugar do Select do Radix
// porque as listas daqui são curtas (UF, Bloco/Torre, situação): o nativo já digita para achar, abre a roda no celular,
// é lido por qualquer leitor de tela e não traz popper/portal para o bundle.
import { ChevronDown } from 'lucide-react';
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';
import { CLASSE_CAMPO } from './input';

export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function NativeSelect({ className, children, ...resto }, ref) {
  return (
    <div className={cn('relative', className)}>
      <select ref={ref} className={cn(CLASSE_CAMPO, 'h-[44px] appearance-none pr-9')} {...resto}>{children}</select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-suave" aria-hidden />
    </div>
  );
});
