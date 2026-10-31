// Barra de filtros única das listas: mesmo cartão, mesmos controles e "Limpar filtros" sempre no mesmo lugar.
// Desktop (md+): campos em linha, quebrando para a linha de baixo. Celular: só o campo principal (a busca) e o botão
// "Filtros (n)", que abre o resto. Os filtros que não são dado pessoal vão para a URL (useFiltrosUrl); nome, CPF,
// texto livre e placa ficam só no estado (LGPD: a URL vai para histórico, log de proxy e Referer).
import { useCallback, useId, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, Search } from 'lucide-react';
import { DIA, agora, fromInput, toInputDate } from '@portaria/domain/time';
import { useCatalogo } from '../app/catalogo';

/** Controle (input/select) dos filtros: 44px no celular, 40px no desktop. */
export const CONTROLE = 'input !h-[44px] !px-[10px] !text-[14px] md:!h-10';

// --- URL -------------------------------------------------------------------------------------------------------------

// Escritas na URL no mesmo instante (ex.: "Limpar filtros" chama período, unidade e selects): o setParams funcional do
// react-router não enfileira, a segunda sobrescreveria a primeira. Este módulo junta as escritas até o fim do tick.
let emEscrita: URLSearchParams | null = null;

/**
 * Parâmetros da URL como estado dos filtros. `gravar` troca só as chaves passadas (as demais, como `novo=1`, ficam),
 * com replace (não polui o histórico). `undefined` remove a chave: valor padrão não vai para a URL.
 */
export function useFiltrosUrl() {
  const [params, setParams] = useSearchParams();
  const gravar = useCallback((parte: Record<string, string | undefined>) => {
    const novo = new URLSearchParams(emEscrita ?? window.location.search);
    for (const [k, v] of Object.entries(parte)) { if (v === undefined) novo.delete(k); else novo.set(k, v); }
    emEscrita = novo;
    queueMicrotask(() => { emEscrita = null; });
    setParams(novo, { replace: true });
  }, [setParams]);
  return { params, gravar };
}

/** Valor da URL só se for um dos válidos; senão o padrão. */
export const lerOpcao = <T extends string>(v: string | null, validos: readonly T[], padrao: T): T => (v !== null && (validos as readonly string[]).includes(v) ? (v as T) : padrao);
/** Valor para a URL: o padrão não vai (URL limpa). */
export const naUrl = (v: string, padrao: string) => (v === padrao ? undefined : v);
const dataOk = (v: string | null): v is string => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v) && fromInput(v) !== null;

// --- Período ---------------------------------------------------------------------------------------------------------

/** "Últimos N dias", contando hoje (1 = hoje). Datas no formato do input date. */
export function ultimosDias(n: number) {
  return { de: toInputDate(agora() - (n - 1) * DIA), ate: toInputDate(agora()) };
}

/** Período nos parâmetros `de` e `ate`. Vazio é válido (sem limite) e vai como parâmetro vazio. */
export function usePeriodoUrl(diasPadrao: number) {
  const { params, gravar } = useFiltrosUrl();
  const padrao = ultimosDias(diasPadrao);
  const ler = (k: 'de' | 'ate') => { const v = params.get(k); return v === null ? padrao[k] : v === '' ? '' : dataOk(v) ? v : padrao[k]; };
  const de = ler('de');
  const ate = ler('ate');
  const alterar = (novoDe: string, novoAte: string) => gravar({ de: naUrl(novoDe, padrao.de), ate: naUrl(novoAte, padrao.ate) });
  return { de, ate, alterar, ativo: de !== padrao.de || ate !== padrao.ate, limpar: () => gravar({ de: undefined, ate: undefined }) };
}

// --- Componentes -----------------------------------------------------------------------------------------------------

export function BarraFiltros({ children, ativos, onLimpar, principal, principalAtivo = false, rotulo = 'Filtros', resultado }: {
  children?: ReactNode;
  /** Quantos filtros diferem do padrão (inclui o principal, se preenchido). */
  ativos: number;
  onLimpar: () => void;
  /** Campo sempre visível no celular (normalmente a busca). */
  principal?: ReactNode;
  /** O principal está preenchido: não entra na contagem do botão "Filtros (n)", que só fala do que está escondido. */
  principalAtivo?: boolean;
  rotulo?: string;
  /** Contagem do resultado dentro do cartão, à direita, antes do "Limpar filtros" (ex.: `ContagemResultado`). */
  resultado?: ReactNode;
}) {
  const painel = useId();
  // Começa aberto no celular se já há filtro aplicado (ex.: voltou de outra tela com a URL filtrada)
  const [aberto, setAberto] = useState(() => ativos > 0);
  const escondidos = Math.max(0, ativos - (principalAtivo ? 1 : 0));
  return (
    <form role="search" aria-label={rotulo} onSubmit={(e) => e.preventDefault()}
      className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-[10px] border border-[#DCE1E5] bg-white px-4 py-4 sm:px-5">
      <div className="flex w-full items-end gap-2 md:contents">
        {principal && <div className="min-w-0 flex-1 md:flex-none">{principal}</div>}
        {children && <button type="button" aria-expanded={aberto} aria-controls={painel} onClick={() => setAberto(!aberto)}
          className="inline-flex h-[44px] shrink-0 items-center gap-1.5 rounded-lg border border-[#B9C3CA] bg-white px-3 text-[14px] font-medium text-[#33424B] hover:border-[#0B5563] md:hidden">
          {escondidos > 0 ? `Filtros (${escondidos})` : 'Filtros'}
          <ChevronDown className={`h-4 w-4 transition-transform ${aberto ? 'rotate-180' : ''}`} aria-hidden />
        </button>}
      </div>
      <div id={painel} className={`${(aberto || !children) && !(!children && ativos === 0) ? 'flex' : 'hidden'} w-full flex-col gap-3 md:contents`}>
        {children}
        {ativos > 0 && (
          <button type="button" onClick={onLimpar}
            className={`h-[44px] self-start px-1 text-[14px] font-semibold text-[#0B5563] hover:underline md:order-2 md:h-10 md:self-end ${resultado ? '' : 'md:ml-auto'}`}>
            Limpar filtros ({ativos})
          </button>
        )}
      </div>
      {resultado && <div className="flex w-full items-center md:order-1 md:ml-auto md:h-10 md:w-auto md:self-end">{resultado}</div>}
    </form>
  );
}

/** Rótulo em cima, controle embaixo. `largura`: classe de largura no desktop (ex.: 'md:w-56'); no celular ocupa a linha. */
export function CampoFiltro({ rotulo, children, largura = '', como = 'label', className = '' }: {
  rotulo: ReactNode; children: ReactNode; largura?: string; como?: 'label' | 'group'; className?: string;
}) {
  const cls = `flex w-full min-w-0 flex-col gap-1 text-[13px] font-medium text-[#33424B] md:w-auto ${largura} ${className}`;
  return como === 'label'
    ? <label className={cls}>{rotulo}{children}</label>
    : <div role="group" className={cls} aria-label={typeof rotulo === 'string' ? rotulo : undefined}><span aria-hidden>{rotulo}</span>{children}</div>;
}

export function FiltroBusca({ rotulo, value, onChange, placeholder, largura = 'md:w-80' }: {
  rotulo: string; value: string; onChange: (v: string) => void; placeholder?: string; largura?: string;
}) {
  return (
    <CampoFiltro rotulo={rotulo} largura={largura}>
      <span className="relative block">
        <Search className="pointer-events-none absolute left-[11px] top-1/2 h-4 w-4 -translate-y-1/2 text-[#56616B]" aria-hidden />
        <input type="text" className={`${CONTROLE} !pl-[34px]`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </span>
    </CampoFiltro>
  );
}

export function FiltroCheck({ rotulo, checked, onChange }: { rotulo: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[44px] w-full cursor-pointer items-center gap-2 text-[14px] md:min-h-10 md:w-auto">
      <input type="checkbox" className="h-[18px] w-[18px] accent-[#0B5563]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {rotulo}
    </label>
  );
}

const ATALHOS = [{ rotulo: 'Hoje', dias: 1 }, { rotulo: '7 dias', dias: 7 }, { rotulo: '30 dias', dias: 30 }];

/** Período: um rótulo, duas datas lado a lado e, se `atalhos`, chips "Hoje / 7 dias / 30 dias". */
export function FiltroPeriodo({ de, ate, onChange, atalhos = false }: {
  de: string; ate: string; onChange: (de: string, ate: string) => void; atalhos?: boolean;
}) {
  // Atalhos na linha do rótulo: o campo fica com a largura das datas e cabe na barra em 1280 px
  return (
    <div role="group" aria-label="Período" className="flex w-full min-w-0 flex-col gap-1 text-[13px] font-medium text-[#33424B] md:w-[300px]">
      <span className="flex min-h-[20px] items-center justify-between gap-2">
        <span aria-hidden>Período</span>
        {atalhos && (
          <span className="flex gap-1">
            {ATALHOS.map((a) => {
              const p = ultimosDias(a.dias);
              const marcado = de === p.de && ate === p.ate;
              return (
                <button key={a.dias} type="button" aria-pressed={marcado} onClick={() => onChange(p.de, p.ate)}
                  className={`h-8 rounded-md px-2 text-[12.5px] md:h-6 ${marcado ? 'bg-[#E3F0F2] font-semibold text-[#0B5563]' : 'font-medium text-[#56616B] hover:bg-[#EEF2F4] hover:text-ink'}`}>
                  {a.rotulo}
                </button>
              );
            })}
          </span>
        )}
      </span>
      <span className="flex gap-1.5">
        <input type="date" aria-label="De" className={`${CONTROLE} min-w-0 flex-1`} value={de} max={ate || undefined} onChange={(e) => onChange(e.target.value, ate)} />
        <input type="date" aria-label="Até" className={`${CONTROLE} min-w-0 flex-1`} value={ate} min={de || undefined} onChange={(e) => onChange(de, e.target.value)} />
      </span>
    </div>
  );
}

/**
 * Unidade digitada ("D-32"), resolvida pelo catálogo. Na URL vai só o código da unidade resolvida (`chave`, padrão
 * `un`); texto que não resolve não filtra e não vai para a URL.
 */
export function useFiltroUnidade(chave = 'un') {
  const catalogo = useCatalogo();
  const { params, gravar } = useFiltrosUrl();
  const [texto, setTexto] = useState(() => params.get(chave) ?? '');
  const un = texto.trim() ? catalogo.porTexto(texto) : undefined;
  const pendente = !!texto.trim() && !catalogo.pronto;
  const alterar = (t: string) => {
    setTexto(t);
    const u = t.trim() ? catalogo.porTexto(t) : undefined;
    gravar({ [chave]: u ? catalogo.codigo(u.id) : undefined });
  };
  return {
    texto, unidadeId: un?.id as string | undefined, alterar,
    /** Digitou algo que não é unidade (só depois de o catálogo carregar). */
    invalida: !!texto.trim() && catalogo.pronto && !un,
    /** Veio texto da URL e o catálogo ainda não resolveu: a consulta espera. */
    pendente,
    limpar: () => { setTexto(''); gravar({ [chave]: undefined }); },
  };
}

export function FiltroUnidade({ f, largura = 'md:w-36' }: { f: ReturnType<typeof useFiltroUnidade>; largura?: string }) {
  return (
    <CampoFiltro rotulo="Unidade" largura={largura}>
      <input className={`${CONTROLE} font-sans`} placeholder="Ex.: D-32" value={f.texto} onChange={(e) => f.alterar(e.target.value)} aria-invalid={f.invalida} />
      {f.invalida && <span className="text-[12px] font-normal text-[#B42318]">Use D-32.</span>}
    </CampoFiltro>
  );
}

/** Contagem na linha de cima da tabela (não dentro da barra). Ex.: "5 eventos nos filtros escolhidos". */
export function ContagemResultado({ n, singular, plural, sufixo = 'nos filtros escolhidos', className = '' }: {
  n: number; singular: string; plural: string; sufixo?: string; className?: string;
}) {
  return <p aria-live="polite" className={`text-[14px] text-[#56616B] ${className}`}>{n} {n === 1 ? singular : plural}{sufixo ? ` ${sufixo}` : ''}</p>;
}
