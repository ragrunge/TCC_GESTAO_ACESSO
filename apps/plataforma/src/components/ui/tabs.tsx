// Tabs do shadcn/ui (Radix Tabs): setas trocam de aba, Tab entra no painel.
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../../lib/utils';

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  function TabsList({ className, ...resto }, ref) {
    return <TabsPrimitive.List ref={ref} className={cn('inline-flex flex-wrap gap-1 rounded-lg bg-neutro-bg p-1', className)} {...resto} />;
  },
);

export const TabsTrigger = forwardRef<ElementRef<typeof TabsPrimitive.Trigger>, ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  function TabsTrigger({ className, ...resto }, ref) {
    return (
      <TabsPrimitive.Trigger ref={ref}
        className={cn('inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-[15px] font-medium text-ink-suave transition-colors hover:text-ink data-[state=active]:bg-white data-[state=active]:font-semibold data-[state=active]:text-primary data-[state=active]:shadow-cartao', className)}
        {...resto} />
    );
  },
);

export const TabsContent = forwardRef<ElementRef<typeof TabsPrimitive.Content>, ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(
  function TabsContent({ className, ...resto }, ref) {
    return <TabsPrimitive.Content ref={ref} className={cn('mt-3 flex flex-col gap-3', className)} {...resto} />;
  },
);
