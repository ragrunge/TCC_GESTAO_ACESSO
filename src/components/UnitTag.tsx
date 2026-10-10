import { rotuloUnidade } from '../domain/units';

/** Torre/unidade em destaque, em fonte mono: "TORRE 4 · AP 32". */
export function UnitTag({ id, tamanho = 'md', className = '' }: { id: string; tamanho?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const t = { sm: 'text-[14px]', md: 'text-[22px] text-[#0B3F49]', lg: 'text-[28px] text-[#0B3F49]', xl: 'text-[34px] tracking-[0.02em] text-[#0B3F49]' }[tamanho];
  return <span className={`font-mono font-semibold ${t} ${className}`}>{rotuloUnidade(id)}</span>;
}

export function Avatar({ nome, className = '', tamanho = 40 }: { nome: string; className?: string; tamanho?: 40 | 44 }) {
  const ini = nome.replace(/[—(].*$/, '').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span aria-hidden style={{ width: tamanho, height: tamanho }}
      className={`grid shrink-0 place-items-center rounded-full bg-[#D5E6E9] text-[14px] font-bold text-[#0B4450] ${className}`}>
      {ini}
    </span>
  );
}
