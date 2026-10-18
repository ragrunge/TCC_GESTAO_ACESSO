import { useEffect, useState } from 'react';
import { useApi, type PessoaBusca } from '../api';
import { ROTULO_CATEGORIA } from '@portaria/domain/types';
import { Button } from './Button';
import { Field } from './Field';
import { Avatar } from './UnitTag';

/** Busca e escolha de uma pessoa (nome, documento, unidade ou placa). */
export function PessoaPicker({ rotulo, valor, onChange, semMoradores, autoFocus }: {
  rotulo: string; valor: PessoaBusca | null; onChange: (p: PessoaBusca | null) => void; semMoradores?: boolean; autoFocus?: boolean;
}) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [achados, setAchados] = useState<PessoaBusca[]>([]);

  useEffect(() => {
    if (q.trim().length < 2) { setAchados([]); return; }
    let vivo = true;
    const t = setTimeout(() => { api.pessoas.buscar(q, { semMoradores }).then((r) => vivo && setAchados(r)).catch(() => undefined); }, 150);
    return () => { vivo = false; clearTimeout(t); };
  }, [q, api, semMoradores]);

  if (valor) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="text-[14px] font-medium">{rotulo}</div>
        <div className="flex items-center gap-[14px] rounded-lg border border-[#A9D2D8] bg-[#F0F8F9] px-[14px] py-[10px]">
          <Avatar nome={valor.nome} tamanho={44} />
          <span className="flex min-w-0 flex-1 flex-col"><span className="truncate text-[16px] font-semibold">{valor.nome}</span>
            <span className="text-[14px] text-[#33424B]"><span className="font-mono">{valor.documentoMascarado}</span> · {ROTULO_CATEGORIA[valor.categoria]}</span></span>
          <Button pequeno aria-label="Trocar pessoa" onClick={() => onChange(null)}>Trocar</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Field label={rotulo}><input {...(autoFocus ? { 'data-autofocus': true } : {})} className="input" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" placeholder="Nome, documento ou unidade" /></Field>
      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto empty:hidden">
        {achados.map((p) => (
          <li key={p.id}><button type="button" className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-[#E1E6EA] bg-white px-3 py-1.5 text-left hover:bg-[#EEF5F6]" onClick={() => { onChange(p); setQ(''); }}>
            <Avatar nome={p.nome} /><span className="flex-1 font-medium">{p.nome}</span>
            <span className="font-mono text-[14px] text-[#33424B]">{p.documentoMascarado}</span>
            <span className="text-[14px] text-[#56616B]">{ROTULO_CATEGORIA[p.categoria]}</span>
          </button></li>
        ))}
      </ul>
    </div>
  );
}
