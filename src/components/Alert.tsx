import type { ReactNode } from 'react';
import { AlertTriangle, Ban, Check, Info } from 'lucide-react';
import type { Tom } from './Badge';

const ESTILO: Record<Tom, string> = {
  vermelho: 'bg-[#FEE4E2] text-[#912018] border-[#FDA29B]',
  ambar: 'bg-[#FEF0C7] text-[#7A2E0E] border-[#FEC84B]',
  verde: 'bg-[#DCFAE6] text-[#05603A] border-[#75E0A7]',
  neutro: 'bg-[#EEF2F4] text-[#33424B] border-[#D5DDE2]',
  petroleo: 'bg-[#E3F0F2] text-[#0B4450] border-[#A9D2D8]',
};
const ICONE = { vermelho: Ban, ambar: AlertTriangle, verde: Check, neutro: Info, petroleo: Info };

/** Faixa de aviso do protótipo: 12/14px de respiro, raio 8px, borda na cor do tom. */
export function Alert({ tom = 'neutro', titulo, children, className = '', role, semIcone }: {
  tom?: Tom; titulo?: ReactNode; children?: ReactNode; className?: string; role?: 'alert' | 'status'; semIcone?: boolean;
}) {
  const Icone = ICONE[tom];
  return (
    <div role={role} className={`flex items-start gap-[10px] rounded-lg border px-[14px] py-3 ${ESTILO[tom]} ${className}`}>
      {!semIcone && <Icone className="mt-[2px] h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden />}
      <div className="min-w-0 flex-1">
        {titulo && <p className="text-[16px] font-semibold">{titulo}</p>}
        {children && <div className={`text-[14px] ${titulo ? 'mt-0.5' : ''}`}>{children}</div>}
      </div>
    </div>
  );
}
