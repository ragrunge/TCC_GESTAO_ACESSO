// Textarea do shadcn/ui.
import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';
import { CLASSE_CAMPO } from './input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...resto }, ref) {
  return <textarea ref={ref} className={cn(CLASSE_CAMPO, 'min-h-[88px] py-[10px]', className)} {...resto} />;
});
