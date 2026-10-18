import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Tom } from './Badge';

interface ToastItem { id: number; tom: Tom; titulo?: string; texto: string }
interface Ctx { avisar: (t: { tom?: Tom; titulo?: string; texto: string; duracao?: number }) => void }
const ToastCtx = createContext<Ctx | null>(null);

// Barra lateral colorida: verde (ok), âmbar (atenção), vermelho (erro)
const BARRA: Record<Tom, string> = { verde: '#32D583', ambar: '#FDB022', vermelho: '#F97066', neutro: '#6CCBD8', petroleo: '#6CCBD8' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<ToastItem[]>([]);
  const remover = useCallback((id: number) => setItens((x) => x.filter((t) => t.id !== id)), []);
  const avisar = useCallback<Ctx['avisar']>(({ tom = 'verde', titulo, texto, duracao = 7000 }) => {
    const id = Date.now() + Math.random();
    setItens((x) => [...x.slice(-3), { id, tom, titulo, texto }]);
    setTimeout(() => remover(id), duracao);
  }, [remover]);
  const valor = useMemo(() => ({ avisar }), [avisar]);
  return (
    <ToastCtx.Provider value={valor}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[80] flex w-[620px] max-w-[calc(100vw-48px)] flex-col items-end gap-2" role="region" aria-label="Notificações">
        {itens.map((t) => (
          <div key={t.id} role={t.tom === 'vermelho' ? 'alert' : 'status'} style={{ borderLeftColor: BARRA[t.tom] }}
            className="pointer-events-auto flex max-w-full items-start gap-3 rounded-[10px] border-l-[5px] bg-[#10262C] px-[18px] py-[14px] text-white shadow-[0_12px_32px_rgba(0,0,0,0.25)]">
            <div className="min-w-0 flex-1 text-[15px] leading-[1.45]">
              {t.titulo && <p className="font-semibold">{t.titulo}</p>}
              <p>{t.texto}</p>
            </div>
            <button type="button" onClick={() => remover(t.id)} aria-label="Fechar" className="px-0.5 text-[18px] leading-none text-[#C8D3D7] hover:text-white">×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): Ctx {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('useToast fora de <ToastProvider>');
  return c;
}
