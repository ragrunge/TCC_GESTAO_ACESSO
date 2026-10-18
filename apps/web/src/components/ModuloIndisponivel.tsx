import { Info } from 'lucide-react';

/** Modo http: tela de módulo que a API real ainda não tem. Estado vazio, sem chamadas nem erro em loop. */
export function ModuloIndisponivel() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-[#B9C3CA] bg-white px-8 py-10">
      <div className="flex items-center gap-[10px] text-[#0B4450]">
        <Info className="h-6 w-6 shrink-0" strokeWidth={2} aria-hidden />
        <h1 className="text-[20px] font-semibold">Disponível em breve na API real</h1>
      </div>
      <p className="max-w-[640px] text-[15px] leading-[1.55] text-[#33424B]">
        Este módulo ainda não foi implementado no servidor. Para ver a tela funcionando, use o modo demonstração.
      </p>
    </div>
  );
}
