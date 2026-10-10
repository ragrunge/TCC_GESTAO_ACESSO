import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Check } from 'lucide-react';
import { useApi, type AutorizacaoView, type PessoaBusca, type RestricaoView } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Badge, SeloVinculo } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { PessoaPicker } from '../../components/PessoaPicker';
import { useToast } from '../../components/Toast';
import { ROTULO_VINCULO, type EventoView, type TipoVinculo } from '../../domain/types';
import { descreverJanela } from '../../domain/rules';
import { DIAS_SEMANA_ABREV, fmtData, fromInput, toInputDate, agora } from '../../domain/time';
import { unidadeExiste } from '../../domain/units';
import { mensagemErro, useAsync } from '../../app/useAsync';
import { chipDoEvento, quandoCurto, textoAutorizacao } from '../common/evento';
import { EventoGaveta } from '../historico/EventoGaveta';

type Modo = null | 'vinculo' | 'previa' | 'restricao' | 'veiculo';

/** Detalhe da unidade (coluna direita do mestre-detalhe de Unidades). */
export function UnidadeDetalhe({ id }: { id: string }) {
  const api = useApi();
  const { avisar } = useToast();
  const [modo, setModo] = useState<Modo>(null);
  const [evento, setEvento] = useState<EventoView | null>(null);
  const podeVinculo = useCan('vinculo.criar');
  const podePrevia = useCan('autorizacao.criar');
  const podeRestricao = useCan('restricao.criar');
  const podeRevogar = useCan('unidade.editar');
  const podeVeiculo = useCan('veiculo.cadastrar');
  const det = useAsync(() => (unidadeExiste(id) ? api.unidades.detalhe(id) : Promise.reject(new Error('Unidade inexistente.'))), [id]);

  if (det.error) return <Alert tom="vermelho" role="alert">{det.error} <Link className="underline" to="/unidades">Voltar às unidades</Link></Alert>;
  const d = det.data;
  const feito = (texto: string) => { setModo(null); avisar({ texto }); void det.recarregar(); };

  async function revogarPrevia(a: AutorizacaoView) {
    try { await api.autorizacoes.revogar(a.id); avisar({ texto: 'Autorização prévia revogada.' }); void det.recarregar(); } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); }
  }
  async function revogarRestricao(r: RestricaoView) {
    try { await api.restricoes.revogar(r.id); avisar({ texto: 'Restrição revogada.' }); void det.recarregar(); } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); }
  }

  const cartao = 'flex flex-col gap-[10px] rounded-[10px] border border-[#DCE1E5] bg-white px-[18px] py-[14px]';
  const vazio = 'text-[14px] text-[#56616B]';
  const link = 'text-[13px] font-semibold text-[#0B5563] hover:underline';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[30px] font-semibold">Torre {d?.unidade.torre} · Apartamento {d?.unidade.numero}</h1>
        <div className="flex flex-wrap gap-2">
          {podePrevia && <Button variante="primario" onClick={() => setModo('previa')}>Nova autorização prévia</Button>}
          {podeRestricao && <Button onClick={() => setModo('restricao')}>Nova restrição</Button>}
          {podeVinculo && <Button onClick={() => setModo('vinculo')}>Solicitar vínculo</Button>}
        </div>
      </div>

      {d && (
        <>
          <section className="rounded-[10px] border border-[#DCE1E5] bg-white">
            <h2 className="border-b border-[#E6EAED] px-5 py-[14px] text-[16px] font-semibold">Moradores</h2>
            {d.vinculos.map((v) => (
              <div key={v.id} className="grid min-h-[52px] grid-cols-[minmax(0,1fr)_220px_120px] items-center gap-3 border-b border-[#EEF1F3] px-5 py-[10px] last:border-b-0">
                <span className="truncate font-medium">{v.pessoaNome}</span>
                <span className="truncate text-[14px]">{ROTULO_VINCULO[v.tipo]}
                  {v.status === 'legado' && v.prazoRegularizacao ? <span className="text-[#56616B]"> · regularizar até {fmtData(v.prazoRegularizacao)}</span>
                    : v.vigenciaFim ? <span className="text-[#56616B]"> · até {fmtData(v.vigenciaFim)}</span> : null}</span>
                <SeloVinculo status={v.status} />
              </div>
            ))}
            {d.vinculos.length === 0 && <div className="px-5 py-4 text-[#56616B]">Nenhum vínculo cadastrado.</div>}
          </section>

          <div className="grid grid-cols-3 gap-4">
            <section className={cartao}>
              <div className="flex items-center justify-between gap-2"><h2 className="text-[16px] font-semibold">Veículos</h2>
                {podeVeiculo && <button type="button" className={link} onClick={() => setModo('veiculo')}>+ Novo</button>}</div>
              {d.veiculos.map((v) => (
                <div key={v.id} className="flex flex-col"><span className="font-mono text-[17px] font-semibold">{v.placa}</span><span className="text-[14px] text-[#56616B]">{v.modelo} · {v.cor}</span></div>
              ))}
              {d.veiculos.length === 0 && <span className={vazio}>Nenhum veículo cadastrado.</span>}
            </section>

            <section className={cartao}>
              <h2 className="text-[16px] font-semibold">Autorizações prévias ativas</h2>
              {d.autorizacoes.map((a) => (
                <div key={a.id} className="flex items-start gap-2">
                  <Check className="mt-[3px] h-4 w-4 shrink-0 text-[#05603A]" strokeWidth={2.6} aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{a.pessoaNome}</span>
                    <span className="text-[13px] text-[#56616B]">Até {fmtData(a.validaAte)} · {descreverJanela(a)} · por {a.solicitadaPorNome}</span>
                    {a.estado !== 'valida' && <span className="mt-0.5 self-start"><Badge tom="ambar" tamanho="xs">Fora da janela agora</Badge></span>}
                  </div>
                  {podePrevia && <button type="button" className={link} aria-label={`Revogar autorização de ${a.pessoaNome}`} onClick={() => void revogarPrevia(a)}>Revogar</button>}
                </div>
              ))}
              {d.autorizacoes.length === 0 && <span className={vazio}>Nenhuma autorização ativa.</span>}
            </section>

            <section className={cartao}>
              <h2 className="text-[16px] font-semibold">Restrições</h2>
              {d.restricoes.map((r) => (
                <div key={r.id} className="flex items-start gap-2 text-[#B42318]">
                  <Ban className="mt-[3px] h-4 w-4 shrink-0" strokeWidth={2.4} aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">{r.pessoaNome}</span>
                    <span className="text-[13px] text-[#912018]">“{r.motivo}”</span>
                    <span className="text-[13px] text-[#56616B]">Solicitada por {r.solicitadaPorNome} · {fmtData(r.cadastradaEm)}</span>
                    {(r.pendente || r.escopo === 'condominio') && <span className="mt-0.5 self-start">{r.pendente ? <Badge tom="ambar" tamanho="xs">Aguardando aprovação do síndico</Badge> : <Badge tom="vermelho" tamanho="xs">Todo o condomínio</Badge>}</span>}
                  </div>
                  {podeRevogar && <button type="button" className={link} aria-label={`Revogar restrição de ${r.pessoaNome}`} onClick={() => void revogarRestricao(r)}>Revogar</button>}
                </div>
              ))}
              {d.restricoes.length === 0 && <span className={vazio}>Nenhuma restrição.</span>}
            </section>
          </div>

          <section className="rounded-[10px] border border-[#DCE1E5] bg-white">
            <h2 className="border-b border-[#E6EAED] px-5 py-[14px] text-[16px] font-semibold">Histórico recente de acessos</h2>
            {d.eventos.map((e) => {
              const c = chipDoEvento(e);
              return (
                <button key={e.id} type="button" onClick={() => setEvento(e)}
                  className="grid min-h-12 w-full grid-cols-[110px_minmax(0,1fr)_170px_minmax(0,1fr)_130px] items-center gap-3 border-b border-[#EEF1F3] bg-white px-5 py-[9px] text-left hover:bg-[#F5F8F9]">
                  <span className="font-mono text-[14px]">{quandoCurto(e.ocorridoEm, agora())}</span>
                  <span className="truncate font-medium">{e.pessoaNome}</span>
                  <span><Badge tom={c.tom}>{c.texto}</Badge></span>
                  <span className="truncate text-[14px]">{textoAutorizacao(e)}</span>
                  <span className="truncate text-[14px] text-[#33424B]">{e.operadorNome}</span>
                </button>
              );
            })}
            {d.eventos.length === 0 && <div className="px-5 py-4 text-[#56616B]">Sem acessos recentes.</div>}
          </section>
        </>
      )}

      {evento && <EventoGaveta ev={evento} onClose={() => setEvento(null)} />}
      {modo === 'vinculo' && <VinculoModal unidade={id} onClose={() => setModo(null)} onFeito={() => feito('Vínculo solicitado. Fica pendente até a aprovação; pendente não dá acesso de morador.')} />}
      {modo === 'previa' && <PreviaModal unidade={id} onClose={() => setModo(null)} onFeito={() => feito('Autorização prévia cadastrada.')} />}
      {modo === 'restricao' && <RestricaoModal unidade={id} onClose={() => setModo(null)} onFeito={(todo) => feito(todo ? 'Pedido de restrição para todo o condomínio registrado. Aguarda aprovação do síndico.' : 'Restrição cadastrada.')} />}
      {modo === 'veiculo' && <VeiculoModal unidade={id} onClose={() => setModo(null)} onFeito={() => feito('Veículo cadastrado.')} />}
    </div>
  );
}

const UnidadeTitulo = ({ unidade }: { unidade: string }) => <div className="font-mono text-[22px] font-semibold text-[#0B3F49]">{unidade}</div>;
const rodapeForm = (onClose: () => void, form: string, rotulo: string) => (
  <>
    <Button type="submit" form={form} variante="primario" grande className="flex-1">{rotulo}</Button>
    <Button grande onClick={onClose}>Cancelar</Button>
  </>
);

function VinculoModal({ unidade, onClose, onFeito }: { unidade: string; onClose: () => void; onFeito: () => void }) {
  const api = useApi();
  const [pessoa, setPessoa] = useState<PessoaBusca | null>(null);
  const [tipo, setTipo] = useState<TipoVinculo>('proprietario');
  const [ini, setIni] = useState(toInputDate(agora()));
  const [fim, setFim] = useState('');
  const [docTipo, setDocTipo] = useState('Contrato de locação residencial');
  const [arquivo, setArquivo] = useState('');
  const [erro, setErro] = useState('');
  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!pessoa) { setErro('Escolha a pessoa.'); return; }
    try {
      await api.vinculos.criar({
        pessoaId: pessoa.id, unidadeId: unidade, tipo, vigenciaInicio: fromInput(ini)!, vigenciaFim: fim ? fromInput(fim) : null,
        documento: { titulo: docTipo.toUpperCase(), linhas: [['Arquivo anexado', arquivo || '(não informado)']] }, solicitadoPor: '',
      });
      onFeito();
    } catch (err) { setErro(mensagemErro(err)); }
  }
  return (
    <Modal titulo="Solicitar vínculo" onClose={onClose} largura={600} rodape={rodapeForm(onClose, "f-vinc", "Solicitar vínculo")}>
      <UnidadeTitulo unidade={unidade} />
      <form id="f-vinc" onSubmit={salvar} className="flex flex-col gap-[14px]">
        <PessoaPicker rotulo="Pessoa" valor={pessoa} onChange={setPessoa} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo de vínculo"><select className="input" value={tipo} onChange={(e) => setTipo(e.target.value as TipoVinculo)}>{(Object.keys(ROTULO_VINCULO) as TipoVinculo[]).map((t) => <option key={t} value={t}>{ROTULO_VINCULO[t]}</option>)}</select></Field>
          <Field label="Documento comprobatório"><select className="input" value={docTipo} onChange={(e) => setDocTipo(e.target.value)}><option>Contrato de locação residencial</option><option>Escritura</option><option>Contrato de compra e venda</option><option>Certidão de nascimento</option><option>Outro</option></select></Field>
          <Field label="Início da vigência"><input type="date" className="input" value={ini} onChange={(e) => setIni(e.target.value)} /></Field>
          <Field label="Fim da vigência" dica={tipo === 'inquilino' ? 'Obrigatório para inquilino.' : 'Em branco = indeterminada.'}><input type="date" className="input" value={fim} onChange={(e) => setFim(e.target.value)} /></Field>
          <Field label="Arquivo do documento" className="col-span-2"><input type="file" className="input" onChange={(e) => setArquivo(e.target.files?.[0]?.name ?? '')} /></Field>
        </div>
        <Alert tom="neutro">O vínculo nasce <strong>pendente</strong> e só concede acesso depois da aprovação da administração ou do síndico.</Alert>
        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
      </form>
    </Modal>
  );
}

function PreviaModal({ unidade, onClose, onFeito }: { unidade: string; onClose: () => void; onFeito: () => void }) {
  const api = useApi();
  const [pessoa, setPessoa] = useState<PessoaBusca | null>(null);
  const [pedidaPor, setPedidaPor] = useState('');
  const [ate, setAte] = useState(''); // sem valor padrão: a validade é obrigatória (RN-07)
  const [dias, setDias] = useState<number[]>([]);
  const [hi, setHi] = useState('');
  const [hf, setHf] = useState('');
  const [erro, setErro] = useState('');
  const aut = useAsync(() => api.vinculos.autorizadores(unidade), [unidade]);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!pessoa) { setErro('Escolha a pessoa autorizada.'); return; }
    try {
      await api.autorizacoes.criar({
        unidadeId: unidade, pessoaId: pessoa.id, validaAte: ate ? fromInput(ate) : null, diasSemana: dias.length ? dias : null,
        horaInicio: hi || null, horaFim: hf || null, solicitadaPorPessoaId: pedidaPor || null,
      });
      onFeito();
    } catch (err) { setErro(mensagemErro(err)); }
  }
  return (
    <Modal titulo="Nova autorização prévia" onClose={onClose} rodape={rodapeForm(onClose, "f-prev", "Cadastrar autorização")}>
      <UnidadeTitulo unidade={unidade} />
      <form id="f-prev" onSubmit={salvar} className="flex flex-col gap-[14px]">
        <PessoaPicker rotulo="Pessoa autorizada" valor={pessoa} onChange={setPessoa} autoFocus />
        <Field label="Morador que pediu"><select className="input" value={pedidaPor} onChange={(e) => setPedidaPor(e.target.value)}><option value="">Selecione…</option>{(aut.data ?? []).map((a) => <option key={a.pessoa.id} value={a.pessoa.id}>{a.pessoa.nome}</option>)}</select></Field>
        <Field label="Válida até (obrigatório)" dica="Não existe autorização por prazo indeterminado (RN-07)."><input type="date" className="input" required value={ate} min={toInputDate(agora())} onChange={(e) => setAte(e.target.value)} /></Field>
        <fieldset><legend className="mb-1.5 text-[14px] font-medium">Dias da semana (nenhum marcado = todos os dias)</legend>
          <div className="flex gap-2">{DIAS_SEMANA_ABREV.map((n, i) => (
            <label key={n} className={`flex h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[14px] ${dias.includes(i) ? 'border-[#0B5563] bg-[#E3F0F2]' : 'border-[#B9C3CA] bg-white'}`}>
              <input type="checkbox" checked={dias.includes(i)} onChange={(e) => setDias(e.target.checked ? [...dias, i] : dias.filter((x) => x !== i))} />{n}
            </label>))}</div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Horário inicial"><input type="time" className="input" value={hi} onChange={(e) => setHi(e.target.value)} /></Field>
          <Field label="Horário final"><input type="time" className="input" value={hf} onChange={(e) => setHf(e.target.value)} /></Field>
        </div>
        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
      </form>
    </Modal>
  );
}

function RestricaoModal({ unidade, onClose, onFeito }: { unidade: string; onClose: () => void; onFeito: (todoCondominio: boolean) => void }) {
  const api = useApi();
  const [pessoa, setPessoa] = useState<PessoaBusca | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ate, setAte] = useState('');
  const [pedidaPor, setPedidaPor] = useState('');
  const [todo, setTodo] = useState(false);
  const [erro, setErro] = useState('');
  const aut = useAsync(() => api.vinculos.autorizadores(unidade), [unidade]);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!pessoa) { setErro('Escolha a pessoa que será restringida.'); return; }
    const nome = aut.data?.find((a) => a.pessoa.id === pedidaPor)?.pessoa.nome;
    try {
      await api.restricoes.criar({
        pessoaId: pessoa.id, unidadeId: unidade, motivo, validaAte: ate ? fromInput(ate) : null,
        solicitadaPorNome: nome ? `${nome} (morador, ${unidade})` : '', paraTodoCondominio: todo,
      });
      onFeito(todo);
    } catch (err) { setErro(mensagemErro(err)); }
  }
  return (
    <Modal titulo="Nova restrição" onClose={onClose} rodape={rodapeForm(onClose, "f-rest", "Cadastrar restrição")}>
      <UnidadeTitulo unidade={unidade} />
      <form id="f-rest" onSubmit={salvar} className="flex flex-col gap-[14px]">
        <PessoaPicker rotulo="Pessoa que não pode entrar" valor={pessoa} onChange={setPessoa} autoFocus />
        <Field label="Morador que pediu a restrição (obrigatório)"><select className="input" value={pedidaPor} onChange={(e) => setPedidaPor(e.target.value)}><option value="">Selecione…</option>{(aut.data ?? []).map((a) => <option key={a.pessoa.id} value={a.pessoa.id}>{a.pessoa.nome}</option>)}</select></Field>
        <Field label="Motivo" dica="Evite dados sensíveis no texto."><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
        <Field label="Vale até (obrigatório)"><input type="date" className="input" required value={ate} min={toInputDate(agora())} onChange={(e) => setAte(e.target.value)} /></Field>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#B9C3CA] p-3">
          <input type="checkbox" className="mt-1" checked={todo} onChange={(e) => setTodo(e.target.checked)} />
          <span><span className="font-medium">Pedir restrição para todo o condomínio</span><span className="block text-[13px] text-[#56616B]">Fica pendente até o síndico aprovar (RN-06). Enquanto pendente, vale só o pedido registrado.</span></span>
        </label>
        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
      </form>
    </Modal>
  );
}

function VeiculoModal({ unidade, onClose, onFeito }: { unidade: string; onClose: () => void; onFeito: () => void }) {
  const api = useApi();
  const [f, setF] = useState({ placa: '', modelo: '', cor: '' });
  const [erro, setErro] = useState('');
  async function salvar(e: FormEvent) {
    e.preventDefault();
    try { await api.veiculos.criar({ unidadeId: unidade, ...f }); onFeito(); } catch (err) { setErro(mensagemErro(err)); }
  }
  return (
    <Modal titulo="Novo veículo" onClose={onClose} rodape={rodapeForm(onClose, "f-vei", "Cadastrar")}>
      <UnidadeTitulo unidade={unidade} />
      <form id="f-vei" onSubmit={salvar} className="flex flex-col gap-[14px]">
        <Field label="Placa"><input data-autofocus className="input font-mono uppercase" value={f.placa} onChange={(e) => setF({ ...f, placa: e.target.value })} placeholder="ABC-1D23" /></Field>
        <Field label="Modelo"><input className="input" value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })} /></Field>
        <Field label="Cor"><input className="input" value={f.cor} onChange={(e) => setF({ ...f, cor: e.target.value })} /></Field>
        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
      </form>
    </Modal>
  );
}
