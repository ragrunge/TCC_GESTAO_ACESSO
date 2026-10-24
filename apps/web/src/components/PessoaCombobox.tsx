// Seletor de pessoa com busca no servidor (Combobox do shadcn/ui: Popover + Command). O campo de texto é o próprio
// combobox (aria-activedescendant aponta a opção destacada): digita, setas escolhem, Enter confirma, Esc fecha a lista.
// Busca: a mesma do PessoaPicker (POST /pessoas/busca, termo no corpo porque pode ser CPF), a partir de 2 caracteres e
// 250 ms sem digitar. A chave do React Query fica só na memória (gcTime curto). A busca não devolve cadastro
// desativado nem anonimizado; se um desativado vier, aparece desabilitado com o motivo.
// Cada opção: nome, CPF mascarado (nunca o número completo), categoria e unidades com vínculo válido.
import { useLayoutEffect, useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, UserPlus } from 'lucide-react';
import { ROTULO_CATEGORIA } from '@portaria/domain/types';
import { useApi, type PessoaBusca } from '../api';
import { CHAVES, useDebounce } from '../app/consultas';
import { mensagemErro } from '../app/useAsync';
import { cn } from '../lib/utils';
import { Avatar } from './UnitTag';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Command, CommandGroup, CommandItem, CommandList, CommandPrimitive, CommandSeparator } from './ui/command';
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover';

export const MIN_BUSCA_PESSOA = 2;
export const DEBOUNCE_BUSCA_PESSOA = 250;
const CADASTRAR = '__cadastrar__';

function Unidades({ p }: { p: PessoaBusca }) {
  if (!p.unidadesVinculadasCodigos.length) return <span>Sem vínculo válido</span>;
  return <span>Vínculo: <span className="font-mono">{p.unidadesVinculadasCodigos.join(', ')}</span></span>;
}

export function PessoaCombobox({ rotulo = 'Pessoa', valor, onChange, onCadastrar, indisponivel, autoFocus, erro }: {
  rotulo?: string; valor: PessoaBusca | null; onChange: (p: PessoaBusca | null) => void;
  /** Oferece "Cadastrar nova pessoa" (quem usa decide pela permissão). Recebe o texto digitado. */
  onCadastrar?: (texto: string) => void;
  /** Motivo para a pessoa não poder ser escolhida aqui (ex.: já tem vínculo com a unidade); null = disponível. */
  indisponivel?: (p: PessoaBusca) => string | null;
  autoFocus?: boolean; erro?: string;
}) {
  const api = useApi();
  const id = useId();
  const dicaId = `${id}-d`;
  const inputRef = useRef<HTMLInputElement>(null);
  const trocarRef = useRef<HTMLButtonElement>(null);
  const focarDepois = useRef<'input' | 'trocar' | null>(null);
  const [q, setQ] = useState('');
  const [aberto, setAberto] = useState(false);
  const texto = q.trim();
  const termo = useDebounce(texto, DEBOUNCE_BUSCA_PESSOA);
  const ativo = texto.length >= MIN_BUSCA_PESSOA && termo.length >= MIN_BUSCA_PESSOA;
  const busca = useQuery({
    queryKey: CHAVES.pessoasSeletor(termo),
    queryFn: () => api.pessoas.buscar(termo),
    enabled: ativo,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
  const curto = texto.length < MIN_BUSCA_PESSOA;
  const buscando = !curto && (termo !== texto || busca.isFetching);
  const achados = !curto && termo === texto ? busca.data ?? [] : [];
  const falhou = !curto && !buscando && busca.isError;
  const vazio = !curto && !buscando && !falhou && busca.isSuccess && achados.length === 0;
  const motivo = (p: PessoaBusca) => (p.desativadaEm ? 'Desativada' : indisponivel?.(p) ?? null);

  // O cmdk fixa aria-expanded="true" no campo; aqui ele reflete a lista aberta de fato (o Modal usa isso no Esc).
  useLayoutEffect(() => { inputRef.current?.setAttribute('aria-expanded', String(aberto)); });
  useEffect(() => {
    if (focarDepois.current === 'input') inputRef.current?.focus();
    if (focarDepois.current === 'trocar') trocarRef.current?.focus();
    focarDepois.current = null;
  }, [valor]);

  function escolher(p: PessoaBusca) {
    focarDepois.current = 'trocar';
    setAberto(false); setQ('');
    onChange(p);
  }

  if (valor) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="text-[14px] font-medium">{rotulo}</div>
        <div className="flex items-center gap-[14px] rounded-lg border border-primary-borda bg-[#F0F8F9] px-[14px] py-[10px]">
          <Avatar nome={valor.nome} tamanho={44} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[16px] font-semibold">{valor.nome}</span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-[#33424B]">
              <span className="font-mono">{valor.documentoMascarado}</span>
              <Badge variant="neutro">{ROTULO_CATEGORIA[valor.categoria]}</Badge>
              <span className="text-[13px] text-[#56616B]"><Unidades p={valor} /></span>
            </span>
          </span>
          <Button ref={trocarRef} size="sm" aria-label={`Trocar pessoa (${valor.nome})`}
            onClick={() => { focarDepois.current = 'input'; onChange(null); }}>Trocar</Button>
        </div>
        {erro && <p className="text-[13px] font-medium text-perigo" role="alert">{erro}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[6px]">
      <span aria-hidden className="text-[14px] font-medium">{rotulo}</span>
      <Command shouldFilter={false} label={rotulo} loop
        // cmdk trata setas/Enter no nó raiz; com a lista fechada, a seta só abre.
        onKeyDown={(e) => { if (!aberto && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setAberto(true); } }}>
        <Popover open={aberto} onOpenChange={setAberto}>
          <PopoverAnchor asChild>
            <div>
              <CommandPrimitive.Input ref={inputRef} value={q} {...(autoFocus ? { 'data-autofocus': true } : {})}
                onValueChange={(v) => { setQ(v); setAberto(true); }}
                onFocus={() => { if (q.trim()) setAberto(true); }}
                aria-describedby={dicaId} aria-invalid={erro ? true : undefined}
                placeholder="Nome, início do CPF ou unidade (ex.: D-32)"
                className={cn('input', erro ? 'border-perigo' : null)} />
            </div>
          </PopoverAnchor>
          <PopoverContent onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}
            // Clique no próprio campo não conta como "fora" (senão a lista fecharia e reabriria).
            onInteractOutside={(e) => { if (inputRef.current?.contains(e.target as Node)) e.preventDefault(); }}>
            <CommandList aria-label={`Resultados: ${rotulo.toLowerCase()}`}>
              {curto && <div className="px-3 py-3 text-[14px] text-[#56616B]">Digite ao menos {MIN_BUSCA_PESSOA} caracteres: nome, CPF ou unidade.</div>}
              {buscando && <div className="flex items-center gap-2 px-3 py-3 text-[14px] text-[#56616B]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Buscando…</div>}
              {falhou && <div className="px-3 py-3 text-[14px] font-medium text-perigo">Não foi possível buscar: {mensagemErro(busca.error)}</div>}
              {vazio && <div className="px-3 py-3 text-[14px] text-[#56616B]">Nenhuma pessoa encontrada.</div>}
              {achados.length > 0 && (
                <CommandGroup heading="Pessoas">
                  {achados.map((p) => {
                    const m = motivo(p);
                    return (
                      <CommandItem key={p.id} value={p.id} disabled={!!m} onSelect={() => escolher(p)}>
                        <Avatar nome={p.nome} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">{p.nome}</span>
                          <span className="flex flex-wrap items-center gap-x-2 text-[13px] text-[#56616B]">
                            <span className="font-mono text-[#33424B]">{p.documentoMascarado}</span>
                            <Unidades p={p} />
                          </span>
                          {m && <span className="text-[13px] font-semibold text-[#7A2E0E]">{m}</span>}
                        </span>
                        <Badge variant={m ? 'ambar' : 'neutro'}>{m ? 'Indisponível' : ROTULO_CATEGORIA[p.categoria]}</Badge>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
              {onCadastrar && !curto && (
                <>
                  {achados.length > 0 && <CommandSeparator />}
                  <CommandGroup>
                    <CommandItem value={CADASTRAR} onSelect={() => { setAberto(false); onCadastrar(texto); }} className="font-semibold text-primary">
                      <UserPlus className="h-4 w-4 shrink-0" aria-hidden />Cadastrar nova pessoa
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </PopoverContent>
        </Popover>
      </Command>
      <p id={dicaId} className={cn('text-[13px]', erro ? 'font-medium text-perigo' : 'text-[#56616B]')}>
        {erro ?? 'Setas escolhem, Enter confirma, Esc fecha a lista.'}
      </p>
      {/* Anúncio para leitor de tela (a lista é um popover e não fala sozinha o resultado). */}
      <span className="sr-only" role="status" aria-live="polite">
        {aberto ? (buscando ? 'Busca em andamento.' : falhou ? 'Falha na busca.' : vazio ? 'Nenhum resultado.' : achados.length ? `${achados.length} resultado(s).` : '') : ''}
      </span>
    </div>
  );
}
