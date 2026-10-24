import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ban, Check, Info } from 'lucide-react';
import { useApi, type AutorizacaoView, type PessoaBusca, type RestricaoView, type VinculoView } from '../../api';
import type { CategoriaPessoa, Pessoa } from '@portaria/domain/types';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { InputMascara } from '../../components/InputMascara';
import { Badge, SeloVinculo } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { ConfirmarModal } from '../../components/ConfirmarModal';
import { PessoaPicker } from '../../components/PessoaPicker';
import { useToast } from '../../components/Toast';
import { ROTULO_VINCULO, type EventoView, type Veiculo } from '@portaria/domain/types';
import { MIN_JUSTIFICATIVA, descreverJanela } from '@portaria/domain/rules';
import { DIAS_SEMANA_ABREV, fmtData, fromInput, toInputDate, agora } from '@portaria/domain/time';
import { acharUnidadePorTexto, codigoUnidade } from '@portaria/domain/units';
import { mensagemErro, useAsync } from '../../app/useAsync';
import { NovaPessoaForm, ID_FORM_PESSOA, prefillDoTermo } from '../cadastro/NovaPessoaForm';
import { NovoVinculoModalLazy, mensagemSucesso } from '../vinculos/NovoVinculoLazy';
import { useCatalogo } from '../../app/catalogo';
import { APOS_AUTORIZACAO, APOS_VEICULO, useInvalidar } from '../../app/consultas';
import { useAcoesUnidade, useUnidadeDetalhe } from './useUnidades';
import { chipDoEvento, quandoCurto, textoAutorizacao } from '../common/evento';
import { EventoGaveta } from '../historico/EventoGaveta';

type Modo = null | 'vinculo' | 'morador' | 'previa' | 'restricao' | 'veiculo' | 'editar';

/** Seção cujo módulo a API real ainda não tem: o resto da tela funciona normalmente. */
function SecaoEmBreve({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[14px] text-[#56616B]" role="note" aria-label={`${titulo}: disponível em breve`}>
      <Info className="mt-[2px] h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
      <span>{children ?? 'Disponível em breve na API real.'}</span>
    </div>
  );
}

/** Detalhe da unidade (coluna direita do mestre-detalhe de Unidades). `id`: uuid ou código "D-32". */
export function UnidadeDetalhe({ id }: { id: string }) {
  const api = useApi();
  const nav = useNavigate();
  const invalidar = useInvalidar();
  const { avisar } = useToast();
  const catalogo = useCatalogo();
  const acoes = useAcoesUnidade();
  const [modo, setModo] = useState<Modo>(null);
  const [evento, setEvento] = useState<EventoView | null>(null);
  const [veiculoEditado, setVeiculoEditado] = useState<Veiculo | null>(null);
  const [revogando, setRevogando] = useState<AutorizacaoView | null>(null);
  const [encerrando, setEncerrando] = useState<VinculoView | null>(null);
  const [pendenteAviso, setPendenteAviso] = useState(false);
  const podeVinculo = useCan('vinculo.criar');
  const podeEncerrar = useCan('vinculo.decidir');
  const podeCadastrarMorador = useCan('pessoa.cadastrar_morador');
  const podePrevia = useCan('autorizacao.criar');
  const podeCadastrarExterno = useCan('pessoa.cadastrar_externo');
  const podeRestricao = useCan('restricao.criar');
  const podeRevogar = useCan('unidade.editar');
  const podeVeiculo = useCan('veiculo.cadastrar');
  const podeEditarUnidade = useCan('unidade.editar');
  const det = useUnidadeDetalhe(id);
  /** Vínculo, autorização ou restrição novos mudam o detalhe, o resumo do bloco, a fila de vínculos, a pessoa e o turno. */
  const recarregar = () => invalidar(APOS_AUTORIZACAO);

  if (det.error) return <Alert tom="vermelho" role="alert">{mensagemErro(det.error)} <Link className="underline" to="/unidades">Voltar às unidades</Link></Alert>;
  // Dado anterior (placeholder) só vale se for a MESMA unidade (troca de "D-32" para o uuid). De outra unidade, não:
  // os botões agiriam sobre a unidade anterior enquanto a nova carrega.
  const bruto = det.data;
  const mesma = !!bruto && (bruto.unidade.id === id || !!acharUnidadePorTexto([bruto.unidade], id));
  const d = det.isPlaceholderData && !mesma ? undefined : bruto;
  const uid = d?.unidade.id ?? '';
  const ativa = !!d?.unidade.ativo;
  const feito = (texto: string) => { setModo(null); avisar({ texto }); void recarregar(); };

  // RF-01: desativar/reativar (nunca excluir); a mutation invalida o catálogo, para o seletor de unidades refletir
  async function alternarAtivo() {
    if (!d) return;
    const codigo = catalogo.codigo(uid);
    try {
      await acoes.alternarAtivo.mutateAsync({ id: uid, ativo: ativa });
      avisar({ texto: ativa ? `Unidade ${codigo} desativada. O histórico continua disponível.` : `Unidade ${codigo} reativada.` });
    } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); }
  }

  async function revogarPrevia(a: AutorizacaoView) {
    await api.autorizacoes.revogar(a.id);
    setRevogando(null);
    avisar({ texto: 'Autorização prévia revogada.' });
    void recarregar();
  }
  async function encerrarVinculo(v: VinculoView, motivo: string) {
    await api.vinculos.encerrar(v.id, { motivo });
    setEncerrando(null);
    avisar({ tom: 'ambar', texto: `Vínculo de ${v.pessoaNome} encerrado. Deixa de valer para acesso; o histórico é mantido.` });
    void recarregar();
  }
  async function revogarRestricao(r: RestricaoView) {
    try { await api.restricoes.revogar(r.id); avisar({ texto: 'Restrição revogada.' }); void recarregar(); } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); }
  }

  const cartao = 'flex flex-col gap-[10px] rounded-[10px] border border-[#DCE1E5] bg-white px-[18px] py-[14px]';
  const vazio = 'text-[14px] text-[#56616B]';
  const link = 'inline-flex min-h-[44px] items-center px-1 text-[13px] font-semibold lg:min-h-0 text-[#0B5563] hover:underline';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[24px] font-semibold sm:text-[30px]">{catalogo.agrupamento} {d?.unidade.bloco} · Apartamento {d?.unidade.numero}</h1>
        <div className="flex flex-wrap gap-2">
          {d && ativa && podePrevia && <Button variante="primario" onClick={() => setModo('previa')}>Nova autorização prévia</Button>}
          {d && ativa && podeRestricao && <Button onClick={() => setModo('restricao')}>Nova restrição</Button>}
          {d && ativa && podeVinculo && <Button onClick={() => { setPendenteAviso(false); setModo('vinculo'); }}>Solicitar vínculo</Button>}
          {d && podeEditarUnidade && <Button onClick={() => setModo('editar')}>Editar número</Button>}
          {d && podeEditarUnidade && <Button disabled={acoes.alternarAtivo.isPending} onClick={() => void alternarAtivo()}>{ativa ? 'Desativar unidade' : 'Reativar unidade'}</Button>}
        </div>
      </div>
      {d && !ativa && (
        <Alert tom="ambar" role="status">Unidade desativada: reative para incluir moradores ou autorizações.{' '}
          {podeEditarUnidade ? 'Use o botão “Reativar unidade”, no alto da página.' : 'Peça à administração ou ao síndico para reativá-la.'}{' '}
          Ela não aparece para nova entrada, encomenda ou vínculo; o histórico continua disponível.</Alert>
      )}
      {pendenteAviso && (
        <Alert tom="neutro" role="status">Vínculo solicitado: fica <strong>pendente</strong> até a aprovação em{' '}
          <Link className="font-semibold underline" to="/vinculos">Vínculos</Link>. Enquanto pendente, não dá acesso de morador.</Alert>
      )}

      {d && (
        <>
          <section className="rounded-[10px] border border-[#DCE1E5] bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-[#E6EAED] px-5 py-[10px]">
              <h2 className="text-[16px] font-semibold">Moradores</h2>
              {podeVinculo && ativa && <Button pequeno onClick={() => { setPendenteAviso(false); setModo('morador'); }}>Incluir morador</Button>}
            </div>
            {d.vinculos === null && <div className="px-5 py-4"><SecaoEmBreve titulo="Moradores">Vínculos da unidade: disponível em breve na API real.</SecaoEmBreve></div>}
            {d.vinculos?.map((v) => (
              <div key={v.id} className="grid min-h-[52px] grid-cols-1 gap-1 sm:grid-cols-[minmax(0,1fr)_220px_120px_auto] sm:items-center sm:gap-3 border-b border-[#EEF1F3] px-5 py-[10px] last:border-b-0">
                <span className="truncate font-medium">{v.pessoaNome}</span>
                <span className="truncate text-[14px]">{ROTULO_VINCULO[v.tipo]}
                  {v.status === 'legado' && v.prazoRegularizacao ? <span className="text-[#56616B]"> · regularizar até {fmtData(v.prazoRegularizacao)}</span>
                    : v.vigenciaFim ? <span className="text-[#56616B]"> · até {fmtData(v.vigenciaFim)}</span> : null}</span>
                <SeloVinculo status={v.status} />
                <span>{podeEncerrar && (v.status === 'aprovado' || v.status === 'legado') && (
                  <button type="button" className={link} aria-label={`Encerrar vínculo de ${v.pessoaNome}`} onClick={() => setEncerrando(v)}>Encerrar vínculo</button>)}</span>
              </div>
            ))}
            {d.vinculos?.length === 0 && <div className="px-5 py-4 text-[#56616B]">Nenhum vínculo cadastrado.</div>}
          </section>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <section className={cartao}>
              <div className="flex items-center justify-between gap-2"><h2 className="text-[16px] font-semibold">Veículos</h2>
                {podeVeiculo && <button type="button" className={link} onClick={() => setModo('veiculo')}>+ Novo</button>}</div>
              {d.veiculos.map((v) => (
                <div key={v.id} className="flex items-start justify-between gap-2">
                  <div className="flex flex-col"><span className="font-mono text-[17px] font-semibold">{v.placa}</span><span className="text-[14px] text-[#56616B]">{v.modelo} · {v.cor}</span></div>
                  {podeVeiculo && <button type="button" className={link} aria-label={`Editar veículo ${v.placa}`} onClick={() => setVeiculoEditado(v)}>Editar</button>}
                </div>
              ))}
              {d.veiculos.length === 0 && <span className={vazio}>Nenhum veículo cadastrado.</span>}
            </section>

            <section className={cartao}>
              <h2 className="text-[16px] font-semibold">Autorizações prévias ativas</h2>
              {d.autorizacoes === null && <SecaoEmBreve titulo="Autorizações prévias" />}
              {d.autorizacoes?.map((a) => (
                <div key={a.id} className="flex items-start gap-2">
                  <Check className="mt-[3px] h-4 w-4 shrink-0 text-[#05603A]" strokeWidth={2.6} aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{a.pessoaNome}</span>
                    <span className="text-[13px] text-[#56616B]">Até {fmtData(a.validaAte)} · {descreverJanela(a)}{a.semSolicitante ? ` · cadastrada por ${a.cadastradaPorNome}` : ` · por ${a.solicitadaPorNome}`}</span>
                    {a.semSolicitante && <span className="mt-0.5 self-start"><Badge tom="ambar" tamanho="xs">Sem solicitante</Badge></span>}
                    {a.semSolicitante && a.justificativa && <span className="text-[13px] text-[#7A2E0E]">Justificativa: {a.justificativa}</span>}
                    {a.estado !== 'valida' && <span className="mt-0.5 self-start"><Badge tom="ambar" tamanho="xs">Fora da janela agora</Badge></span>}
                  </div>
                  {podePrevia && <button type="button" className={link} aria-label={`Revogar autorização de ${a.pessoaNome}`} onClick={() => setRevogando(a)}>Revogar</button>}
                </div>
              ))}
              {d.autorizacoes?.length === 0 && <span className={vazio}>Nenhuma autorização ativa.</span>}
            </section>

            <section className={cartao}>
              <h2 className="text-[16px] font-semibold">Restrições</h2>
              {d.restricoes === null && <SecaoEmBreve titulo="Restrições" />}
              {d.restricoes?.map((r) => (
                <div key={r.id} className="flex items-start gap-2 text-[#B42318]">
                  <Ban className="mt-[3px] h-4 w-4 shrink-0" strokeWidth={2.4} aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">{r.pessoaNome}</span>
                    <span className="text-[13px] text-[#912018]">“{r.motivo}”</span>
                    <span className="text-[13px] text-[#56616B]">Solicitada por {r.solicitadaPorNome ?? 'administração'} · {fmtData(r.cadastradaEm)}</span>
                    {(r.pendente || r.escopo === 'condominio') && <span className="mt-0.5 self-start">{r.pendente ? <Badge tom="ambar" tamanho="xs">Aguardando aprovação do síndico</Badge> : <Badge tom="vermelho" tamanho="xs">Todo o condomínio</Badge>}</span>}
                  </div>
                  {podeRevogar && <button type="button" className={link} aria-label={`Revogar restrição de ${r.pessoaNome}`} onClick={() => void revogarRestricao(r)}>Revogar</button>}
                </div>
              ))}
              {d.restricoes?.length === 0 && <span className={vazio}>Nenhuma restrição.</span>}
            </section>
          </div>

          <section className="rounded-[10px] border border-[#DCE1E5] bg-white">
            <h2 className="border-b border-[#E6EAED] px-5 py-[14px] text-[16px] font-semibold">Histórico recente de acessos</h2>
            {d.eventos === null && <div className="px-5 py-4"><SecaoEmBreve titulo="Histórico recente de acessos" /></div>}
            {d.eventos?.map((e) => {
              const c = chipDoEvento(e);
              return (
                <button key={e.id} type="button" onClick={() => setEvento(e)}
                  className="grid min-h-12 w-full grid-cols-2 items-center gap-x-3 gap-y-1 md:grid-cols-[110px_minmax(0,1fr)_170px_minmax(0,1fr)_130px] border-b border-[#EEF1F3] bg-white px-5 py-[9px] text-left hover:bg-[#F5F8F9]">
                  <span className="font-mono text-[14px]">{quandoCurto(e.ocorridoEm, agora())}</span>
                  <span className="truncate font-medium">{e.pessoaNome}</span>
                  <span><Badge tom={c.tom}>{c.texto}</Badge></span>
                  <span className="truncate text-[14px]">{textoAutorizacao(e)}</span>
                  <span className="truncate text-[14px] text-[#33424B]">{e.operadorNome}</span>
                </button>
              );
            })}
            {d.eventos?.length === 0 && <div className="px-5 py-4 text-[#56616B]">Sem acessos recentes.</div>}
          </section>
        </>
      )}

      {evento && <EventoGaveta ev={evento} onClose={() => setEvento(null)} />}
      {d && (modo === 'vinculo' || modo === 'morador') && (
        <NovoVinculoModalLazy titulo={modo === 'morador' ? 'Incluir morador' : 'Solicitar vínculo'} unidadeFixa={d.unidade} vinculosConhecidos={d.vinculos}
          onClose={() => setModo(null)} onFeito={(v) => { feito(mensagemSucesso(v)); setPendenteAviso(v.status === 'pendente'); }}
          cadastro={podeCadastrarMorador ? ({ texto, onEscolhida, onVoltar }) => (
            <CadastroNoSeletor unidade={uid} texto={texto} onVoltar={onVoltar} onEscolhida={onEscolhida}
              aviso="Depois de cadastrada, a pessoa já fica escolhida no vínculo. O vínculo continua pendente até a aprovação em Vínculos." />
          ) : undefined} />
      )}
      {revogando && (
        <ConfirmarModal titulo="Revogar autorização prévia" rotulo="Revogar autorização" onClose={() => setRevogando(null)} onConfirmar={() => revogarPrevia(revogando)}>
          <p>Revogar a autorização prévia de <strong>{revogando.pessoaNome}</strong>? Ela deixa de valer na portaria; o histórico é mantido.</p>
        </ConfirmarModal>
      )}
      {encerrando && <EncerrarVinculoModal vinculo={encerrando} onClose={() => setEncerrando(null)} onConfirmar={(motivo) => encerrarVinculo(encerrando, motivo)} />}
      {d && modo === 'previa' && <PreviaModal unidade={uid} podeCadastrar={podeCadastrarExterno} onClose={() => setModo(null)} onFeito={() => feito('Autorização prévia cadastrada.')} />}
      {d && modo === 'restricao' && <RestricaoModal unidade={uid} onClose={() => setModo(null)} onFeito={(todo) => feito(todo ? 'Pedido de restrição para todo o condomínio registrado. Aguarda aprovação do síndico.' : 'Restrição cadastrada.')} />}
      {d && modo === 'veiculo' && <VeiculoModal unidade={uid} onClose={() => setModo(null)} onFeito={() => { setModo(null); avisar({ texto: 'Veículo cadastrado.' }); void invalidar(APOS_VEICULO); }} />}
      {d && veiculoEditado && <VeiculoModal unidade={uid} atual={veiculoEditado} onClose={() => setVeiculoEditado(null)}
        onFeito={(texto) => { setVeiculoEditado(null); avisar({ texto }); void invalidar(APOS_VEICULO); }} />}
      {d && modo === 'editar' && <EditarUnidadeModal id={uid} bloco={d.unidade.bloco} numero={d.unidade.numero} onClose={() => setModo(null)}
        onFeito={(cod, novoId) => { feito(`Unidade alterada para ${cod}.`); nav(`/unidades/${novoId}`, { replace: true }); }} />}
    </div>
  );
}

const UnidadeTitulo = ({ unidade }: { unidade: string }) => {
  const { codigo } = useCatalogo();
  return <div className="font-mono text-[22px] font-semibold text-[#0B3F49]">{codigo(unidade)}</div>;
};

/**
 * RF-01: cadastra unidade (exceção à estrutura inicial) ou corrige bloco/número de unidade ainda sem registros (a API
 * recusa a referenciada com 422). Bloco em maiúsculas (letras e dígitos); a API normaliza o número ("3" -> "03").
 */
export function EditarUnidadeModal({ id, bloco, numero, onClose, onFeito }: {
  id: string | null; bloco?: string; numero?: string; onClose: () => void; onFeito: (codigo: string, id: string) => void | Promise<void>;
}) {
  const acoes = useAcoesUnidade();
  const { agrupamento } = useCatalogo();
  const [b, setB] = useState(bloco ?? '');
  const [n, setN] = useState(numero ?? '');
  const [erro, setErro] = useState('');
  async function salvar(e: FormEvent) {
    e.preventDefault();
    try {
      // mutateAsync resolve depois da invalidação (onSuccess): o catálogo já conhece a unidade quando a tela navega
      const u = id ? await acoes.editar.mutateAsync({ id, bloco: b, numero: n.trim() }) : await acoes.criar.mutateAsync({ bloco: b, numero: n.trim() });
      await onFeito(codigoUnidade(u), u.id);
    } catch (err) { setErro(mensagemErro(err)); }
  }
  return (
    <Modal titulo={id ? 'Editar número da unidade' : 'Nova unidade'} onClose={onClose} largura={480} rodape={rodapeForm(onClose, 'f-un', id ? 'Salvar' : 'Cadastrar unidade')}>
      <form id="f-un" onSubmit={salvar} className="flex flex-col gap-[14px]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={agrupamento}><input data-autofocus className="input font-mono uppercase" autoComplete="off" value={b} onChange={(e) => setB(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3))} /></Field>
          <Field label="Apartamento"><input className="input font-mono" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, '').slice(0, 4))} /></Field>
        </div>
        {id && <Alert tom="neutro">Só é possível alterar o número de unidade sem vínculos, acessos ou encomendas. Com histórico, desative-a e cadastre a correta.</Alert>}
        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
      </form>
    </Modal>
  );
}
const rodapeForm = (onClose: () => void, form: string, rotulo: string) => (
  <>
    <Button type="submit" form={form} variante="primario" grande className="flex-1">{rotulo}</Button>
    <Button grande onClick={onClose}>Cancelar</Button>
  </>
);

/** Pessoa recém-cadastrada (ou o cadastro existente) no formato do seletor. */
const paraSeletor = (p: Pessoa): PessoaBusca => ({ ...p, ultimoAcesso: '', unidadesVinculadas: [], unidadesVinculadasCodigos: [] });

/**
 * Cadastro de pessoa no lugar do formulário de quem tem um seletor (mesma janela: dois modais empilhados quebrariam o
 * foco). CPF já cadastrado: "Usar o cadastro existente" (ou "Reativar e usar…") escolhe essa pessoa no seletor.
 */
function CadastroNoSeletor({ unidade, texto, aviso, categoriaInicial, onEscolhida, onVoltar }: {
  unidade: string; texto: string; aviso: string; categoriaInicial?: CategoriaPessoa; onEscolhida: (p: PessoaBusca) => void; onVoltar: () => void;
}) {
  const api = useApi();
  return (
    <Modal titulo="Nova pessoa" onClose={onVoltar} largura={600} gap={14}
      rodape={<><Button type="submit" form={ID_FORM_PESSOA} variante="primario" grande className="flex-1">Cadastrar e escolher</Button><Button grande onClick={onVoltar}>Voltar</Button></>}>
      <UnidadeTitulo unidade={unidade} />
      <NovaPessoaForm nomeInicial={prefillDoTermo(texto).nome} documentoInicial={prefillDoTermo(texto).documento} aviso={aviso} categoriaInicial={categoriaInicial}
        onFeito={(p) => onEscolhida(paraSeletor(p))}
        onExistente={async (id) => onEscolhida(paraSeletor((await api.pessoas.ficha(id)).pessoa))} />
    </Modal>
  );
}

function PreviaModal({ unidade, podeCadastrar, onClose, onFeito }: { unidade: string; podeCadastrar?: boolean; onClose: () => void; onFeito: () => void }) {
  const api = useApi();
  const [pessoa, setPessoa] = useState<PessoaBusca | null>(null);
  const [pedidaPor, setPedidaPor] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [ate, setAte] = useState(''); // sem valor padrão: a validade é obrigatória (RN-07)
  const [dias, setDias] = useState<number[]>([]);
  const [hi, setHi] = useState('');
  const [hf, setHf] = useState('');
  const [erro, setErro] = useState('');
  const aut = useAsync(() => api.vinculos.autorizadores(unidade), [unidade]);
  const [cadastrando, setCadastrando] = useState<string | null>(null);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!pessoa) { setErro('Escolha a pessoa autorizada.'); return; }
    try {
      await api.autorizacoes.criar({
        unidadeId: unidade, pessoaId: pessoa.id, validaAte: ate ? fromInput(ate) : null, diasSemana: dias.length ? dias : null,
        horaInicio: hi || null, horaFim: hf || null, solicitadaPorPessoaId: pedidaPor || null,
        justificativa: pedidaPor ? null : justificativa,
      });
      onFeito();
    } catch (err) { setErro(mensagemErro(err)); }
  }
  if (cadastrando !== null) {
    return (
      <CadastroNoSeletor unidade={unidade} texto={cadastrando} categoriaInicial="visitante" onVoltar={() => setCadastrando(null)}
        aviso="Depois de cadastrada, a pessoa já fica escolhida na autorização prévia."
        onEscolhida={(p) => { setPessoa(p); setCadastrando(null); setErro(''); }} />
    );
  }
  return (
    <Modal titulo="Nova autorização prévia" onClose={onClose} rodape={rodapeForm(onClose, "f-prev", "Cadastrar autorização")}>
      <UnidadeTitulo unidade={unidade} />
      <form id="f-prev" onSubmit={salvar} className="flex flex-col gap-[14px]">
        <PessoaPicker rotulo="Pessoa autorizada" valor={pessoa} onChange={setPessoa} autoFocus onCadastrar={podeCadastrar ? setCadastrando : undefined} />
        <Field label="Morador que pediu"><select className="input" value={pedidaPor} onChange={(e) => setPedidaPor(e.target.value)}><option value="">Selecione…</option>{(aut.data ?? []).map((a) => <option key={a.pessoa.id} value={a.pessoa.id}>{a.pessoa.nome}</option>)}</select></Field>
        {!pedidaPor && (
          <Field label={`Justificativa (obrigatória sem morador solicitante, mínimo ${MIN_JUSTIFICATIVA} caracteres)`} dica="A autorização ficará marcada como “Sem solicitante” e contará como exceção de quem a cadastrou.">
            <textarea className="input" rows={2} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
          </Field>
        )}
        <Field label="Válida até (obrigatório)" dica="Não existe autorização por prazo indeterminado (RN-07)."><input type="date" className="input" required value={ate} min={toInputDate(agora())} onChange={(e) => setAte(e.target.value)} /></Field>
        <fieldset><legend className="mb-1.5 text-[14px] font-medium">Dias da semana (nenhum marcado = todos os dias)</legend>
          <div className="flex gap-2">{DIAS_SEMANA_ABREV.map((n, i) => (
            <label key={n} className={`flex h-[44px] cursor-pointer items-center gap-1.5 rounded-full lg:h-10 border px-3 text-[14px] ${dias.includes(i) ? 'border-[#0B5563] bg-[#E3F0F2]' : 'border-[#B9C3CA] bg-white'}`}>
              <input type="checkbox" checked={dias.includes(i)} onChange={(e) => setDias(e.target.checked ? [...dias, i] : dias.filter((x) => x !== i))} />{n}
            </label>))}</div>
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
    try {
      await api.restricoes.criar({
        pessoaId: pessoa.id, unidadeId: unidade, motivo, validaAte: ate ? fromInput(ate) : null,
        solicitadaPorPessoaId: pedidaPor || null, paraTodoCondominio: todo,
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

/** RF-08: novo veículo ou edição (placa, modelo, cor) e desativação. Placa ativa é única no condomínio. */
function VeiculoModal({ unidade, atual, onClose, onFeito }: { unidade: string; atual?: Veiculo; onClose: () => void; onFeito: (texto: string) => void }) {
  const api = useApi();
  const [f, setF] = useState({ placa: atual?.placa ?? '', modelo: atual?.modelo ?? '', cor: atual?.cor ?? '' });
  const [erro, setErro] = useState('');
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    try {
      if (atual) { await api.veiculos.editar({ id: atual.id, ...f }); onFeito('Veículo atualizado.'); }
      else { await api.veiculos.criar({ unidadeId: unidade, ...f }); onFeito('Veículo cadastrado.'); }
    } catch (err) { setErro(mensagemErro(err)); }
  }
  async function desativar() {
    if (!atual) return;
    setErro('');
    try { await api.veiculos.editar({ id: atual.id, ativo: false }); onFeito(`Veículo ${atual.placa} desativado. O histórico é mantido.`); } catch (err) { setErro(mensagemErro(err)); }
  }
  return (
    <Modal titulo={atual ? 'Editar veículo' : 'Novo veículo'} onClose={onClose} rodape={<>
      <Button type="submit" form="f-vei" variante="primario" grande className="flex-1">{atual ? 'Salvar' : 'Cadastrar'}</Button>
      {atual && <Button grande variante="perigo" onClick={() => void desativar()}>Desativar veículo</Button>}
      <Button grande onClick={onClose}>Cancelar</Button>
    </>}>
      <UnidadeTitulo unidade={unidade} />
      <form id="f-vei" onSubmit={salvar} className="flex flex-col gap-[14px]">
        <Field label="Placa"><InputMascara tipo="placa" data-autofocus className="input font-mono uppercase" value={f.placa} onChange={(placa) => setF({ ...f, placa })} /></Field>
        <Field label="Modelo"><input className="input" value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })} /></Field>
        <Field label="Cor"><input className="input" value={f.cor} onChange={(e) => setF({ ...f, cor: e.target.value })} /></Field>
        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
      </form>
    </Modal>
  );
}

/** Encerra um vínculo aprovado ou legado direto da unidade (RF-07): motivo obrigatório e confirmação. */
function EncerrarVinculoModal({ vinculo, onClose, onConfirmar }: { vinculo: VinculoView; onClose: () => void; onConfirmar: (motivo: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState('');
  const ok = motivo.trim().length >= MIN_JUSTIFICATIVA;
  return (
    <ConfirmarModal titulo="Encerrar vínculo" rotulo="Confirmar encerramento" desabilitado={!ok} onClose={onClose} onConfirmar={() => onConfirmar(motivo)}>
      <p>Encerrar o vínculo de <strong>{vinculo.pessoaNome}</strong> ({ROTULO_VINCULO[vinculo.tipo]})? Ele deixa de valer para acesso; o histórico é mantido.</p>
      <Field label="Motivo do encerramento (obrigatório)" dica={`${motivo.trim().length} de ${MIN_JUSTIFICATIVA} caracteres no mínimo`}>
        <textarea className="input" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: Locação encerrada; o inquilino entregou as chaves à administração." />
      </Field>
    </ConfirmarModal>
  );
}
