import { useEffect, useState } from 'react';
import { useApi, type PessoaBusca } from '../api';
import { ROTULO_CATEGORIA } from '@portaria/domain/types';
import { Button } from './Button';
import { Field } from './Field';
import { Avatar } from './UnitTag';
import { Alert } from './Alert';
import { mensagemErro } from '../app/useAsync';

/** Busca e escolha de uma pessoa (nome, documento, unidade ou placa). */
export function PessoaPicker({ rotulo, valor, onChange, semMoradores, autoFocus, onCadastrar }: {
  rotulo: string; valor: PessoaBusca | null; onChange: (p: PessoaBusca | null) => void; semMoradores?: boolean; autoFocus?: boolean;
  /** Quando informado, oferece "Cadastrar nova pessoa" (quem usa decide pela permissão). Recebe o texto buscado. */
  onCadastrar?: (texto: string) => void;
}) {
  const api = useApi();
  const [q, setQ] = useState('');
  const [achados, setAchados] = useState<PessoaBusca[]>([]);
  const [buscou, setBuscou] = useState(false);
  const [erroBusca, setErroBusca] = useState('');

  useEffect(() => {
    setErroBusca('');
    if (q.trim().length < 2) { setAchados([]); setBuscou(false); return; }
    let vivo = true;
    setBuscou(false);
    const t = setTimeout(() => {
      api.pessoas.buscar(q, { semMoradores })
        .then((r) => { if (vivo) { setAchados(r); setBuscou(true); } })
        .catch((e) => { if (vivo) { setAchados([]); setErroBusca(mensagemErro(e)); } });
    }, 150);
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
      {erroBusca && <Alert tom="vermelho" role="alert">Não foi possível buscar: {erroBusca}</Alert>}
      {buscou && achados.length === 0 && !erroBusca && <p className="text-[14px] text-[#56616B]" role="status">Nenhuma pessoa encontrada.</p>}
      {onCadastrar && q.trim().length >= 2 && (
        <div><Button pequeno onClick={() => onCadastrar(q.trim())}>Cadastrar nova pessoa</Button></div>
      )}
    </div>
  );
}
