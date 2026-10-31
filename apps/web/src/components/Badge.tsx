import type { ReactNode } from 'react';
import { Ban, Check, Clock, History, X, type LucideIcon } from 'lucide-react';

export type Tom = 'vermelho' | 'ambar' | 'verde' | 'neutro' | 'petroleo';
export const ESTILO_TOM: Record<Tom, string> = {
  vermelho: 'bg-[#FEE4E2] text-[#B42318] border-[#FDA29B]',
  ambar: 'bg-[#FEF0C7] text-[#93370D] border-[#FEC84B]',
  verde: 'bg-[#DCFAE6] text-[#05603A] border-[#75E0A7]',
  neutro: 'bg-[#EEF2F4] text-[#33424B] border-[#D5DDE2]',
  petroleo: 'bg-[#E3F0F2] text-[#0B4450] border-[#A9D2D8]',
};

const TAMANHO = {
  md: 'h-[26px] px-2 rounded-md text-[13px]',
  sm: 'h-[24px] px-[7px] rounded-md text-[12px]',
  xs: 'h-[22px] px-[7px] rounded-[5px] text-[12px]',
};

/** Selo retangular do protótipo. O texto sempre acompanha a cor; ícone só quando pedido (exceção, negado, atraso). */
export function Badge({ tom = 'neutro', children, icone: Icone, tamanho = 'md', className = '' }: {
  tom?: Tom; children: ReactNode; icone?: LucideIcon; tamanho?: keyof typeof TAMANHO; semIcone?: boolean; className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-[5px] whitespace-nowrap border font-semibold ${TAMANHO[tamanho]} ${ESTILO_TOM[tom]} ${className}`}>
      {Icone && <Icone className="h-[14px] w-[14px]" strokeWidth={2.4} aria-hidden />}
      {children}
    </span>
  );
}

import type { StatusVinculo, StatusOcorrencia } from '@portaria/domain/types';
export function SeloVinculo({ status, tamanho }: { status: StatusVinculo; tamanho?: keyof typeof TAMANHO }) {
  // Com ícone: o status aparece em listas longas, e a forma ajuda quem não distingue âmbar de verde
  const m: Record<StatusVinculo, [Tom, string, LucideIcon]> = {
    aprovado: ['verde', 'Aprovado', Check], pendente: ['ambar', 'Pendente', Clock], legado: ['petroleo', 'Legado', History],
    rejeitado: ['vermelho', 'Rejeitado', X], encerrado: ['neutro', 'Encerrado', Ban],
  };
  const [tom, texto, icone] = m[status];
  return <Badge tom={tom} tamanho={tamanho} icone={icone}>{texto}</Badge>;
}
export function SeloOcorrencia({ status }: { status: StatusOcorrencia }) {
  const m: Record<StatusOcorrencia, [Tom, string]> = { aberta: ['ambar', 'Aberta'], em_andamento: ['ambar', 'Em andamento'], encerrada: ['verde', 'Encerrada'] };
  const [tom, texto] = m[status];
  return <Badge tom={tom}>{texto}</Badge>;
}
