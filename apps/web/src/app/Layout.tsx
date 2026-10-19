import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ROTAS, pode, type Rota } from '@portaria/domain/rbac';
import { ROTULO_CATEGORIA, ROTULO_PAPEL } from '@portaria/domain/types';
import { partes } from '@portaria/domain/time';
import { temModalAberto } from '../components/Modal';
import { FichaPessoaModal } from '../features/cadastro/FichaPessoaModal';
import { useAgora } from './useAsync';
import { CHAVES, useBuscaGlobal, useContagemPendentes } from './consultas';
import { useCatalogo } from './catalogo';
import { useTituloPagina } from './titulo';

const DIAS_EXTENSO = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

const GRUPOS: { titulo: string; itens: { rota: Rota; rotulo: string; contador?: boolean }[] }[] = [
  { titulo: 'Portaria', itens: [
    { rota: 'painel', rotulo: 'Painel' },
    { rota: 'entrada', rotulo: 'Registrar entrada' },
    { rota: 'pessoas', rotulo: 'Pessoas no condomínio' },
    { rota: 'encomendas', rotulo: 'Encomendas' },
    { rota: 'ocorrencias', rotulo: 'Ocorrências' },
  ] },
  { titulo: 'Administração', itens: [
    { rota: 'unidades', rotulo: 'Unidades' },
    { rota: 'vinculos', rotulo: 'Vínculos pendentes', contador: true },
    { rota: 'cadastro', rotulo: 'Pessoas' },
    { rota: 'funcionarios', rotulo: 'Funcionários' },
    { rota: 'importar', rotulo: 'Importar planilha' },
  ] },
  { titulo: 'Auditoria', itens: [
    { rota: 'historico', rotulo: 'Histórico de acessos' },
    { rota: 'relatorios', rotulo: 'Relatórios' },
  ] },
  { titulo: 'Sistema', itens: [{ rota: 'usuarios', rotulo: 'Usuários' }] },
];

const ROTULO_ROTA = new Map(GRUPOS.flatMap((g) => g.itens.map((i) => [i.rota as string, i.rotulo])));

function Relogio() {
  const t = useAgora(5000);
  const p = partes(t);
  const d = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="text-right leading-[1.2]" aria-label="Horário do sistema">
      <div className="font-mono text-[19px] font-semibold">{d(p.hh)}:{d(p.mm)}</div>
      <div className="text-[12px] text-[#56616B]">{DIAS_EXTENSO[p.dow]}, {d(p.dia)}/{d(p.mes)}/{p.ano}</div>
    </div>
  );
}

function BuscaGlobal({ onPessoa }: { onPessoa: (id: string) => void }) {
  const nav = useNavigate();
  const { codigo } = useCatalogo();
  const [q, setQ] = useState('');
  const [aberto, setAberto] = useState(false);
  const busca = useBuscaGlobal(q);
  // Abaixo de 2 caracteres ou com erro, a lista some (o placeholder não pode mostrar o resultado anterior).
  const res = q.trim().length >= 2 && !busca.isError ? busca.data ?? null : null;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement;
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(alvo.tagName) && !temModalAberto()) { e.preventDefault(); inputRef.current?.focus(); }
    }
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, []);

  const vazio = res && res.pessoas.length === 0 && res.unidades.length === 0;
  const item = 'flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md bg-white px-[10px] py-[6px] text-left hover:bg-[#EEF2F4]';
  return (
    <div className="relative max-w-[520px] flex-1" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setAberto(false); }}>
      <label htmlFor="busca-global" className="sr-only">Buscar por nome, documento, unidade ou placa</label>
      <Search className="pointer-events-none absolute left-3 top-[11px] h-[18px] w-[18px] text-[#56616B]" strokeWidth={2} aria-hidden />
      <input id="busca-global" ref={inputRef} placeholder="Buscar por nome, documento, unidade ou placa" value={q}
        className="h-10 w-full rounded-lg border border-[#C5CDD3] bg-[#F3F5F6] pl-10 pr-3 text-[14.5px] text-ink placeholder:text-[#56616B]"
        autoComplete="off" onChange={(e) => { setQ(e.target.value); setAberto(true); }} onFocus={() => setAberto(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setAberto(false); setQ(''); } }} />
      {aberto && res && (
        <div className="absolute inset-x-0 top-[46px] z-40 flex max-h-96 flex-col gap-0.5 overflow-y-auto rounded-[10px] border border-[#DCE1E5] bg-white p-[6px] shadow-[0_12px_32px_rgba(16,38,44,0.16)]" role="listbox" aria-label="Resultados da busca">
          {vazio && <div className="px-[10px] py-3 text-[#56616B]">Nenhum resultado para “{q}”.</div>}
          {res.unidades.map((u, i) => (
            <button key={u.id + i} type="button" role="option" aria-selected={false} className={item}
              onClick={() => { setAberto(false); setQ(''); nav(`/unidades/${u.id}`); }}>
              <span className="flex flex-col"><span className="font-mono font-semibold">{codigo(u.id)}</span><span className="text-[13px] text-[#56616B]">{u.motivo}</span></span>
              <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#56616B]">Unidade</span>
            </button>
          ))}
          {res.pessoas.map((p) => (
            <button key={p.id} type="button" role="option" aria-selected={false} className={item}
              onClick={() => { setAberto(false); setQ(''); onPessoa(p.id); }}>
              <span className="flex min-w-0 flex-col"><span className="truncate font-medium">{p.nome}</span><span className="font-mono text-[13px] text-[#56616B]">{p.documentoMascarado}</span></span>
              <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#56616B]">{ROTULO_CATEGORIA[p.categoria]}</span>
            </button>
          ))}
          {res.temMaisPessoas && <div className="px-[10px] py-2 text-[13px] text-[#56616B]">Há mais pessoas com esse termo: continue digitando para refinar.</div>}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { usuario, sair } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const [fichaId, setFichaId] = useState<string | null>(null);
  const papel = usuario!.papel;
  useTituloPagina(ROTULO_ROTA.get(loc.pathname.split('/')[1]));

  const pend = useContagemPendentes(pode(papel, 'vinculo.decidir'));
  // Recontar a cada navegação (a decisão de um vínculo acontece em outra tela); a primeira carga já é do useQuery.
  const primeiraRota = useRef(true);
  useEffect(() => {
    if (primeiraRota.current) { primeiraRota.current = false; return; }
    void qc.invalidateQueries({ queryKey: CHAVES.vinculosPendentes });
  }, [loc.pathname, qc]);

  // Atalhos globais (RNF-07): F2 nova entrada, F3 encomenda, F4 ocorrência
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (temModalAberto()) return;
      if (e.key === 'F2' && pode(papel, 'evento.registrar')) { e.preventDefault(); nav('/entrada'); }
      else if (e.key === 'F3' && pode(papel, 'encomenda.operar')) { e.preventDefault(); nav('/encomendas?novo=1'); }
      else if (e.key === 'F4' && pode(papel, 'ocorrencia.operar')) { e.preventDefault(); nav('/ocorrencias?novo=1'); }
    }
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [papel, nav]);

  return (
    <div className="app-raiz grid h-screen grid-cols-[248px_minmax(0,1fr)]">
      <a href="#conteudo" className="sr-only z-50 rounded-lg bg-white px-4 py-2 font-semibold text-[#0B5563] shadow-cartao focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Pular para o conteúdo
      </a>
      <aside className="sobre-escuro flex flex-col gap-[18px] overflow-auto bg-[#10262C] px-3 py-5 text-[#C8D3D7]" aria-label="Menu principal">
        <div className="flex items-center gap-[10px] px-[10px] pb-2 pt-1">
          <div className="grid h-[34px] w-[34px] place-items-center rounded-lg bg-[#0B5563] text-[14px] font-bold text-white" aria-hidden>RP</div>
          <div className="leading-[1.2]">
            <div className="text-[14px] font-semibold text-white">Portaria Parque</div>
            <div className="text-[12px] text-[#9FB1B7]">Residencial do Parque</div>
          </div>
        </div>
        {GRUPOS.map((g) => {
          const itens = g.itens.filter((i) => ROTAS[i.rota].includes(papel));
          if (itens.length === 0) return null;
          return (
            <nav key={g.titulo} aria-label={g.titulo} className="flex flex-col gap-0.5">
              <div className="px-3 pb-[6px] pt-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#8DA2A9]">{g.titulo}</div>
              {itens.map((i) => (
                <NavLink key={i.rota} to={`/${i.rota}`}
                  className={({ isActive }) => `flex min-h-[40px] items-center justify-between gap-2 rounded-md border-l-[3px] py-0 pl-[10px] pr-3 text-[14.5px] hover:text-white ${
                    isActive ? 'border-[#6CCBD8] bg-[#1E4952] text-white' : 'border-transparent text-[#C8D3D7]'}`}>
                  <span>{i.rotulo}</span>
                  {i.contador && (pend.data ?? 0) > 0 && (
                    <span className="grid h-[22px] min-w-[22px] place-items-center rounded-full bg-[#F79009] px-[7px] text-[12px] font-bold text-[#1A1204]" aria-label={`${pend.data} pendentes`}>{pend.data}</span>
                  )}
                </NavLink>
              ))}
            </nav>
          );
        })}
        <div className="mt-auto px-3 text-[12px] leading-[1.5] text-[#8DA2A9]">Projeto acadêmico · TCC</div>
      </aside>

      <div className="flex h-screen min-w-0 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-6 border-b border-[#DCE1E5] bg-white px-6">
          <div className="whitespace-nowrap font-semibold">Condomínio Residencial do Parque</div>
          <BuscaGlobal onPessoa={setFichaId} />
          <div className="ml-auto flex items-center gap-5">
            <Relogio />
            <div className="h-8 w-px bg-[#DCE1E5]" />
            <div className="leading-tight">
              <div className="font-semibold">{usuario!.nome}</div>
              <div className="text-[13px] text-[#56616B]">{ROTULO_PAPEL[papel]}</div>
            </div>
            <button type="button" onClick={() => { void sair().then(() => nav('/login')); }}
              className="h-10 rounded-lg border border-[#C5CDD3] bg-white px-[14px] text-[14px] hover:bg-[#EEF2F4]">
              Sair
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto px-8 pb-14 pt-7 focus:outline-none" id="conteudo" tabIndex={-1}><Outlet /></main>
      </div>
      {fichaId && <FichaPessoaModal id={fichaId} onClose={() => setFichaId(null)} />}
    </div>
  );
}
