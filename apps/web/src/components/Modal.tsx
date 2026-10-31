import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Ban, X } from 'lucide-react';
import type { Tom } from './Badge';

let abertos = 0;
/** Páginas usam isto para não tratar Esc/Enter globais enquanto há modal aberto. */
export const temModalAberto = () => abertos > 0;

const FOCAVEIS = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Foco preso, Esc fecha, devolve o foco ao fechar. */
export function useArmadilhaDeFoco(ref: RefObject<HTMLElement>, onClose: () => void, ativo = true) {
  const fecharRef = useRef(onClose);
  fecharRef.current = onClose;
  useEffect(() => {
    if (!ativo) return;
    abertos++;
    const anterior = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const auto = el.querySelector<HTMLElement>('[data-autofocus]');
    // O X de fechar (data-fechar) fica no ciclo do Tab, mas não recebe o foco inicial
    const primeiroCampo = Array.from(el.querySelectorAll<HTMLElement>(FOCAVEIS)).find((x) => !x.hasAttribute('data-fechar'));
    (auto ?? primeiroCampo ?? el).focus();

    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Esc fecha primeiro o popup aberto dentro do modal (lista de um combobox, popover do Radix), não o modal.
        const alvo = e.target instanceof Element ? e.target : null;
        if (alvo?.closest('[data-radix-popper-content-wrapper], [role="combobox"][aria-expanded="true"]')) return;
        e.preventDefault(); e.stopPropagation(); fecharRef.current(); return;
      }
      if (e.key !== 'Tab') return;
      const itens = Array.from(el.querySelectorAll<HTMLElement>(FOCAVEIS)).filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (itens.length === 0) { e.preventDefault(); return; }
      const primeiro = itens[0], ultimo = itens[itens.length - 1];
      if (e.shiftKey && (document.activeElement === primeiro || !el.contains(document.activeElement))) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && (document.activeElement === ultimo || !el.contains(document.activeElement))) { e.preventDefault(); primeiro.focus(); }
    }
    document.addEventListener('keydown', tecla, true);
    return () => {
      document.removeEventListener('keydown', tecla, true);
      abertos--;
      anterior?.focus?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo]);
}

const TAMANHO = { p: 'sm:w-[480px]', m: 'sm:w-[640px]', g: 'sm:w-[760px]' } as const;
export type TamanhoModal = keyof typeof TAMANHO;

/** Botão X dos modais e da gaveta: 44px no celular, 40px de sm em diante. Fica no Tab, mas não pega o foco inicial. */
function BotaoFechar({ onClose, className = '' }: { onClose: () => void; className?: string }) {
  return (
    <button type="button" data-fechar aria-label="Fechar" onClick={onClose}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[#56616B] transition-colors hover:bg-[#EEF2F4] sm:h-10 sm:w-10 ${className}`}>
      <X className="h-5 w-5" aria-hidden />
    </button>
  );
}

/**
 * Modal acessível (role=dialog, aria-modal) em 3 faixas: cabeçalho fixo (título + X), conteúdo que rola (gap 16px)
 * e rodapé fixo com as ações (só existe se houver `rodape`). Abaixo de sm ocupa a tela toda; de sm em diante é um
 * cartão centralizado (raio 12px). Tamanhos: p=480, m=640 (padrão), g=760. `tom="vermelho"` = alerta de restrição
 * (cabeçalho vermelho, sem X: exige ação explícita); `tom="petroleo"` = confirmação com borda petróleo.
 * `semFechar`: sem X, para o que não pode sumir por um clique (senha temporária: só aparece uma vez).
 */
export function Modal({ titulo, onClose, children, rodape, tom = 'neutro', tamanho = 'm', tituloId = 'modal-titulo', tituloOculto, semFechar, role }: {
  titulo: ReactNode; onClose: () => void; children: ReactNode; rodape?: ReactNode; tom?: Tom; tamanho?: TamanhoModal; tituloId?: string;
  tituloOculto?: boolean; semFechar?: boolean; role?: 'dialog' | 'alertdialog';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useArmadilhaDeFoco(ref, onClose);
  const alerta = tom === 'vermelho';
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-[rgba(12,22,28,0.58)] sm:items-center sm:p-4">
      <div ref={ref} role={role ?? (alerta ? 'alertdialog' : 'dialog')} aria-modal="true" aria-labelledby={tituloId} tabIndex={-1}
        className={`relative flex h-[100vh] h-[100dvh] w-full max-w-full flex-col overflow-hidden bg-white sm:h-auto sm:max-h-[calc(100dvh-32px)] sm:rounded-xl sm:shadow-[0_24px_64px_rgba(0,0,0,0.3)] ${TAMANHO[tamanho]} ${
          alerta ? 'sm:border-[3px] sm:border-[#B42318]' : tom === 'petroleo' ? 'sm:border-[3px] sm:border-[#0B5563]' : ''
        }`}>
        {alerta ? (
          <div className="flex shrink-0 items-center gap-3 bg-[#B42318] px-4 py-4 text-white sm:gap-4 sm:px-7 sm:py-6">
            <Ban className="h-10 w-10 shrink-0 sm:h-[52px] sm:w-[52px]" strokeWidth={2.2} aria-hidden />
            <h2 id={tituloId} className="text-[19px] font-bold uppercase sm:text-[24px] leading-[1.2] tracking-[0.01em]">{titulo}</h2>
          </div>
        ) : tituloOculto ? (
          // Sem título visível: o X flutua no canto, sem abrir uma faixa vazia em cima do conteúdo
          <>
            <h2 id={tituloId} className="sr-only">{titulo}</h2>
            {!semFechar && <BotaoFechar onClose={onClose} className="absolute right-2 top-2 z-10 sm:right-3 sm:top-3" />}
          </>
        ) : (
          <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-3 sm:px-7 sm:pt-5">
            <h2 id={tituloId} className="flex min-h-[44px] items-center text-[20px] font-semibold sm:min-h-[40px]">{titulo}</h2>
            {!semFechar && <BotaoFechar onClose={onClose} className="-mr-2" />}
          </div>
        )}
        <div className={`flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-7 ${alerta ? 'sm:py-6' : ''}`}>
          {children}
        </div>
        {rodape && (
          <div className="flex shrink-0 flex-wrap gap-[10px] border-t border-[#E6EAED] bg-white px-4 pt-3 sm:px-7 sm:pt-4 max-sm:[&>*]:grow"
            style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
            {rodape}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Gaveta lateral (detalhe do evento): 560px à direita, fundo escurecido, Esc fecha. */
export function Gaveta({ titulo, onClose, children, tituloId = 'gaveta-titulo' }: { titulo: ReactNode; onClose: () => void; children: ReactNode; tituloId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useArmadilhaDeFoco(ref, onClose);
  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-end bg-[rgba(12,22,28,0.45)]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={tituloId} tabIndex={-1}
        className="relative h-full w-[560px] max-w-full bg-white shadow-[-12px_0_40px_rgba(0,0,0,0.18)]">
        <BotaoFechar onClose={onClose} className="absolute right-2 top-2 z-10 sm:right-4 sm:top-4" />
        <div className="flex h-full flex-col gap-[18px] overflow-auto py-5 pl-4 pr-14 sm:py-6 sm:pl-7 sm:pr-16">
          <h2 id={tituloId} className="sr-only">{titulo}</h2>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
