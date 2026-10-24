// Checkbox do shadcn/ui (Radix Checkbox): role=checkbox, Espaço alterna, ligado ao <Label htmlFor>.
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../../lib/utils';

export const Checkbox = forwardRef<ElementRef<typeof CheckboxPrimitive.Root>, ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>>(
  function Checkbox({ className, ...resto }, ref) {
    return (
      <CheckboxPrimitive.Root ref={ref}
        className={cn('peer inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 border-[#56616B] bg-white data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-white disabled:cursor-not-allowed disabled:opacity-50', className)}
        {...resto}>
        <CheckboxPrimitive.Indicator><Check className="h-4 w-4" strokeWidth={3} aria-hidden /></CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );
  },
);
