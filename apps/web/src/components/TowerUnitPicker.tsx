import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { andarDoNumero } from '@portaria/domain/units';
import { useCatalogo } from '../app/catalogo';
import { UnitTag } from './UnitTag';

/** Números das unidades ATIVAS de uma torre, vindos do banco (RF-01), em ordem numérica. */
export function useNumerosDaTorre(): (torre: number) => string[] {
  const { ativas } = useCatalogo();
  return useMemo(() => {
    const por = new Map<number, string[]>();
    for (const u of ativas) por.set(u.torre, [...(por.get(u.torre) ?? []), u.numero]);
    for (const v of por.values()) v.sort((a, b) => Number(a) - Number(b));
    return (torre: number) => por.get(torre) ?? [];
  }, [ativas]);
}

/** Torres com ao menos uma unidade ativa. */
export function useTorres(): number[] {
  const { ativas } = useCatalogo();
  return useMemo(() => [...new Set(ativas.map((u) => u.torre))].sort((a, b) => a - b), [ativas]);
}

export interface TowerUnitPickerHandle { focusTorre: () => void; focusUnidade: () => void }

/** Andares de cima para baixo: "5º and." com os apartamentos x1–x4 (torre 9: 11–15 no 1º andar). */
export function andaresDaTorre(numerosDaTorre: string[]): { andar: number; rotulo: string; numeros: string[] }[] {
  const por = new Map<number, string[]>();
  for (const n of numerosDaTorre) {
    const andar = andarDoNumero(n);
    por.set(andar, [...(por.get(andar) ?? []), n]);
  }
  return [...por.entries()].sort((a, b) => b[0] - a[0]).map(([andar, numeros]) => ({ andar, rotulo: `${andar}º and.`, numeros }));
}

type Variante = 'entrada' | 'lista' | 'modal';
const TORRE_BOTAO: Record<Variante, string> = {
  entrada: 'h-12 w-12 rounded-lg text-[18px]',
  modal: 'h-11 w-11 rounded-lg text-[17px]',
  lista: 'h-9 rounded-md text-[15px]',
};

/** Botões das torres com unidade ativa (radiogroup; teclas 1–9 escolhem a torre). */
export const BotoesTorre = forwardRef<HTMLDivElement, {
  torre: number | null; onEscolher: (t: number) => void; variante?: Variante; desabilitado?: boolean; autoFocus?: boolean; rotulo?: string;
  /** Torres exibidas (padrão: as que têm unidade ativa no catálogo). */ torres?: number[];
}>(function BotoesTorre({ torre, onEscolher, variante = 'entrada', desabilitado, autoFocus, rotulo = 'Torre', torres: lista }, ref) {
  const doCatalogo = useTorres();
  const torres = lista ?? doCatalogo;
  const primeira = torres[0];
  return (
    <div ref={ref} role="radiogroup" aria-label={rotulo}
      className={variante === 'lista' ? 'grid grid-cols-9 gap-1' : 'flex flex-wrap gap-2'}
      onKeyDown={(e) => {
        if (desabilitado) return;
        if (/^[1-9]$/.test(e.key) && torres.includes(Number(e.key))) { e.preventDefault(); onEscolher(Number(e.key)); }
      }}>
      {torres.map((t) => {
        const ativo = torre === t;
        return (
          <button key={t} type="button" role="radio" aria-checked={ativo} disabled={desabilitado}
            tabIndex={ativo || (torre === null && t === primeira) ? 0 : -1}
            {...(autoFocus && (ativo || (torre === null && t === primeira)) ? { 'data-autofocus': true } : {})}
            onClick={() => onEscolher(t)}
            className={`border font-mono font-semibold ${TORRE_BOTAO[variante]} ${ativo ? 'border-[#0B5563] bg-[#0B5563] text-white' : 'border-[#B9C3CA] bg-white text-ink hover:bg-[#EEF2F4]'}`}>
            {t}
          </button>
        );
      })}
    </div>
  );
});

/** Grade por andar (linhas de cima para baixo, rótulo à esquerda, apartamentos em colunas). */
export function GradeAndares({ torre, numero, onEscolher, variante = 'entrada', destaque, desabilitado, numeros: lista, inativos }: {
  torre: number; numero?: string | null; onEscolher: (n: string) => void; variante?: Variante;
  /** Unidades com cadastro detalhado (azul claro). */ destaque?: ReadonlySet<string>; desabilitado?: boolean;
  /** Números exibidos (padrão: unidades ativas da torre). */ numeros?: string[];
  /** Números de unidades desativadas (tracejado). */ inativos?: ReadonlySet<string>;
}) {
  const numerosDaTorre = useNumerosDaTorre();
  const andares = andaresDaTorre(lista ?? numerosDaTorre(torre));
  const colunas = Math.max(1, ...andares.map((a) => a.numeros.length));
  const rotuloLargura = variante === 'entrada' ? '48px' : '42px';
  const botao = variante === 'entrada' ? 'h-[34px] rounded-md text-[14px]' : variante === 'modal' ? 'h-8 rounded-[5px] text-[13px]' : 'h-8 rounded-[5px] text-[13px]';
  return (
    <div role="group" aria-label={`Unidades da torre ${torre}`}
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

/** Caixa destacada da unidade escolhida: "TORRE 4 · AP 32" + botão Alterar. */
export function UnidadeEscolhida({ id, onAlterar, grande = true }: { id: string; onAlterar: () => void; grande?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 rounded-[10px] border-2 border-[#0B5563] bg-[#F0F8F9] ${grande ? 'px-[18px] py-[14px]' : 'px-4 py-3'}`} aria-live="polite">
      <UnitTag id={id} tamanho={grande ? 'xl' : 'lg'} />
      <button type="button" onClick={onAlterar} className="h-10 rounded-lg border border-[#B9C3CA] bg-white px-[14px] text-[14px] hover:bg-[#EEF2F4]">Alterar</button>
    </div>
  );
}

/**
 * Seletor de torre e unidade do fluxo de entrada, operável só pelo teclado (RNF-07):
 * - no grupo de torres, as teclas 1–9 escolhem a torre e levam o foco ao campo de apartamento;
 * - no campo de apartamento, digitar um número válido (ex.: 32) escolhe a unidade e dispara onComplete;
 * - também é possível clicar na grade por andar.
 * A torre 9 só tem as unidades 11 a 15; as torres 1–8 têm 11–14 até 51–54.
 */
export const TowerUnitPicker = forwardRef<TowerUnitPickerHandle, {
  torre: number | null; numero: string | null; onChange: (torre: number | null, numero: string | null) => void; onComplete?: () => void;
  onAlterar?: () => void; desabilitado?: boolean; autoFocusTorre?: boolean; variante?: 'entrada' | 'modal';
}>(function TowerUnitPicker({ torre, numero, onChange, onComplete, onAlterar, desabilitado, autoFocusTorre, variante = 'entrada' }, ref) {
  const grupoRef = useRef<HTMLDivElement>(null);
  const unidadeRef = useRef<HTMLInputElement>(null);
  const [digitado, setDigitado] = useState(numero ?? '');
  const numerosDaTorre = useNumerosDaTorre();
  const { porTorreNumero } = useCatalogo();
  const numeros = torre ? numerosDaTorre(torre) : [];
  const maxDigitos = Math.max(2, ...numeros.map((n) => n.length));
  // Inválido: nenhum número desta torre começa com o que foi digitado
  const invalido = digitado.length >= 2 && !numeros.some((n) => n.startsWith(digitado));

  useImperativeHandle(ref, () => ({
    focusTorre: () => (grupoRef.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? grupoRef.current?.querySelector<HTMLElement>('button'))?.focus(),
    focusUnidade: () => unidadeRef.current?.focus(),
  }));

  function escolherTorre(t: number) {
    setDigitado('');
    onChange(t, null);
    setTimeout(() => unidadeRef.current?.focus(), 0);
  }
  function escolherUnidade(n: string) {
    setDigitado(n);
    onChange(torre, n);
    onComplete?.();
  }
  function alterar() {
    setDigitado('');
    if (onAlterar) onAlterar(); else onChange(null, null);
  }

  const escolhida = torre && numero ? porTorreNumero(torre, numero) : undefined;
  if (escolhida) return <UnidadeEscolhida id={escolhida.id} onAlterar={alterar} grande={variante === 'entrada'} />;

  const rotulo = 'w-14 shrink-0 text-[14px] font-medium';
  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center gap-2">
        <span id="rotulo-torre" className={rotulo}>Torre</span>
        <BotoesTorre ref={grupoRef} torre={torre} onEscolher={escolherTorre} variante={variante} desabilitado={desabilitado} autoFocus={autoFocusTorre} rotulo="Torre (teclas 1 a 9)" />
      </div>
      {torre && (
        <div className="flex gap-2">
          <span className={`${rotulo} pt-1.5`}>Unidade</span>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <GradeAndares torre={torre} numero={numero} onEscolher={escolherUnidade} variante={variante} desabilitado={desabilitado} />
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
                  if (torre && unico) escolherUnidade(v); else if (numero) onChange(torre, null);
                }}
                aria-invalid={invalido} aria-describedby="ajuda-unidade" />
              <span id="ajuda-unidade" className={`text-[13px] ${invalido ? 'font-medium text-[#B42318]' : 'sr-only'}`}>
                {invalido ? 'Unidade inexistente nesta torre.' : 'Digite o número ou clique em uma unidade.'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
