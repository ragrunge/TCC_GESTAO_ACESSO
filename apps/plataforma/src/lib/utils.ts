// `cn` do shadcn/ui, sem clsx nem tailwind-merge (dependências a menos): junta classes e descarta falsy. Sem merge, quem
// chama não sobrescreve utilitário do mesmo grupo (cor, altura); só acrescenta layout (flex-1, w-full, margens).
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
