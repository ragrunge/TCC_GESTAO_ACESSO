// `cn` do shadcn/ui: junta classes, descarta falsy e resolve conflito de utilitário do mesmo grupo (tailwind-merge), para
// quem chama poder sobrescrever o padrão do componente (ex.: `flex-row` sobre o `flex-col` do CardHeader).
import { twMerge } from 'tailwind-merge';

export function cn(...classes: (string | false | null | undefined)[]): string {
  return twMerge(classes.filter(Boolean).join(' '));
}
