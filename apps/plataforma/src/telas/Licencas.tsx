// "Licenças": um card por condomínio (docs/05_arquitetura_saas.md §6.2), busca por nome ou código e filtro por situação.
// Só cadastro da plataforma: nenhum dado pessoal de condomínio passa por aqui. Depois de criar um condomínio, a tela
// chega com `state.destaque` (o código dele): o card vem marcado e rolado para a vista.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROTULO_MODULO } from '@portaria/domain/modulos';
import { podePlataforma } from '@portaria/domain/rbac-plataforma';
import { CHAVE_CONDOMINIOS, type CondominioPlataforma, type Situacao } from '../api/plataforma';
import { Alert } from '../components/ui/alert';
import { Badge, type TomBadge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { NativeSelect } from '../components/ui/native-select';
import { cn } from '../lib/utils';
import { useSessao } from '../sessao/SessaoMaster';
import { ModulosModal } from './ModulosModal';

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  provisionando: 'Provisionando', ativo: 'Ativo', suspenso: 'Suspenso', encerrado: 'Encerrado', excluido: 'Excluído',
};
const TOM_SITUACAO: Record<Situacao, TomBadge> = { provisionando: 'ambar', ativo: 'verde', suspenso: 'ambar', encerrado: 'neutro', excluido: 'neutro' };

const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function Licencas() {
  const { api, estado } = useSessao();
  const papel = estado.fase === 'logado' ? estado.usuario.papel : 'suporte';
  const destaque = (useLocation().state as { destaque?: string } | null)?.destaque ?? null;
  const q = useQuery({ queryKey: CHAVE_CONDOMINIOS, queryFn: () => api.condominios() });
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<Situacao | ''>('');
  const [editando, setEditando] = useState<CondominioPlataforma | null>(null);
  const cardDestaque = useRef<HTMLLIElement>(null);

  const lista = useMemo(() => {
    const t = semAcento(busca.trim());
    return (q.data ?? []).filter((c) => (!situacao || c.situacao === situacao) && (!t || semAcento(c.nome).includes(t) || c.codigo.includes(t)));
  }, [q.data, busca, situacao]);
  const novo = destaque ? q.data?.find((c) => c.codigo === destaque) : undefined;

  useEffect(() => { if (novo) cardDestaque.current?.scrollIntoView?.({ block: 'center' }); }, [novo]);

  return (
    <section aria-labelledby="titulo-licencas" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="titulo-licencas" className="text-[24px] font-semibold">Licenças</h1>
          <p className="text-[14px] text-ink-suave">Condomínios cadastrados na plataforma.</p>
        </div>
        {podePlataforma(papel, 'condominio.criar') && <Button asChild variant="default"><Link to="/novo">Novo condomínio</Link></Button>}
      </div>
      {novo && <Alert variant="verde" role="status">{novo.nome} criado (código <span className="font-mono">{novo.codigo}</span>).</Alert>}
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <Field label="Buscar por nome ou código">
          <Input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </Field>
        <Field label="Situação">
          <NativeSelect value={situacao} onChange={(e) => setSituacao(e.target.value as Situacao | '')}>
            <option value="">Todas</option>
            {(Object.keys(ROTULO_SITUACAO) as Situacao[]).map((s) => <option key={s} value={s}>{ROTULO_SITUACAO[s]}</option>)}
          </NativeSelect>
        </Field>
      </div>
      {q.isPending && <p role="status">Carregando…</p>}
      {q.isError && <Alert variant="vermelho" role="alert">{(q.error as Error).message}</Alert>}
      {q.isSuccess && (
        <>
          <p role="status" className="text-[14px] text-ink-suave">{lista.length === 1 ? '1 condomínio' : `${lista.length} condomínios`}</p>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Condomínios">
            {lista.map((c) => {
              const eNovo = c.codigo === destaque;
              return (
                <li key={c.id} ref={eNovo ? cardDestaque : undefined} aria-labelledby={`cond-${c.id}`}>
                  <Card className={cn('flex h-full flex-col gap-3 p-5', eNovo && 'border-primary ring-2 ring-primary-borda')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 id={`cond-${c.id}`} className="text-[17px] font-semibold">{c.nome}</h2>
                        <p className="text-[14px] text-ink-suave">
                          Código <span className="font-mono">{c.codigo}</span>{c.cidade ? ` · ${c.cidade}/${c.uf}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant={TOM_SITUACAO[c.situacao]}>{ROTULO_SITUACAO[c.situacao]}</Badge>
                        {eNovo && <Badge variant="petroleo">Novo</Badge>}
                      </div>
                    </div>
                    <div>
                      <p className="text-[13px] font-medium text-ink-suave">Módulos ligados ({c.modulos.length})</p>
                      <p className="text-[14px]">{c.modulos.length ? c.modulos.map((m) => ROTULO_MODULO[m]).join(', ') : 'Nenhum (só o núcleo da portaria)'}</p>
                    </div>
                    {podePlataforma(papel, 'condominio.modulos') && c.situacao !== 'encerrado' && c.situacao !== 'excluido' && (
                      <Button variant="outline" onClick={() => setEditando(c)} aria-label={`Módulos de ${c.nome}`} className="mt-auto">Módulos</Button>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {editando && <ModulosModal condominio={editando} onClose={() => setEditando(null)} />}
    </section>
  );
}
