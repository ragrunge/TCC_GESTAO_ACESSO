// Popover do shadcn/ui (Radix Popover). Sem Portal por padrão: o app abre os formulários dentro do Modal próprio
// (components/Modal), que prende o foco no próprio nó; um conteúdo portado para o <body> ficaria fora da armadilha de
// foco. O Radix posiciona com `position: fixed`, então o `overflow` do modal não corta a lista.
// Largura = a do gatilho (ou da âncora); altura limitada ao espaço disponível (telas pequenas).
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../../lib/utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = forwardRef<ElementRef<typeof PopoverPrimitive.Content>, ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & { portal?: boolean }>(
  function PopoverContent({ className, align = 'start', sideOffset = 4, collisionPadding = 8, portal = false, ...resto }, ref) {
    const conteudo = (
      <PopoverPrimitive.Content ref={ref} align={align} sideOffset={sideOffset} collisionPadding={collisionPadding}
        className={cn('z-[80] w-[var(--radix-popover-trigger-width)] min-w-[min(260px,calc(100vw-16px))] max-w-[calc(100vw-16px)] overflow-hidden rounded-lg border border-[#B9C3CA] bg-white p-0 text-ink shadow-[0_12px_32px_rgba(16,38,44,0.18)] outline-none', className)}
        {...resto} />
    );
    return portal ? <PopoverPrimitive.Portal>{conteudo}</PopoverPrimitive.Portal> : conteudo;
  },
);
