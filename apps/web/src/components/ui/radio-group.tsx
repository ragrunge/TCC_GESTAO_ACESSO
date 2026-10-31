// RadioGroup do shadcn/ui (Radix RadioGroup): role=radiogroup/radio, setas trocam a opção, Tab entra e sai do grupo.
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../../lib/utils';

export const RadioGroup = forwardRef<ElementRef<typeof RadioGroupPrimitive.Root>, ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>>(
  function RadioGroup({ className, ...resto }, ref) {
    return <RadioGroupPrimitive.Root ref={ref} className={cn('grid gap-2', className)} {...resto} />;
  },
);

export const RadioGroupItem = forwardRef<ElementRef<typeof RadioGroupPrimitive.Item>, ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>>(
  function RadioGroupItem({ className, ...resto }, ref) {
    return (
      <RadioGroupPrimitive.Item ref={ref}
        className={cn('peer grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-[#56616B] bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary data-[state=checked]:border-primary disabled:cursor-not-allowed disabled:opacity-50', className)}
        {...resto}>
        <RadioGroupPrimitive.Indicator className="h-2.5 w-2.5 rounded-full bg-primary" />
      </RadioGroupPrimitive.Item>
    );
  },
);
