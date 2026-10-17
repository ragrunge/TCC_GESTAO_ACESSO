import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApi } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Cel, CelUnidade, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ROTULO_CATEGORIA, type EventoView } from '@portaria/domain/types';
import { permanenciaExcedida } from '@portaria/domain/rules';
import { agora as agoraSim, fmtDataHora, fmtHora, fromInput, toInputDate } from '@portaria/domain/time';
import { mensagemErro, useAgora, useAsync } from '../../app/useAsync';
import { chipDoEvento, textoAutorizacao } from '../common/evento';

const COLUNAS = 'minmax(0,1.4fr) 110px 80px 80px 150px minmax(0,1.3fr) 290px';

export function PessoasDentroPage() {
  const api = useApi();
  const { avisar } = useToast();
  const agora = useAgora(15000);
  const podeRegistrar = useCan('evento.registrar');
  const podeRetroativo = useCan('evento.retroativo');
  const [retro, setRetro] = useState<EventoView | null>(null);
  const lista = useAsync(() => api.eventos.presentes(), []);

  async function saida(id: string, nome: string) {
    try {
      // A saída é um NOVO evento ligado à entrada; a entrada original não é alterada (RN-04)
      const ev = await api.eventos.registrarSaida(id);
      avisar({ texto: `Saída de ${nome} registrada às ${fmtHora(ev.ocorridoEm)} (${ev.codigo}, ligada à entrada ${ev.entradaCodigo}).` });
      void lista.recarregar();
    } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); }
  }

  const dados = lista.data ?? [];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Pessoas no condomínio"
        descricao={`${dados.length} ${dados.length === 1 ? 'pessoa entrou' : 'pessoas entraram'} e ainda não ${dados.length === 1 ? 'teve' : 'tiveram'} a saída registrada.`}
        acoes={podeRegistrar && <Link to="/entrada" className="inline-flex h-11 items-center gap-[10px] rounded-lg bg-[#0B5563] px-[18px] font-semibold !text-white hover:bg-[#08434E]">Nova entrada <kbd className="rounded-[5px] border border-white/50 px-[7px] py-0.5 font-mono text-[13px]">F2</kbd></Link>} />
      {lista.error && <Alert tom="vermelho" role="alert">{lista.error}</Alert>}
      <Lista legenda="Pessoas atualmente no condomínio" colunas={COLUNAS}>
        <ListaCab rotulos={['Nome', 'Tipo', 'Unidade', 'Entrada', 'Permanência', 'Autorizado por', '']} />
        {dados.map((e) => {
          const excedeu = permanenciaExcedida(e.ocorridoEm, agora);
          const min = Math.max(0, Math.floor((agora - e.ocorridoEm) / 60000));
          const dur = `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
          return (
            <ListaLinha key={e.id} destaque={excedeu ? 'ambar' : undefined} minH={56} padY={8}>
              <Cel className="truncate font-medium">{e.pessoaNome}</Cel>
              <Cel className="text-[14px]">{ROTULO_CATEGORIA[e.categoriaPessoa]}</Cel>
              <CelUnidade id={e.unidadeDestinoId} />
              <Cel className="font-mono">{fmtHora(e.ocorridoEm)}</Cel>
              <Cel className={`flex items-center gap-1.5 font-mono ${excedeu ? 'font-semibold text-[#93370D]' : ''}`}>
                {excedeu && <TriangleAlert className="h-4 w-4" strokeWidth={2.4} aria-hidden />}
                {dur}{excedeu && <span className="font-sans text-[12px]">acima de 8h</span>}
              </Cel>
              <Cel className="text-[14px]">{textoAutorizacao(e)}<span className="text-[#56616B]"> · {chipDoEvento(e).texto}</span></Cel>
              <Cel className="flex gap-2">{podeRegistrar && (
                <button type="button" onClick={() => void saida(e.id, e.pessoaNome)}
                  className="h-10 rounded-lg border border-[#B9C3CA] bg-white px-[14px] text-[14px] font-medium hover:border-[#0B5563] hover:text-[#0B5563]">Registrar saída</button>
              )}{podeRetroativo && (
                <button type="button" onClick={() => setRetro(e)}
                  className="h-10 rounded-lg border border-[#B9C3CA] bg-white px-[14px] text-[14px] font-medium hover:border-[#0B5563] hover:text-[#0B5563]">Saída retroativa</button>
              )}</Cel>
            </ListaLinha>
          );
        })}
        {!lista.loading && dados.length === 0 && <Vazio>Ninguém no condomínio no momento.</Vazio>}
      </Lista>
      {retro && <SaidaRetroativaModal entrada={retro} onClose={() => setRetro(null)}
        onFeito={(ev) => { setRetro(null); avisar({ texto: `Saída retroativa de ${retro.pessoaNome} registrada: hora real ${fmtDataHora(ev.ocorridoEm)} (${ev.codigo}).` }); void lista.recarregar(); }} />}
    </div>
  );
}

/** Contingência: a saída aconteceu antes e foi anotada no papel. Hora real >= entrada e < agora, mais o nº do formulário. */
function SaidaRetroativaModal({ entrada, onClose, onFeito }: { entrada: EventoView; onClose: () => void; onFeito: (ev: EventoView) => void }) {
  const api = useApi();
  const [data, setData] = useState(toInputDate(agoraSim()));
  const [hora, setHora] = useState('');
  const [formulario, setFormulario] = useState('');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const quando = hora ? fromInput(data, hora) : null;
  const dataOk = quando !== null && quando >= entrada.ocorridoEm && quando < agoraSim();
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!dataOk || quando === null) { setErro('Informe a hora real da saída: depois da entrada e antes do momento atual.'); return; }
    setSalvando(true); setErro('');
    try { onFeito(await api.eventos.registrarSaida(entrada.id, { retroativo: true, ocorridoEm: quando, formularioContingencia: formulario, observacao: obs })); }
    catch (err) { setErro(mensagemErro(err)); setSalvando(false); }
  }
  return (
    <Modal titulo={`Saída retroativa · ${entrada.pessoaNome}`} largura={560} gap={14} onClose={onClose}
      rodape={<><Button type="submit" form="f-saida-retro" variante="primario" grande className="flex-1" carregando={salvando}>Registrar saída retroativa</Button><Button grande onClick={onClose}>Cancelar</Button></>}>
      <p className="text-[14px] text-[#56616B]">Entrada em {fmtDataHora(entrada.ocorridoEm)} ({entrada.codigo}). A hora do lançamento é definida pelo sistema e gravada junto, com a etiqueta Retroativo.</p>
      <form id="f-saida-retro" onSubmit={salvar} className="grid grid-cols-2 gap-[14px]">
        <Field label="Data real da saída"><input type="date" className="input" value={data} min={toInputDate(entrada.ocorridoEm)} max={toInputDate(agoraSim())} onChange={(e) => setData(e.target.value)} /></Field>
        <Field label="Hora real da saída" erro={hora && !dataOk ? 'Depois da entrada e antes de agora.' : undefined}><input type="time" className="input" value={hora} onChange={(e) => setHora(e.target.value)} /></Field>
        <Field label="Nº do formulário de papel (obrigatório)" className="col-span-2"><input className="input" value={formulario} onChange={(e) => setFormulario(e.target.value)} /></Field>
        <Field label="Observação (opcional)" className="col-span-2"><input className="input" value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        {erro && <Alert tom="vermelho" role="alert" className="col-span-2">{erro}</Alert>}
      </form>
    </Modal>
  );
}
