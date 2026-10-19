import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { andarDoNumero, compararBlocos, doAgrupamento, nesteAgrupamento } from '@portaria/domain/units';
import { useCatalogo } from '../app/catalogo';
import { UnitTag } from './UnitTag';

/** Números das unidades ATIVAS de um bloco, vindos do banco (RF-01), em ordem numérica. */
export function useNumerosDoBloco(): (bloco: string) => string[] {
  const { ativas } = useCatalogo();
  return useMemo(() => {
    const por = new Map<string, string[]>();
    for (const u of ativas) por.set(u.bloco, [...(por.get(u.bloco) ?? []), u.numero]);
    for (const v of por.values()) v.sort((a, b) => Number(a) - Number(b));
    return (bloco: string) => por.get(bloco) ?? [];
  }, [ativas]);
}

/** Blocos com ao menos uma unidade ativa, em ordem natural ("2" antes de "10", "A" antes de "B"). */
export function useBlocos(): string[] {
  const { ativas } = useCatalogo();
  return useMemo(() => [...new Set(ativas.map((u) => u.bloco))].sort(compararBlocos), [ativas]);
}

export interface TowerUnitPickerHandle { focusBloco: () => void; focusUnidade: () => void }

/** Andares de cima para baixo: "4º and." ... "Térreo", com os apartamentos de cada andar. */
export function andaresDoBloco(numerosDoBloco: string[]): { andar: number; rotulo: string; numeros: string[] }[] {
  const por = new Map<number, string[]>();
  for (const n of numerosDoBloco) {
    const andar = andarDoNumero(n);
    por.set(andar, [...(por.get(andar) ?? []), n]);
  }
  return [...por.entries()].sort((a, b) => b[0] - a[0])
    .map(([andar, numeros]) => ({ andar, rotulo: andar === 0 ? 'Térreo' : `${andar}º and.`, numeros }));
}

/** "Bloco (teclas A a I)": o atalho só existe para bloco de um caractere. */
function rotuloTeclas(agrupamento: string, blocos: string[]): string {
  const teclas = blocos.filter((b) => b.length === 1);
  if (!teclas.length) return agrupamento;
  return teclas.length === 1 ? `${agrupamento} (tecla ${teclas[0]})` : `${agrupamento} (teclas ${teclas[0]} a ${teclas[teclas.length - 1]})`;
}

type Variante = 'entrada' | 'lista' | 'modal';
const BLOCO_BOTAO: Record<Variante, string> = {
  entrada: 'h-12 w-12 rounded-lg text-[18px]',
  modal: 'h-11 w-11 rounded-lg text-[17px]',
  lista: 'h-9 rounded-md text-[15px]',
};

/** Botões dos blocos com unidade ativa (radiogroup; a tecla do bloco, "A" ou "4", o escolhe). */
export const BotoesBloco = forwardRef<HTMLDivElement, {
  bloco: string | null; onEscolher: (b: string) => void; variante?: Variante; desabilitado?: boolean; autoFocus?: boolean; rotulo?: string;
  /** Blocos exibidos (padrão: os que têm unidade ativa no catálogo). */ blocos?: string[];
}>(function BotoesBloco({ bloco, onEscolher, variante = 'entrada', desabilitado, autoFocus, rotulo, blocos: lista }, ref) {
  const doCatalogo = useBlocos();
  const { agrupamento } = useCatalogo();
  const blocos = lista ?? doCatalogo;
  const primeiro = blocos[0];
  return (
    <div ref={ref} role="radiogroup" aria-label={rotulo ?? agrupamento}
      className={variante === 'lista' ? 'grid grid-cols-9 gap-1' : 'flex flex-wrap gap-2'}
      onKeyDown={(e) => {
        if (desabilitado || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
        const b = e.key.toUpperCase();
        if (blocos.includes(b)) { e.preventDefault(); onEscolher(b); }
      }}>
      {blocos.map((b) => {
        const ativo = bloco === b;
        return (
          <button key={b} type="button" role="radio" aria-checked={ativo} disabled={desabilitado}
            tabIndex={ativo || (bloco === null && b === primeiro) ? 0 : -1}
            {...(autoFocus && (ativo || (bloco === null && b === primeiro)) ? { 'data-autofocus': true } : {})}
            onClick={() => onEscolher(b)}
            className={`border font-mono font-semibold ${BLOCO_BOTAO[variante]} ${ativo ? 'border-[#0B5563] bg-[#0B5563] text-white' : 'border-[#B9C3CA] bg-white text-ink hover:bg-[#EEF2F4]'}`}>
            {b}
          </button>
        );
      })}
    </div>
  );
});

/** Grade por andar (linhas de cima para baixo, rótulo à esquerda, apartamentos em colunas). */
export function GradeAndares({ bloco, numero, onEscolher, variante = 'entrada', destaque, desabilitado, numeros: lista, inativos }: {
  bloco: string; numero?: string | null; onEscolher: (n: string) => void; variante?: Variante;
  /** Unidades com cadastro detalhado (azul claro). */ destaque?: ReadonlySet<string>; desabilitado?: boolean;
  /** Números exibidos (padrão: unidades ativas do bloco). */ numeros?: string[];
  /** Números de unidades desativadas (tracejado). */ inativos?: ReadonlySet<string>;
}) {
  const numerosDoBloco = useNumerosDoBloco();
  const { agrupamento } = useCatalogo();
  const andares = andaresDoBloco(lista ?? numerosDoBloco(bloco));
  const colunas = Math.max(1, ...andares.map((a) => a.numeros.length));
  const rotuloLargura = variante === 'entrada' ? '48px' : '42px';
  const botao = variante === 'entrada' ? 'h-[34px] rounded-md text-[14px]' : variante === 'modal' ? 'h-8 rounded-[5px] text-[13px]' : 'h-8 rounded-[5px] text-[13px]';
  return (
    <div role="group" aria-label={`Unidades ${doAgrupamento(agrupamento)} ${bloco}`}
      className={variante === 'modal' ? 'flex flex-col gap-1 max-w-[360px]' : `flex flex-col gap-1 ${variante === 'entrada' ? 'max-w-[420px]' : ''}`}>
      {andares.map((a) => (
        <div key={a.andar} className="grid items-center gap-1" style={{ gridTemplateColumns: `${rotuloLargura} repeat(${colunas}, minmax(0, 1fr))` }}>
          <span className="whitespace-nowrap text-[12px] text-[#56616B]">{a.rotulo}</span>
          {a.numeros.map((n) => {
            const sel = numero === n;
            const det = destaque?.has(n);
            const inativo = inativos?.has(n);
            return (
              <button key={n} type="button" disabled={desabilitado} aria-pressed={sel} aria-label={`Apartamento ${n}${inativo ? ' (desativada)' : ''}`} onClick={() => onEscolher(n)}
                className={`border font-mono ${botao} ${
                  sel ? 'border-[#0B5563] bg-[#0B5563] text-white'
                    : inativo ? 'border-dashed border-[#B9C3CA] bg-[#F3F5F6] text-[#56616B] line-through'
                    : det ? 'border-[#A9D2D8] bg-[#E3F0F2] text-[#0B4450] hover:border-[#0B5563]'
                    : 'border-[#C5CDD3] bg-white text-ink hover:border-[#0B5563] hover:bg-[#E3F0F2]'}`}>
                {n}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Caixa destacada da unidade escolhida: "BLOCO D · AP 32" + botão Alterar. */
export function UnidadeEscolhida({ id, onAlterar, grande = true }: { id: string; onAlterar: () => void; grande?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 rounded-[10px] border-2 border-[#0B5563] bg-[#F0F8F9] ${grande ? 'px-[18px] py-[14px]' : 'px-4 py-3'}`} aria-live="polite">
      <UnitTag id={id} tamanho={grande ? 'xl' : 'lg'} />
      <button type="button" onClick={onAlterar} className="h-10 rounded-lg border border-[#B9C3CA] bg-white px-[14px] text-[14px] hover:bg-[#EEF2F4]">Alterar</button>
    </div>
  );
}

/**
 * Seletor de bloco e unidade do fluxo de entrada, operável só pelo teclado (RNF-07):
 * - no grupo de blocos, a tecla do bloco ("A", "4") o escolhe e leva o foco ao campo de apartamento;
 * - no campo de apartamento, digitar um número válido (ex.: 32, ou 03 no térreo) escolhe a unidade e dispara onComplete;
 * - também é possível clicar na grade por andar.
 * Blocos e números vêm do catálogo (banco): a grade mostra o que existe, inclusive exceções cadastradas à mão.
 */
export const TowerUnitPicker = forwardRef<TowerUnitPickerHandle, {
  bloco: string | null; numero: string | null; onChange: (bloco: string | null, numero: string | null) => void; onComplete?: () => void;
  onAlterar?: () => void; desabilitado?: boolean; autoFocusBloco?: boolean; variante?: 'entrada' | 'modal';
}>(function TowerUnitPicker({ bloco, numero, onChange, onComplete, onAlterar, desabilitado, autoFocusBloco, variante = 'entrada' }, ref) {
  const grupoRef = useRef<HTMLDivElement>(null);
  const unidadeRef = useRef<HTMLInputElement>(null);
  const [digitado, setDigitado] = useState(numero ?? '');
  const numerosDoBloco = useNumerosDoBloco();
  const blocos = useBlocos();
  const { porBlocoNumero, agrupamento } = useCatalogo();
  const numeros = bloco ? numerosDoBloco(bloco) : [];
  const maxDigitos = Math.max(2, ...numeros.map((n) => n.length));
  // Inválido: nenhum número deste bloco começa com o que foi digitado
  const invalido = digitado.length >= 2 && !numeros.some((n) => n.startsWith(digitado));

  useImperativeHandle(ref, () => ({
    focusBloco: () => (grupoRef.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? grupoRef.current?.querySelector<HTMLElement>('button'))?.focus(),
    focusUnidade: () => unidadeRef.current?.focus(),
  }));

  function escolherBloco(b: string) {
    setDigitado('');
    onChange(b, null);
    setTimeout(() => unidadeRef.current?.focus(), 0);
  }
  function escolherUnidade(n: string) {
    setDigitado(n);
    onChange(bloco, n);
    onComplete?.();
  }
  function alterar() {
    setDigitado('');
    if (onAlterar) onAlterar(); else onChange(null, null);
  }

  const escolhida = bloco && numero ? porBlocoNumero(bloco, numero) : undefined;
  if (escolhida) return <UnidadeEscolhida id={escolhida.id} onAlterar={alterar} grande={variante === 'entrada'} />;

  const rotulo = 'w-14 shrink-0 text-[14px] font-medium';
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center gap-2">
        <span id="rotulo-bloco" className={rotulo}>{agrupamento}</span>
        <BotoesBloco ref={grupoRef} bloco={bloco} onEscolher={escolherBloco} variante={variante} desabilitado={desabilitado} autoFocus={autoFocusBloco}
          rotulo={rotuloTeclas(agrupamento, blocos)} blocos={blocos} />
      </div>
      {bloco && (
        <div className="flex gap-2">
          <span className={`${rotulo} pt-1.5`}>Unidade</span>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <GradeAndares bloco={bloco} numero={numero} onEscolher={escolherUnidade} variante={variante} desabilitado={desabilitado} />
            <div className="flex items-center gap-3">
              <label htmlFor="campo-unidade" className="text-[13px] text-[#56616B]">
                Ou digite o apartamento{numeros.length > 0 && numeros.length <= 6 ? ` (${numeros[0]} a ${numeros[numeros.length - 1]})` : ''}
              </label>
              <input ref={unidadeRef} id="campo-unidade" className="input !h-9 !w-[88px] font-mono" inputMode="numeric" maxLength={maxDigitos} autoComplete="off"
                disabled={desabilitado} placeholder="ex.: 32" value={digitado}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, maxDigitos);
                  setDigitado(v);
                  // Escolhe quando o número existe e nenhum outro (mais longo) começa com ele
                  const unico = numeros.includes(v) && !numeros.some((n) => n !== v && n.startsWith(v));
                  if (bloco && unico) escolherUnidade(v); else if (numero) onChange(bloco, null);
                }}
                aria-invalid={invalido} aria-describedby="ajuda-unidade" />
              <span id="ajuda-unidade" className={`text-[13px] ${invalido ? 'font-medium text-[#B42318]' : 'sr-only'}`}>
                {invalido ? `Unidade inexistente ${nesteAgrupamento(agrupamento)}.` : 'Digite o número ou clique em uma unidade.'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
