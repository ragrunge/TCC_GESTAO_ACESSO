// Componentes visuais do app do Master, copiados (simplificados) do apps/web/src/components: mesmo visual, sem importar
// nada do outro app.
import {
  cloneElement, forwardRef, isValidElement, useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactElement, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Ban, Check, Info, Loader2 } from 'lucide-react';

type Variante = 'primario' | 'secundario' | 'contorno' | 'fantasma';
const ESTILO_BOTAO: Record<Variante, string> = {
  primario: 'border border-transparent bg-[#0B5563] text-white font-semibold hover:bg-[#08434E]',
  secundario: 'border border-[#B9C3CA] bg-white text-ink font-medium hover:bg-[#EEF2F4]',
  contorno: 'border border-[#0B5563] bg-white text-[#0B5563] font-semibold hover:bg-[#E3F0F2]',
  fantasma: 'border border-transparent bg-transparent text-[#0B5563] font-semibold hover:bg-[#E3F0F2]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; carregando?: boolean }>(
  function Button({ variante = 'secundario', carregando, className = '', children, disabled, type = 'button', ...resto }, ref) {
    const bloqueado = disabled || carregando;
    return (
      <button ref={ref} type={type} disabled={bloqueado} aria-busy={carregando || undefined}
        className={`inline-flex h-[44px] items-center justify-center gap-[10px] rounded-lg px-[18px] text-[15px] transition-colors disabled:cursor-not-allowed ${
          bloqueado ? 'border border-[#D5DDE2] bg-[#EEF2F4] font-semibold text-[#6B7780]' : ESTILO_BOTAO[variante]} ${className}`}
        {...resto}>
        {carregando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);

/** Campo com rótulo visível ligado ao controle; dica/erro ligados por aria-describedby. */
export function Field({ label, children, dica, erro, className = '' }: {
  label: ReactNode; children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>; dica?: ReactNode; erro?: ReactNode; className?: string;
}) {
  const id = useId();
  const dicaId = `${id}-d`;
  const filho = isValidElement(children)
    ? cloneElement(children, { id, 'aria-describedby': dica || erro ? dicaId : undefined, 'aria-invalid': erro ? true : undefined })
    : children;
  return (
    <div className={`flex flex-col gap-[6px] ${className}`}>
      <label htmlFor={id} className="text-[14px] font-medium">{label}</label>
      {filho}
      {(dica || erro) && <p id={dicaId} className={`text-[13px] ${erro ? 'font-medium text-[#B42318]' : 'text-[#56616B]'}`}>{erro ?? dica}</p>}
    </div>
  );
}

export type Tom = 'vermelho' | 'ambar' | 'verde' | 'neutro' | 'petroleo';
const ESTILO_ALERTA: Record<Tom, string> = {
  vermelho: 'bg-[#FEE4E2] text-[#912018] border-[#FDA29B]',
  ambar: 'bg-[#FEF0C7] text-[#7A2E0E] border-[#FEC84B]',
  verde: 'bg-[#DCFAE6] text-[#05603A] border-[#75E0A7]',
  neutro: 'bg-[#EEF2F4] text-[#33424B] border-[#D5DDE2]',
  petroleo: 'bg-[#E3F0F2] text-[#0B4450] border-[#A9D2D8]',
};
const ICONE_ALERTA = { vermelho: Ban, ambar: AlertTriangle, verde: Check, neutro: Info, petroleo: Info };

export function Alert({ tom = 'neutro', titulo, children, role, className = '' }: { tom?: Tom; titulo?: ReactNode; children?: ReactNode; role?: 'alert' | 'status'; className?: string }) {
  const Icone = ICONE_ALERTA[tom];
  return (
    <div role={role} className={`flex items-start gap-[10px] rounded-lg border px-[14px] py-3 ${ESTILO_ALERTA[tom]} ${className}`}>
      <Icone className="mt-[2px] h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden />
      <div className="min-w-0 flex-1">
        {titulo && <p className="text-[16px] font-semibold">{titulo}</p>}
        {children && <div className={`text-[14px] ${titulo ? 'mt-0.5' : ''}`}>{children}</div>}
      </div>
    </div>
  );
}

const ESTILO_BADGE: Record<Tom, string> = {
  vermelho: 'bg-[#FEE4E2] text-[#912018] border-[#FDA29B]', ambar: 'bg-[#FEF0C7] text-[#7A2E0E] border-[#FEC84B]',
  verde: 'bg-[#DCFAE6] text-[#05603A] border-[#75E0A7]', neutro: 'bg-[#EEF2F4] text-[#33424B] border-[#D5DDE2]',
  petroleo: 'bg-[#E3F0F2] text-[#0B4450] border-[#A9D2D8]',
};
export function Badge({ tom = 'neutro', children }: { tom?: Tom; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-[10px] py-[2px] text-[13px] font-semibold ${ESTILO_BADGE[tom]}`}>{children}</span>;
}

const FOCAVEIS = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Modal acessível: role=dialog, foco preso, Esc fecha, foco devolvido ao fechar. `data-autofocus` escolhe o foco inicial. */
export function Modal({ titulo, onClose, children, rodape, largura = 560, tituloId = 'modal-titulo' }: {
  titulo: ReactNode; onClose: () => void; children: ReactNode; rodape?: ReactNode; largura?: number; tituloId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fechar = useRef(onClose);
  fechar.current = onClose;
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCAVEIS) ?? el).focus();
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar.current(); return; }
      if (e.key !== 'Tab') return;
      const itens = Array.from(el.querySelectorAll<HTMLElement>(FOCAVEIS));
      if (!itens.length) { e.preventDefault(); return; }
      const primeiro = itens[0]!, ultimo = itens[itens.length - 1]!;
      if (e.shiftKey && (document.activeElement === primeiro || !el.contains(document.activeElement))) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && (document.activeElement === ultimo || !el.contains(document.activeElement))) { e.preventDefault(); primeiro.focus(); }
    }
    document.addEventListener('keydown', tecla, true);
    return () => { document.removeEventListener('keydown', tecla, true); anterior?.focus?.(); };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(12,22,28,0.58)] p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={tituloId} tabIndex={-1}
        style={{ width: `min(${largura}px, calc(100vw - 32px))` }}
        className="flex max-h-[calc(100vh-32px)] flex-col overflow-hidden rounded-xl bg-white shadow-[0_24px_64px_rgba(0,0,0,0.3)]">
        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          <h2 id={tituloId} className="text-[20px] font-semibold">{titulo}</h2>
          {children}
          {rodape && <div className="mt-1 flex flex-wrap gap-[10px]">{rodape}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
