import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Ban } from 'lucide-react';
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
    (auto ?? el.querySelector<HTMLElement>(FOCAVEIS) ?? el).focus();

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

/**
 * Modal acessível (role=dialog, aria-modal). Visual do protótipo: cartão branco, raio 12px, padding 24/28,
 * título 20px/600, sem barra de título nem rodapé separado. `tom="vermelho"` = alerta de restrição
 * (borda e cabeçalho vermelhos, título em caixa alta); `tom="petroleo"` = confirmação com borda petróleo.
 */
export function Modal({ titulo, onClose, children, rodape, tom = 'neutro', largura = 560, tituloId = 'modal-titulo', tituloOculto, gap = 16, role }: {
  titulo: ReactNode; onClose: () => void; children: ReactNode; rodape?: ReactNode; tom?: Tom; largura?: number; tituloId?: string;
  tituloOculto?: boolean; gap?: 14 | 16 | 18; role?: 'dialog' | 'alertdialog';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useArmadilhaDeFoco(ref, onClose);
  const alerta = tom === 'vermelho';
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,22,28,0.58)] p-4 sm:p-6">
      <div ref={ref} role={role ?? (alerta ? 'alertdialog' : 'dialog')} aria-modal="true" aria-labelledby={tituloId} tabIndex={-1}
        style={{ width: `min(${largura}px, calc(100vw - 32px))` }}
        className={`flex max-h-[calc(100vh-32px)] max-h-[calc(100dvh-32px)] max-w-full flex-col overflow-hidden rounded-xl bg-white shadow-[0_24px_64px_rgba(0,0,0,0.3)] ${
          alerta ? 'border-[3px] border-[#B42318]' : tom === 'petroleo' ? 'border-[3px] border-[#0B5563]' : ''
        }`}>
        {alerta && (
          <div className="flex items-center gap-3 bg-[#B42318] px-4 py-4 text-white sm:gap-4 sm:px-7 sm:py-6">
            <Ban className="h-10 w-10 shrink-0 sm:h-[52px] sm:w-[52px]" strokeWidth={2.2} aria-hidden />
            <h2 id={tituloId} className="text-[19px] font-bold uppercase sm:text-[24px] leading-[1.2] tracking-[0.01em]">{titulo}</h2>
          </div>
        )}
        <div style={{ gap }} className={`flex flex-col overflow-y-auto ${alerta ? 'px-4 py-5 sm:px-7 sm:py-6' : tom === 'petroleo' ? 'p-5 sm:p-8' : 'px-4 py-5 sm:px-7 sm:py-6'}`}>
          {!alerta && <h2 id={tituloId} className={tituloOculto ? 'sr-only' : 'text-[20px] font-semibold'}>{titulo}</h2>}
          {children}
          {rodape && <div className="mt-1 flex flex-wrap gap-[10px]">{rodape}</div>}
        </div>
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
        className="flex h-full w-[560px] max-w-full flex-col gap-[18px] overflow-auto bg-white px-4 py-5 sm:px-7 sm:py-6 shadow-[-12px_0_40px_rgba(0,0,0,0.18)]">
        <h2 id={tituloId} className="sr-only">{titulo}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
