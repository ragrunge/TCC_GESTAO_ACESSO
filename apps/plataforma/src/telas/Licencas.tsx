// "Licenças": um card por condomínio (docs/05_arquitetura_saas.md §6.2), busca por nome ou código e filtro por situação.
// Só cadastro da plataforma: nenhum dado pessoal de condomínio passa por aqui.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROTULO_MODULO } from '@portaria/domain/modulos';
import { podePlataforma } from '@portaria/domain/rbac-plataforma';
import { CHAVE_CONDOMINIOS, type CondominioPlataforma, type Situacao } from '../api/plataforma';
import { useSessao } from '../sessao/SessaoMaster';
import { Alert, Badge, Button, Field, type Tom } from '../ui/ui';
import { ModulosModal } from './ModulosModal';

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  provisionando: 'Provisionando', ativo: 'Ativo', suspenso: 'Suspenso', encerrado: 'Encerrado', excluido: 'Excluído',
};
const TOM_SITUACAO: Record<Situacao, Tom> = { provisionando: 'ambar', ativo: 'verde', suspenso: 'ambar', encerrado: 'neutro', excluido: 'neutro' };

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function Licencas() {
  const { api, estado } = useSessao();
  const papel = estado.fase === 'logado' ? estado.usuario.papel : 'suporte';
  const q = useQuery({ queryKey: CHAVE_CONDOMINIOS, queryFn: () => api.condominios() });
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<Situacao | ''>('');
  const [editando, setEditando] = useState<CondominioPlataforma | null>(null);

  const lista = useMemo(() => {
    const t = semAcento(busca.trim());
    return (q.data ?? []).filter((c) => (!situacao || c.situacao === situacao) && (!t || semAcento(c.nome).includes(t) || c.codigo.includes(t)));
  }, [q.data, busca, situacao]);

  return (
    <section aria-labelledby="titulo-licencas" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="titulo-licencas" className="text-[24px] font-semibold">Licenças</h1>
          <p className="text-[14px] text-ink-suave">Condomínios cadastrados na plataforma.</p>
        </div>
        {podePlataforma(papel, 'condominio.criar') && <Link to="/novo" className="inline-flex h-[44px] items-center rounded-lg bg-[#0B5563] px-[18px] text-[15px] font-semibold text-white no-underline hover:bg-[#08434E]">Novo condomínio</Link>}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <Field label="Buscar por nome ou código">
          <input className="input" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </Field>
        <Field label="Situação">
          <select className="input" value={situacao} onChange={(e) => setSituacao(e.target.value as Situacao | '')}>
            <option value="">Todas</option>
            {(Object.keys(ROTULO_SITUACAO) as Situacao[]).map((s) => <option key={s} value={s}>{ROTULO_SITUACAO[s]}</option>)}
          </select>
        </Field>
      </div>
      {q.isPending && <p role="status">Carregando…</p>}
      {q.isError && <Alert tom="vermelho" role="alert">{(q.error as Error).message}</Alert>}
      {q.isSuccess && (
        <>
          <p role="status" className="text-[14px] text-ink-suave">{lista.length === 1 ? '1 condomínio' : `${lista.length} condomínios`}</p>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Condomínios">
            {lista.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 rounded-xl border border-linha bg-white p-5 shadow-cartao" aria-labelledby={`cond-${c.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 id={`cond-${c.id}`} className="text-[17px] font-semibold">{c.nome}</h2>
                    <p className="text-[14px] text-ink-suave">
                      Código <span className="font-mono">{c.codigo}</span>{c.cidade ? ` · ${c.cidade}/${c.uf}` : ''}
                    </p>
                  </div>
                  <Badge tom={TOM_SITUACAO[c.situacao]}>{ROTULO_SITUACAO[c.situacao]}</Badge>
                </div>
                <div>
                  <p className="text-[13px] font-medium text-ink-suave">Módulos ligados ({c.modulos.length})</p>
                  <p className="text-[14px]">{c.modulos.length ? c.modulos.map((m) => ROTULO_MODULO[m]).join(', ') : 'Nenhum (só o núcleo da portaria)'}</p>
                </div>
                {podePlataforma(papel, 'condominio.modulos') && c.situacao !== 'encerrado' && c.situacao !== 'excluido' && (
                  <Button variante="contorno" onClick={() => setEditando(c)} aria-label={`Módulos de ${c.nome}`}>Módulos</Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {editando && <ModulosModal condominio={editando} onClose={() => setEditando(null)} />}
    </section>
  );
}
