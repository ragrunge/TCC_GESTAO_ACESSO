// Combobox do shadcn/ui (Popover + Command) para listas conhecidas no cliente (blocos, apartamentos do catálogo):
// gatilho role=combobox, lista filtrável (por palavras-chave: ver `pontuar`), opção indisponível aparece
// desabilitada com o motivo em texto (a cor não é a única pista). Ao escolher, o foco volta ao gatilho.
import { Check, ChevronsUpDown } from 'lucide-react';
import { forwardRef, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Badge } from './badge';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from './command';
import { Label } from './label';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface OpcaoCombobox {
  valor: string;
  rotulo: string;
  detalhe?: ReactNode;
  /** Motivo (texto curto): a opção aparece, mas desabilitada. */
  indisponivel?: string;
  /** O que a busca casa (padrão: o rótulo). Ex.: bloco ["B"]; apartamento ["11", "B-11", "AP 11"]. */
  palavras?: string[];
}

const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Filtro do cmdk por palavra-chave: igual vale mais que "começa com", que vale mais que "contém". Sem o fuzzy padrão
 * do cmdk, que com "B" casaria todo "Bloco X" (e Enter escolheria o primeiro, não o B).
 */
export function pontuar(_valor: string, busca: string, palavras: string[] = []): number {
  const s = norm(busca);
  if (!s) return 1;
  let melhor = 0;
  for (const p of palavras.map(norm)) melhor = Math.max(melhor, p === s ? 1 : p.startsWith(s) ? 0.8 : p.includes(s) ? 0.4 : 0);
  return melhor;
}

export const Combobox = forwardRef<HTMLButtonElement, {
  rotulo: string; placeholder: string; opcoes: readonly OpcaoCombobox[]; valor: string | null; onChange: (valor: string) => void;
  buscaPlaceholder?: string; vazio?: string; desabilitado?: boolean; dica?: ReactNode; erro?: string; className?: string;
  /** Depois de escolher, o foco vai para cá em vez de voltar ao gatilho (passo seguinte de uma escolha encadeada). */
  aposEscolher?: () => void;
}>(function Combobox({ rotulo, placeholder, opcoes, valor, onChange, buscaPlaceholder = 'Filtrar…', vazio = 'Nada encontrado.', desabilitado, dica, erro, className, aposEscolher }, ref) {
  const id = useId();
  const dicaId = `${id}-d`;
  const [aberto, setAberto] = useState(false);
  const escolheu = useRef(false);
  const escolhida = opcoes.find((o) => o.valor === valor);
  return (
    <div className={cn('flex flex-col gap-[6px]', className)}>
      <Label htmlFor={id}>{rotulo}</Label>
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <button ref={ref} id={id} type="button" role="combobox" aria-expanded={aberto} aria-haspopup="listbox" disabled={desabilitado}
            aria-invalid={erro ? true : undefined} aria-describedby={dica || erro ? dicaId : undefined}
            onKeyDown={(e) => { if (!aberto && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setAberto(true); } }}
            className={cn('input flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed', erro ? 'border-perigo' : null)}>
            <span className={cn('min-w-0 truncate', escolhida ? 'font-medium' : 'text-[#56616B]')}>{escolhida?.rotulo ?? placeholder}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-[#56616B]" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent onCloseAutoFocus={(e) => { if (escolheu.current && aposEscolher) { e.preventDefault(); aposEscolher(); } escolheu.current = false; }}>
          <Command label={`Filtrar ${rotulo.toLowerCase()}`} filter={pontuar}>
            <CommandInput placeholder={buscaPlaceholder} />
            <CommandList>
              <CommandEmpty>{vazio}</CommandEmpty>
              {opcoes.map((o) => (
                <CommandItem key={o.valor} value={o.valor} keywords={o.palavras ?? [o.rotulo]} disabled={!!o.indisponivel}
                  onSelect={() => { escolheu.current = true; onChange(o.valor); setAberto(false); }}>
                  <Check className={cn('h-4 w-4 shrink-0 text-primary', o.valor === valor ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{o.rotulo}</span>
                    {o.detalhe && <span className="truncate text-[13px] text-[#56616B]">{o.detalhe}</span>}
                  </span>
                  {o.indisponivel && <Badge variant="neutro">{o.indisponivel}</Badge>}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {(dica || erro) && <p id={dicaId} className={cn('text-[13px]', erro ? 'font-medium text-perigo' : 'text-[#56616B]')}>{erro ?? dica}</p>}
    </div>
  );
});
