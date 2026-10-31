// Label do shadcn/ui (Radix Label).
import * as LabelPrimitive from '@radix-ui/react-label';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../../lib/utils';

export const Label = forwardRef<ElementRef<typeof LabelPrimitive.Root>, ComponentPropsWithoutRef<typeof LabelPrimitive.Root>>(
  function Label({ className, ...resto }, ref) {
    return <LabelPrimitive.Root ref={ref} className={cn('text-[14px] font-medium text-ink', className)} {...resto} />;
  },
);
