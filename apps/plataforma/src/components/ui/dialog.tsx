// Dialog do shadcn/ui (Radix Dialog): role=dialog, foco preso, Esc fecha, foco devolvido a quem abriu. Sem animação
// (sem o plugin tailwindcss-animate). `data-autofocus` num filho escolhe o foco inicial.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { largura?: number; semFechar?: boolean }>(
  function DialogContent({ className, children, largura = 560, semFechar, style, onOpenAutoFocus, ...resto }, ref) {
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[rgba(12,22,28,0.58)]" />
        <DialogPrimitive.Content ref={ref}
          onOpenAutoFocus={(e) => {
            onOpenAutoFocus?.(e);
            const alvo = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[data-autofocus]');
            if (alvo && !e.defaultPrevented) { e.preventDefault(); alvo.focus(); }
          }}
          style={{ width: `min(${largura}px, calc(100vw - 32px))`, ...style }}
          className={cn('fixed left-1/2 top-1/2 z-[61] flex max-h-[calc(100vh-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl bg-white px-5 py-5 shadow-[0_24px_64px_rgba(0,0,0,0.3)] sm:px-7 sm:py-6', className)}
          {...resto}>
          {children}
          {!semFechar && (
            <DialogPrimitive.Close className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-suave hover:bg-neutro-bg" aria-label="Fechar">
              <X className="h-5 w-5" aria-hidden />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);

export const DialogHeader = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col gap-1 pr-8', className)} {...p} />;
export const DialogFooter = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn('mt-1 flex flex-wrap gap-[10px]', className)} {...p} />;

export const DialogTitle = forwardRef<ElementRef<typeof DialogPrimitive.Title>, ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  function DialogTitle({ className, ...resto }, ref) {
    return <DialogPrimitive.Title ref={ref} className={cn('text-[20px] font-semibold', className)} {...resto} />;
  },
);

export const DialogDescription = forwardRef<ElementRef<typeof DialogPrimitive.Description>, ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(
  function DialogDescription({ className, ...resto }, ref) {
    return <DialogPrimitive.Description ref={ref} className={cn('text-[14px] text-ink-suave', className)} {...resto} />;
  },
);
