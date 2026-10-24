// Command do shadcn/ui (cmdk): lista com busca, setas/Home/End/Enter e aria de combobox/listbox/option
// (aria-activedescendant no campo). Cores do protótipo; item com 44px de altura mínima (alvo de toque).
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../../lib/utils';

export const Command = forwardRef<ElementRef<typeof CommandPrimitive>, ComponentPropsWithoutRef<typeof CommandPrimitive>>(
  function Command({ className, ...resto }, ref) {
    return <CommandPrimitive ref={ref} className={cn('flex w-full flex-col text-ink', className)} {...resto} />;
  },
);

/** Campo de busca dentro do popover (com lupa). Para um campo que é o próprio gatilho, use `CommandPrimitive.Input`. */
export const CommandInput = forwardRef<ElementRef<typeof CommandPrimitive.Input>, ComponentPropsWithoutRef<typeof CommandPrimitive.Input>>(
  function CommandInput({ className, ...resto }, ref) {
    return (
      <div className="flex items-center gap-2 border-b border-[#E1E6EA] px-3">
        <Search className="h-4 w-4 shrink-0 text-[#56616B]" aria-hidden />
        <CommandPrimitive.Input ref={ref}
          className={cn('h-[44px] w-full min-w-0 bg-transparent text-[15px] outline-none placeholder:text-[#56616B]/70 disabled:cursor-not-allowed', className)} {...resto} />
      </div>
    );
  },
);

export const CommandList = forwardRef<ElementRef<typeof CommandPrimitive.List>, ComponentPropsWithoutRef<typeof CommandPrimitive.List>>(
  function CommandList({ className, ...resto }, ref) {
    return <CommandPrimitive.List ref={ref}
      className={cn('max-h-[min(320px,var(--radix-popover-content-available-height,320px))] overflow-y-auto overflow-x-hidden overscroll-contain p-1', className)} {...resto} />;
  },
);

export const CommandEmpty = forwardRef<ElementRef<typeof CommandPrimitive.Empty>, ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>>(
  function CommandEmpty({ className, ...resto }, ref) {
    return <CommandPrimitive.Empty ref={ref} className={cn('px-3 py-3 text-[14px] text-[#56616B]', className)} {...resto} />;
  },
);

export const CommandGroup = forwardRef<ElementRef<typeof CommandPrimitive.Group>, ComponentPropsWithoutRef<typeof CommandPrimitive.Group>>(
  function CommandGroup({ className, ...resto }, ref) {
    return <CommandPrimitive.Group ref={ref}
      className={cn('[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.04em] [&_[cmdk-group-heading]]:text-[#56616B]', className)} {...resto} />;
  },
);

export const CommandSeparator = forwardRef<ElementRef<typeof CommandPrimitive.Separator>, ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>>(
  function CommandSeparator({ className, ...resto }, ref) {
    return <CommandPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-[#E1E6EA]', className)} {...resto} />;
  },
);

// Selecionado: fundo petróleo claro + contorno (a cor não é a única pista; contraste do indicador >= 3:1).
export const CommandItem = forwardRef<ElementRef<typeof CommandPrimitive.Item>, ComponentPropsWithoutRef<typeof CommandPrimitive.Item>>(
  function CommandItem({ className, ...resto }, ref) {
    return <CommandPrimitive.Item ref={ref}
      className={cn('relative flex min-h-[44px] cursor-pointer select-none items-center gap-3 rounded-md px-3 py-2 text-left text-[15px] outline-none',
        'data-[selected=true]:bg-primary-claro data-[selected=true]:shadow-[inset_0_0_0_2px_#0B5563]',
        'data-[disabled=true]:cursor-not-allowed data-[disabled=true]:bg-[#F5F7F8] data-[disabled=true]:text-[#56616B]', className)} {...resto} />;
  },
);

export { CommandPrimitive };
