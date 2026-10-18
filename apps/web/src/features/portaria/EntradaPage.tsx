import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Check, Clock, History, Plus, Search } from 'lucide-react';
import { useApi, ehApiError, type Autorizador, type AutorizacaoView, type NovaPessoaInput, type PessoaBusca, type RestricaoView } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { SeloVinculo } from '../../components/Badge';
import { Button } from '../../components/Button';
import { CartaoPasso } from '../../components/Card';
import { Field } from '../../components/Field';
import { Modal, temModalAberto } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { TowerUnitPicker, type TowerUnitPickerHandle } from '../../components/TowerUnitPicker';
import { useToast } from '../../components/Toast';
import { Avatar } from '../../components/UnitTag';
import {
  ROTULO_CATEGORIA, ROTULO_MEIO, ROTULO_PAPEL, type CategoriaPessoa, type Funcionario, type MeioAutorizacao,
} from '@portaria/domain/types';
import {
  descreverHorario, descreverJanela, escalaVigente, estadoAutorizacaoPrevia, justificativaValida, meiosAceitos, MIN_JUSTIFICATIVA,
  podeConfirmarEntrada, type DadosAutorizacao,
} from '@portaria/domain/rules';
import { fmtData, fmtHora, fromInput, toInputDate, toInputTime } from '@portaria/domain/time';
import { mensagemErro, useAgora } from '../../app/useAsync';
import { useCatalogo } from '../../app/catalogo';
import { APOS_EVENTO, useInvalidar } from '../../app/consultas';
import { garantirNegado } from './negado';

const SUGESTOES_EXCECAO = ['Morador não atende o interfone', 'Emergência médica', 'Serviço público (luz, água, gás)'];

const NP_VAZIA = { nome: '', documento: '', telefone: '', semCpf: false, categoria: 'visitante' as CategoriaPessoa, empresa: '', servico: '', foto: '' };

const LIMITE_SUGESTOES = 8;
/** Quem tem vínculo válido aparece na busca com o rótulo "Morador da T4-32" (pode visitar outra unidade). */
const rotuloPessoa = (p: PessoaBusca) => (p.unidadesVinculadasCodigos.length > 0
  ? `Morador da ${p.unidadesVinculadasCodigos[0]}${p.unidadesVinculadasCodigos.length > 1 ? ` +${p.unidadesVinculadasCodigos.length - 1}` : ''}`
  : ROTULO_CATEGORIA[p.categoria]);

export function EntradaPage() {
  const api = useApi();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const retroativo = params.get('retroativo') === '1';
  const { usuario } = useAuth();
  const { avisar } = useToast();
  const agora = useAgora(15000);
  const agoraRef = useRef(agora);
  agoraRef.current = agora;
  const catalogo = useCatalogo();
  // Registrar entrada, recusa ou negado atualiza presentes, turno e histórico (e a unidade, a ficha e a busca)
  const invalidar = useInvalidar();

  // --- Passo 1: pessoa
  const [query, setQuery] = useState('');
  const [sugestoes, setSugestoes] = useState<PessoaBusca[]>([]);
  const [idx, setIdx] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [mais, setMais] = useState(false); // havia mais resultados que o limite da lista
  const [pessoa, setPessoa] = useState<PessoaBusca | null>(null);
  const [funcionario, setFuncionario] = useState<Funcionario | null>(null);
  const [novoModo, setNovoModo] = useState(false);
  const [np, setNp] = useState(NP_VAZIA);
  const [erroNp, setErroNp] = useState('');
  // --- Passo 2: unidade (ou área comum, só prestador: RF-36)
  const [destino, setDestino] = useState<'unidade' | 'area_comum'>('unidade');
  const [areaId, setAreaId] = useState('');
  const [torre, setTorre] = useState<number | null>(null);
  const [numero, setNumero] = useState<string | null>(null);
  const [carregandoUnidade, setCarregandoUnidade] = useState(false);
  const [previas, setPrevias] = useState<AutorizacaoView[]>([]);
  const [autorizadores, setAutorizadores] = useState<Autorizador[]>([]);
  const [restricao, setRestricao] = useState<RestricaoView[] | null>(null);
  // Negado que o servidor JÁ gravou (422 PESSOA_EM_RESTRICAO na confirmação): o modal não pode gravar outro
  const [negadoGravado, setNegadoGravado] = useState<{ eventoId: string; codigo: string } | null>(null);
  // --- Passo 3: autorização
  const [meio, setMeio] = useState<MeioAutorizacao | null>(null);
  const [residenteId, setResidenteId] = useState<string | null>(null);
  const [justificativa, setJustificativa] = useState('');
  // --- Retroativo
  const [dataReal, setDataReal] = useState(toInputDate(agora));
  const [horaReal, setHoraReal] = useState('');
  const [formulario, setFormulario] = useState('');
  // --- Envio
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [recusando, setRecusando] = useState(false);

  const buscaRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<TowerUnitPickerHandle>(null);
  const grupoMeioRef = useRef<HTMLFieldSetElement>(null);
  const focarMeio = useRef(false);
  const enterPendente = useRef(false);

  useEffect(() => { buscaRef.current?.focus(); }, []);

  // Busca incremental
  useEffect(() => {
    if (pessoa || novoModo || query.trim().length < 1) { setSugestoes([]); setMais(false); return; }
    let vivo = true;
    setBuscando(true);
    const t = setTimeout(() => {
      api.pessoas.buscar(query, { limite: LIMITE_SUGESTOES + 1 })
        .then((r) => {
          if (!vivo) return;
          setMais(r.length > LIMITE_SUGESTOES); setSugestoes(r.slice(0, LIMITE_SUGESTOES)); setIdx(0);
          // Enter digitado antes de a lista chegar: escolhe o primeiro resultado
          if (enterPendente.current && r[0]) { enterPendente.current = false; void escolherPessoaRef.current(r[0]); }
        })
        .catch((e) => vivo && setErro(mensagemErro(e)))
        .finally(() => vivo && setBuscando(false));
    }, 120);
    return () => { vivo = false; clearTimeout(t); };
  }, [query, pessoa, novoModo, api]);

  const escolherPessoaRef = useRef<(p: PessoaBusca) => Promise<void>>(async () => undefined);
  const escolherPessoa = useCallback(async (p: PessoaBusca) => {
    setPessoa(p); setQuery(''); setSugestoes([]); setErro('');
    setFuncionario(p.categoria === 'funcionario' ? await api.pessoas.funcionario(p.id) : null);
    // Correção 12: após escolher a pessoa, o foco vai para a seleção de torre
    setTimeout(() => pickerRef.current?.focusTorre(), 0);
  }, [api]);

  escolherPessoaRef.current = escolherPessoa;

  function limpar(manterFoco = true) {
    setPessoa(null); setFuncionario(null); setQuery(''); setSugestoes([]); setNovoModo(false); setNp(NP_VAZIA); setErroNp('');
    setTorre(null); setNumero(null); setPrevias([]); setAutorizadores([]); setMeio(null); setResidenteId(null); setJustificativa('');
    setErro(''); setFormulario(''); setHoraReal(''); setRestricao(null); setNegadoGravado(null); setDestino('unidade'); setAreaId('');
    if (manterFoco) setTimeout(() => buscaRef.current?.focus(), 0);
  }
  const limparUnidade = () => {
    setRestricao(null); setNegadoGravado(null);
    setTorre(null); setNumero(null); setPrevias([]); setAutorizadores([]); setMeio(null); setResidenteId(null); setJustificativa('');
    setTimeout(() => pickerRef.current?.focusTorre(), 0);
  };

  // Ao escolher a unidade: restrições (RF-16), autorizações prévias e moradores aptos a autorizar
  const emArea = destino === 'area_comum' && pessoa?.categoria === 'prestador';
  const unidadeAtual = !emArea && torre && numero ? catalogo.porTorreNumero(torre, numero)?.id ?? null : null;
  const areaAtual = emArea && areaId ? areaId : null;
  const codUnidade = unidadeAtual ? catalogo.codigo(unidadeAtual) : null;

  // RF-36: prestador em área comum — só restrição de condomínio e autorizações prévias da área (sem morador para autorizar)
  useEffect(() => {
    if (!pessoa || !areaAtual) return;
    let vivo = true;
    setCarregandoUnidade(true); setMeio(null); setResidenteId(null); setErro('');
    (async () => {
      try {
        const rest = await api.restricoes.verificar(pessoa.id, null);
        if (!vivo) return;
        if (rest.restrita) { setNegadoGravado(null); setRestricao(rest.alertas); setCarregandoUnidade(false); return; }
        const aps = await api.autorizacoes.vigentes(pessoa.id, areaAtual, { areaComum: true });
        if (!vivo) return;
        setPrevias(aps); setAutorizadores([]);
        if (aps.some((a) => estadoAutorizacaoPrevia(a, agoraRef.current) === 'valida') && !pessoa.semCpf) setMeio('autorizacao_previa');
        focarMeio.current = true;
      } catch (e) { if (vivo) setErro(mensagemErro(e)); }
      finally { if (vivo) setCarregandoUnidade(false); }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pessoa?.id, areaAtual, api]);

  useEffect(() => {
    if (!pessoa || emArea) return;
    // Funcionário sem unidade (entrada por escala): só vale restrição do condomínio, verificada logo ao escolher a pessoa
    if (!unidadeAtual) {
      if (pessoa.categoria !== 'funcionario') return;
      let vivo = true;
      api.restricoes.verificar(pessoa.id, null)
        .then((rest) => { if (vivo && rest.restrita) { setNegadoGravado(null); setRestricao(rest.alertas); } })
        .catch((e) => vivo && setErro(mensagemErro(e)));
      return () => { vivo = false; };
    }
    let vivo = true;
    setCarregandoUnidade(true); setMeio(null); setResidenteId(null); setErro('');
    (async () => {
      try {
        const rest = await api.restricoes.verificar(pessoa.id, unidadeAtual);
        if (!vivo) return;
        if (rest.restrita) { setNegadoGravado(null); setRestricao(rest.alertas); setCarregandoUnidade(false); return; }
        const [aps, auts] = await Promise.all([api.autorizacoes.vigentes(pessoa.id, unidadeAtual), api.vinculos.autorizadores(unidadeAtual)]);
        if (!vivo) return;
        setPrevias(aps); setAutorizadores(auts);
        const valida = aps.find((a) => estadoAutorizacaoPrevia(a, agoraRef.current) === 'valida');
        if (valida && !pessoa.semCpf) setMeio('autorizacao_previa');
        focarMeio.current = true;
      } catch (e) { if (vivo) setErro(mensagemErro(e)); }
      finally { if (vivo) setCarregandoUnidade(false); }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pessoa?.id, unidadeAtual, api]);

  // Correção 12: após a unidade, o foco vai para "Quem autorizou?"
  useEffect(() => {
    if (!carregandoUnidade && focarMeio.current && (unidadeAtual || areaAtual)) {
      focarMeio.current = false;
      const alvo = grupoMeioRef.current?.querySelector<HTMLInputElement>('input[type=radio]:checked:not(:disabled)')
        ?? grupoMeioRef.current?.querySelector<HTMLInputElement>('input[type=radio]:not(:disabled)');
      alvo?.focus();
    }
  }, [carregandoUnidade, unidadeAtual, areaAtual]);

  // --- instante do acesso (retroativo usa a hora real informada)
  const quando = retroativo ? fromInput(dataReal, horaReal || '00:00') : agora;
  const retroValido = !retroativo || (!!horaReal && quando !== null && quando < agora);

  const previaValida = useMemo(() => previas.find((a) => quando !== null && estadoAutorizacaoPrevia(a, quando) === 'valida'), [previas, quando]);
  const previaFora = useMemo(() => (previaValida ? undefined : previas.find((a) => quando !== null && estadoAutorizacaoPrevia(a, quando) === 'fora_da_janela')), [previas, previaValida, quando]);
  // "Morador" em outra unidade (ou sem vínculo válido) é tratado como visitante também no servidor
  const categoria = pessoa ? (pessoa.categoria === 'morador' ? 'visitante' : pessoa.categoria) : undefined;
  const meiosPermitidos = categoria ? meiosAceitos(categoria, emArea ? 'area_comum' : 'unidade') : [];
  const semCpf = !!pessoa?.semCpf;

  const dados: DadosAutorizacao | null = pessoa ? {
    categoriaPessoa: categoria!, semCpf, unidadeDestinoId: unidadeAtual, areaComumId: areaAtual, autorizadoPorTipo: meio,
    autorizadoPorPessoaId: meio === 'interfone' || meio === 'morador_presente' ? residenteId : null,
    autorizacaoPreviaId: meio === 'autorizacao_previa' ? previaValida?.id ?? null : null, justificativa,
  } : null;
  // Mesma função pura que o "servidor" usa: o botão só habilita se a regra passar
  const regraOk = !!dados && quando !== null && podeConfirmarEntrada(dados, {
    quando, moradoresValidosIds: new Set(autorizadores.map((a) => a.pessoa.id)), autorizacoes: previas, funcionario: funcionario ?? undefined,
  });
  // Morador não registra entrada na própria unidade no MVP; em outra unidade segue como visitante
  const propriaUnidade = !!pessoa && !!unidadeAtual && pessoa.unidadesVinculadas.includes(unidadeAtual);
  const pronto = !!pessoa && !propriaUnidade && regraOk && retroValido && (!retroativo || formulario.trim().length > 0) && !carregandoUnidade && !restricao && !enviando;

  const confirmar = useCallback(async () => {
    if (!pessoa || !dados || !pronto) return;
    setEnviando(true); setErro('');
    try {
      const ev = await api.eventos.criar({
        pessoaId: pessoa.id, unidadeDestinoId: unidadeAtual, areaComumId: areaAtual, autorizadoPorTipo: dados.autorizadoPorTipo,
        autorizadoPorPessoaId: dados.autorizadoPorPessoaId, autorizacaoPreviaId: dados.autorizacaoPreviaId,
        justificativa: meio === 'excecao_porteiro' ? justificativa : null, retroativo,
        ocorridoEm: retroativo ? quando : null, formularioContingencia: retroativo ? formulario.trim() : null,
      });
      const via = { interfone: 'via interfone', morador_presente: 'com o morador presente na portaria', autorizacao_previa: 'via autorização prévia', excecao_porteiro: 'por exceção do porteiro (justificativa registrada)', escala: 'por escala' }[meio!];
      const quem = ev.autorizadoPorTipo === 'excecao_porteiro' || ev.autorizadoPorTipo === 'escala' ? '' : `autorizada por ${ev.autorizadoPorNome ?? '—'} `;
      avisar({
        tom: ev.autorizadoPorTipo === 'excecao_porteiro' ? 'ambar' : 'verde',
        titulo: retroativo ? 'Lançamento retroativo registrado' : 'Entrada registrada',
        texto: `${retroativo ? `Acesso de ${fmtData(ev.ocorridoEm)} ${fmtHora(ev.ocorridoEm)}, lançado` : 'Entrada registrada'} às ${fmtHora(ev.registradoEm)} por ${ROTULO_PAPEL[usuario!.papel]} ${usuario!.nome} — ${quem}${via} (${ev.codigo}).`,
      });
      void invalidar(APOS_EVENTO);
      nav('/painel');
    } catch (e) {
      if (ehApiError(e) && e.code === 'PESSOA_EM_RESTRICAO') {
        // O servidor já gravou o "negado": guarda o evento para o modal não gravar de novo
        const det = e.detalhes as { restricoes: RestricaoView[]; eventoId: string; codigo: string };
        setNegadoGravado({ eventoId: det.eventoId, codigo: det.codigo });
        setRestricao(det.restricoes);
        void invalidar(APOS_EVENTO); // o negado já está na trilha
      } else setErro(mensagemErro(e));
      setEnviando(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pessoa, dados, pronto, api, unidadeAtual, areaAtual, meio, justificativa, retroativo, quando, formulario, usuario]);

  // Correção 13: Enter confirma sempre que o registro estiver completo (exceto em campo de texto longo)
  const confirmarRef = useRef(confirmar);
  confirmarRef.current = confirmar;
  const prontoRef = useRef(pronto);
  prontoRef.current = pronto;
  const algoPreenchido = !!pessoa || novoModo || query.length > 0;
  const algoRef = useRef(algoPreenchido);
  algoRef.current = algoPreenchido;
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (temModalAberto()) return;
      const alvo = e.target as HTMLElement;
      if (e.key === 'Enter') {
        if (!prontoRef.current || alvo.tagName === 'TEXTAREA' || alvo.id === 'busca-pessoa') return;
        e.preventDefault(); e.stopPropagation();
        void confirmarRef.current();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (algoRef.current) limpar(); else nav('/painel');
      }
    }
    document.addEventListener('keydown', tecla, true);
    return () => document.removeEventListener('keydown', tecla, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cadastrarNova(e: FormEvent) {
    e.preventDefault();
    setErroNp('');
    try {
      const input: NovaPessoaInput = {
        nome: np.nome, documento: np.semCpf ? undefined : np.documento, telefone: np.telefone, semCpf: np.semCpf, categoria: np.categoria,
        empresa: np.categoria === 'prestador' ? np.empresa : undefined, servico: np.categoria === 'prestador' ? np.servico : undefined,
      };
      const criada = await api.pessoas.criar(input);
      setNovoModo(false); setNp(NP_VAZIA);
      await escolherPessoa({ ...criada, ultimoAcesso: 'Sem acessos', unidadesVinculadas: [], unidadesVinculadasCodigos: [] });
      avisar({ texto: `${criada.nome} cadastrado(a) como ${ROTULO_CATEGORIA[criada.categoria].toLowerCase()}.` });
    } catch (err) { setErroNp(mensagemErro(err)); }
  }

  // Modal de restrição: ambos os caminhos gravam o evento "negado" (a gravação ocorre no servidor)
  // Se a restrição veio no 422 da confirmação, o servidor já gravou o negado: NÃO chamar eventos.criar de novo.
  async function resolverRestricao(registrarOcorrencia: boolean) {
    if (!pessoa) return;
    let eventoId: string, codigo: string;
    try {
      ({ eventoId, codigo } = await garantirNegado(negadoGravado, async () => {
        try {
          await api.eventos.criar({ pessoaId: pessoa.id, unidadeDestinoId: unidadeAtual, areaComumId: areaAtual, autorizadoPorTipo: null, retroativo, ocorridoEm: retroativo ? quando : null, formularioContingencia: retroativo ? formulario.trim() || null : null });
          return { eventoId: '', codigo: '' };
        } catch (e) {
          if (ehApiError(e) && e.code === 'PESSOA_EM_RESTRICAO') {
            const d = e.detalhes as { eventoId: string; codigo: string };
            return { eventoId: d.eventoId, codigo: d.codigo };
          }
          throw e;
        }
      }));
    } catch (e) { setErro(mensagemErro(e)); setRestricao(null); return; }
    void invalidar(APOS_EVENTO);
    const nome = pessoa.nome;
    const onde = codUnidade ? `na ${codUnidade}` : areaAtual ? `na área comum ${catalogo.areaNome(areaAtual)}` : 'no condomínio';
    setRestricao(null); setNegadoGravado(null);
    avisar({ tom: 'vermelho', titulo: 'Entrada negada', texto: `${nome} não entrou ${onde}. Tentativa gravada na trilha (${codigo}).` });
    if (registrarOcorrencia) {
      nav(`/ocorrencias?novo=1&tipo=tentativa_acesso_indevido${codUnidade ? `&unidade=${codUnidade}` : ''}&envolvidos=${encodeURIComponent(nome)}&evento=${eventoId}`);
    } else if (unidadeAtual || areaAtual) {
      setTorre(null); setNumero(null); setMeio(null); setAreaId('');
      setTimeout(() => pickerRef.current?.focusTorre(), 0);
    } else {
      limpar(); // funcionário sem unidade: nada a refazer na unidade, recomeça pela pessoa
    }
  }

  // UC02 A4: o morador recusou a visita. Grava o evento "recusado" e limpa a tela.
  const podeRecusar = !!pessoa && !!unidadeAtual && (meio === 'interfone' || meio === 'morador_presente') && !!residenteId
    && retroValido && (!retroativo || formulario.trim().length > 0) && !carregandoUnidade && !restricao && !enviando && !recusando;
  async function registrarRecusa() {
    if (!podeRecusar || !pessoa || !unidadeAtual || (meio !== 'interfone' && meio !== 'morador_presente')) return;
    setRecusando(true); setErro('');
    try {
      const ev = await api.eventos.registrarRecusa({
        pessoaId: pessoa.id, unidadeDestinoId: unidadeAtual, meio, moradorPessoaId: residenteId!, retroativo,
        ocorridoEm: retroativo ? quando : null, formularioContingencia: retroativo ? formulario.trim() : null,
      });
      avisar({ tom: 'ambar', titulo: 'Recusa registrada', texto: `${ev.autorizadoPorNome} recusou a visita de ${pessoa.nome} à ${codUnidade} (${ev.codigo}). Nenhuma entrada foi registrada.` });
      void invalidar(APOS_EVENTO);
      limpar();
    } catch (e) { setErro(mensagemErro(e)); } finally { setRecusando(false); }
  }

  const pr = restricao?.[0];

  // Resumo do registro (coluna direita)
  const residente = autorizadores.find((a) => a.pessoa.id === residenteId)?.pessoa.nome;
  const autorizadoPor = !meio ? '—'
    : meio === 'excecao_porteiro' ? `${usuario!.nome} (exceção do porteiro)`
    : meio === 'escala' ? 'Escala do condomínio'
    : meio === 'autorizacao_previa' ? (previaValida ? (previaValida.areaComumId ? `Área comum — cadastrada por ${previaValida.cadastradaPorNome}` : previaValida.semSolicitante ? `Sem solicitante — cadastrada por ${previaValida.cadastradaPorNome}` : previaValida.solicitadaPorNome) ?? '—' : '—')
    : residente ?? '—';
  const faltas: string[] = [];
  if (!pessoa) faltas.push('pessoa');
  else {
    if (propriaUnidade) faltas.push('outra unidade de destino (morador não registra entrada na própria)');
    else if (emArea && !areaAtual) faltas.push('área comum');
    else if (!emArea && !unidadeAtual && pessoa.categoria !== 'funcionario') faltas.push('unidade');
    else if (carregandoUnidade) faltas.push('verificação da unidade');
    if (!meio && !carregandoUnidade && (unidadeAtual || areaAtual || pessoa.categoria === 'funcionario')) faltas.push('quem autorizou');
    else if ((meio === 'interfone' || meio === 'morador_presente') && !residenteId) faltas.push('morador que autorizou');
    else if (meio === 'excecao_porteiro' && !justificativaValida(justificativa)) faltas.push(`justificativa (mín. ${MIN_JUSTIFICATIVA} caracteres)`);
  }
  if (retroativo) {
    if (!horaReal) faltas.push('hora real do acesso');
    else if (!retroValido) faltas.push('hora real anterior ao momento atual');
    if (!formulario.trim()) faltas.push('nº do formulário de papel');
  }
  if (faltas.length === 0 && !pronto && !enviando && !restricao) faltas.push('autorização válida para este momento');

  const LABEL_MEIO: Record<MeioAutorizacao, [string, string]> = {
    interfone: ['Interfone', 'Morador confirma pelo interfone'],
    morador_presente: ['Morador presente', 'Morador está na portaria'],
    autorizacao_previa: ['Autorização prévia', emArea ? 'Cadastrada pela administração' : 'Cadastrada antes pelo morador'],
    excecao_porteiro: ['Exceção do porteiro', 'Sem morador; exige justificativa'],
    escala: ['Escala', 'Funcionário em horário de escala'],
  };
  const meiosVisiveis = (['interfone', 'morador_presente', 'autorizacao_previa', 'excecao_porteiro', 'escala'] as MeioAutorizacao[]).filter((m) => meiosPermitidos.includes(m));
  const rotuloResumo = 'text-[13px] text-[#56616B]';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo={retroativo ? 'Lançar registro retroativo' : 'Registrar entrada'}
        descricao={retroativo
          ? 'Contingência (UC08): lance o acesso anotado no papel durante a queda do sistema, com a data e a hora reais.'
          : 'Pessoa, unidade e quem autorizou. O registro não pode ser editado depois de confirmado.'} />

      <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-5">
        <div className="flex flex-col gap-4">
          {retroativo && (
            <section className="rounded-[10px] border border-[#A9D2D8] bg-[#F0F8F9] p-5">
              <h2 className="mb-[14px] flex items-center gap-2 text-[17px] font-semibold"><History className="h-5 w-5 text-[#0B5563]" aria-hidden />Data e hora reais do acesso</h2>
              <div className="grid grid-cols-3 gap-[14px]">
                <Field label="Data real do acesso"><input type="date" className="input" value={dataReal} max={toInputDate(agora)} onChange={(e) => setDataReal(e.target.value)} /></Field>
                <Field label="Hora real do acesso" erro={horaReal && !retroValido ? 'Deve ser anterior ao momento atual.' : undefined}>
                  <input type="time" className="input" value={horaReal} max={dataReal === toInputDate(agora) ? toInputTime(agora) : undefined} onChange={(e) => setHoraReal(e.target.value)} />
                </Field>
                <Field label="Nº do formulário de papel" dica="Obrigatório. Fica registrado no próprio evento (entra no hash)."><input className="input" value={formulario} onChange={(e) => setFormulario(e.target.value)} /></Field>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[14px] text-[#0B4450]"><Clock className="h-4 w-4" aria-hidden />A hora do lançamento ({fmtHora(agora)}) é definida pelo sistema e gravada junto, com a etiqueta Retroativo.</p>
            </section>
          )}

          <CartaoPasso n={1} titulo="Pessoa">
            {!pessoa && !novoModo && (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-[14px] top-[14px] h-5 w-5 text-[#56616B]" strokeWidth={2} aria-hidden />
                  <label htmlFor="busca-pessoa" className="sr-only">Buscar por nome, documento ou placa</label>
                  <input id="busca-pessoa" ref={buscaRef} autoComplete="off" role="combobox" aria-expanded={sugestoes.length > 0}
                    aria-controls="lista-sugestoes" aria-activedescendant={sugestoes[idx] ? `sug-${sugestoes[idx].id}` : undefined}
                    className="h-12 w-full rounded-lg border border-[#9AA7B0] bg-white pl-11 pr-[14px] text-[16px] text-ink placeholder:text-[#56616B]/70"
                    value={query} onChange={(e) => { enterPendente.current = false; setQuery(e.target.value); }} placeholder="Nome, CPF ou placa da pessoa"
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, sugestoes.length - 1)); }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
                      else if (e.key === 'Enter') { e.preventDefault(); if (sugestoes[idx]) void escolherPessoa(sugestoes[idx]); else if (query.trim()) enterPendente.current = true; }
                    }} />
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  <ul id="lista-sugestoes" role="listbox" aria-label="Pessoas encontradas" className="flex flex-col gap-1 empty:hidden">
                    {sugestoes.map((p, i) => (
                      <li key={p.id} id={`sug-${p.id}`} role="option" aria-selected={i === idx}>
                        <button type="button" tabIndex={-1} onClick={() => void escolherPessoa(p)} onMouseEnter={() => setIdx(i)}
                          className={`grid min-h-[56px] w-full grid-cols-[44px_minmax(0,1fr)_150px_110px_190px] items-center gap-3 rounded-lg border px-[10px] py-[6px] text-left hover:bg-[#EEF5F6] ${
                            i === idx ? 'border-[#0B5563] bg-[#F0F8F9]' : 'border-[#E1E6EA] bg-white'}`}>
                          <Avatar nome={p.nome} />
                          <span className="truncate font-semibold">{p.nome}</span>
                          <span className="font-mono text-[14px] text-[#33424B]">{p.documentoMascarado}</span>
                          <span className="truncate text-[14px]">{rotuloPessoa(p)}</span>
                          <span className="truncate text-[13px] text-[#56616B]">Último: {p.ultimoAcesso}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {mais && <p className="px-0.5 py-1 text-[13px] text-[#56616B]">Mais resultados — refine a busca</p>}
                  {query.trim() && !buscando && sugestoes.length === 0 && <p className="px-0.5 py-1 text-[#56616B]">Nenhuma pessoa encontrada com “{query}”.</p>}
                  <button type="button" onClick={() => { setNovoModo(true); setNp({ ...NP_VAZIA, nome: query }); }}
                    className="flex min-h-[48px] items-center gap-[10px] rounded-lg border border-dashed border-[#9AA7B0] bg-white px-3 text-left font-semibold text-[#0B5563] hover:bg-[#EEF5F6]">
                    <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />Pessoa sem cadastro
                  </button>
                  {sugestoes.length === 0 && !query.trim() && <div className="px-0.5 py-1 text-[13px] text-[#56616B]">Digite o nome ou o documento. Use ↑ ↓ para escolher e Enter para selecionar.</div>}
                </div>
              </>
            )}

            {novoModo && !pessoa && (
              <form onSubmit={cadastrarNova} className="grid grid-cols-2 gap-[14px]">
                <Field label="Nome completo" className="col-span-2"><input className="input" autoFocus required value={np.nome} onChange={(e) => setNp({ ...np, nome: e.target.value })} /></Field>
                <Field label="CPF" dica="Só CPF. Guardado mascarado, com hash para busca."><input className="input font-mono" inputMode="numeric" placeholder="000.000.000-00" disabled={np.semCpf} required={!np.semCpf} value={np.documento} onChange={(e) => setNp({ ...np, documento: e.target.value })} /></Field>
                <Field label="Telefone (obrigatório)"><input className="input" inputMode="tel" required placeholder="(11) 9____-____" value={np.telefone} onChange={(e) => setNp({ ...np, telefone: e.target.value })} /></Field>
                <label className="col-span-2 flex cursor-pointer items-start gap-3 rounded-lg border border-[#B9C3CA] p-3">
                  <input type="checkbox" className="mt-1" checked={np.semCpf} onChange={(e) => setNp({ ...np, semCpf: e.target.checked, documento: '' })} />
                  <span><span className="font-medium">Pessoa sem CPF</span><span className="block text-[13px] text-[#56616B]">Exceção: nome e telefone continuam obrigatórios e a pessoa só entra por exceção do porteiro, com justificativa.</span></span>
                </label>
                <Field label="Tipo">
                  <select className="input" value={np.categoria} onChange={(e) => setNp({ ...np, categoria: e.target.value as CategoriaPessoa })}>
                    <option value="visitante">Visitante</option><option value="prestador">Prestador</option>
                  </select>
                </Field>
                {np.categoria === 'prestador' && (
                  <>
                    <Field label="Empresa"><input className="input" required value={np.empresa} onChange={(e) => setNp({ ...np, empresa: e.target.value })} /></Field>
                    <Field label="Serviço"><input className="input" value={np.servico} onChange={(e) => setNp({ ...np, servico: e.target.value })} /></Field>
                  </>
                )}
                <div className="col-span-2 flex items-center gap-[14px] rounded-lg border border-dashed border-[#C5CDD3] p-3">
                  <label htmlFor="foto-np" className="sr-only">Foto (opcional)</label>
                  <input id="foto-np" type="file" accept="image/*" className="!min-h-0 text-[14px]" onChange={(e) => setNp({ ...np, foto: e.target.files?.[0]?.name ?? '' })} />
                  <span className="text-[14px] text-[#56616B]">Opcional — a recusa não impede o cadastro</span>
                </div>
                {erroNp && <Alert tom="vermelho" role="alert" className="col-span-2">{erroNp}</Alert>}
                <div className="col-span-2 flex gap-[10px]">
                  <Button type="submit" variante="primario">Usar este cadastro</Button>
                  <Button onClick={() => { setNovoModo(false); setTimeout(() => buscaRef.current?.focus(), 0); }}>Voltar à busca</Button>
                </div>
              </form>
            )}

            {pessoa && (
              <div className="flex items-center gap-[14px] rounded-lg border border-[#A9D2D8] bg-[#F0F8F9] px-[14px] py-3">
                <Avatar nome={pessoa.nome} tamanho={44} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[16px] font-semibold">{pessoa.nome}</span>
                  <span className="text-[14px] text-[#33424B]"><span className="font-mono">{pessoa.documentoMascarado}</span> · {rotuloPessoa(pessoa)}
                    {pessoa.empresa && <> · {pessoa.empresa}{pessoa.servico ? ` (${pessoa.servico})` : ''}</>} · último acesso: {pessoa.ultimoAcesso}</span>
                </div>
                <Button pequeno onClick={() => limpar()}>Trocar</Button>
              </div>
            )}
          </CartaoPasso>

          <CartaoPasso n={2} titulo="Unidade de destino">
            {!pessoa ? <p className="text-[#56616B]">Escolha a pessoa primeiro.</p> : (
              <div className="flex flex-col gap-3">
                {pessoa.categoria === 'funcionario' && <Alert tom="petroleo">Funcionário do condomínio: a unidade é opcional quando a entrada é por Escala.</Alert>}
                {pessoa.categoria === 'prestador' && (
                  <div role="radiogroup" aria-label="Destino do prestador" className="flex gap-2">
                    {(['unidade', 'area_comum'] as const).map((d) => (
                      <button key={d} type="button" role="radio" aria-checked={destino === d}
                        onClick={() => { setDestino(d); setTorre(null); setNumero(null); setAreaId(''); setPrevias([]); setAutorizadores([]); setMeio(null); setResidenteId(null); setRestricao(null); }}
                        className={`h-10 rounded-full border px-4 text-[14px] font-medium ${destino === d ? 'border-[#0B5563] bg-[#0B5563] text-white' : 'border-[#B9C3CA] bg-white hover:bg-[#EEF2F4]'}`}>
                        {d === 'unidade' ? 'Unidade' : 'Área comum'}
                      </button>
                    ))}
                  </div>
                )}
                {emArea ? (
                  <div className="flex flex-col gap-2">
                    <span id="rot-area" className="text-[14px] font-medium">Área comum</span>
                    <div role="radiogroup" aria-labelledby="rot-area" className="flex flex-wrap gap-2">
                      {catalogo.areasComuns.filter((a) => a.ativo).map((a) => (
                        <button key={a.id} type="button" role="radio" aria-checked={areaId === a.id} onClick={() => { setAreaId(a.id); setRestricao(null); }}
                          className={`h-11 rounded-lg border-2 px-4 font-medium ${areaId === a.id ? 'border-[#0B5563] bg-[#F0F8F9]' : 'border-[#DCE1E5] bg-white hover:border-[#9AA7B0]'}`}>{a.nome}</button>
                      ))}
                    </div>
                    <span className="text-[13px] text-[#56616B]">Na área comum a entrada é por autorização prévia da administração ou por exceção do porteiro (RF-36).</span>
                  </div>
                ) : (
                <TowerUnitPicker ref={pickerRef} torre={torre} numero={numero}
                  onChange={(t, n) => { setTorre(t); setNumero(n); if (!n) { setPrevias([]); setAutorizadores([]); setMeio(null); setResidenteId(null); } }}
                  onAlterar={limparUnidade}
                  onComplete={() => { /* o efeito de [unidade] consulta restrições e autorizações */ }} />
                )}
                {propriaUnidade && <Alert tom="ambar" role="alert">Morador não registra entrada na própria unidade no MVP.</Alert>}
              </div>
            )}
          </CartaoPasso>

          <CartaoPasso n={3} titulo="Quem autorizou?">
            {!pessoa ? <p className="text-[#56616B]">Escolha a pessoa e a unidade. O sistema verifica restrições e autorizações prévias antes de liberar esta etapa.</p>
              : !unidadeAtual && !areaAtual && pessoa.categoria !== 'funcionario' ? <p className="text-[#56616B]">Escolha a pessoa e a unidade. O sistema verifica restrições e autorizações prévias antes de liberar esta etapa.</p>
              : carregandoUnidade ? <p className="text-[#56616B]">Verificando restrições e autorizações…</p> : (
                <div className="flex flex-col gap-[14px]">
                  {previaValida && (
                    <div role="status" className="flex items-start gap-3 rounded-[10px] border border-[#75E0A7] bg-[#DCFAE6] p-4 text-[#05603A]">
                      <Check className="h-[22px] w-[22px] shrink-0" strokeWidth={2.4} aria-hidden />
                      <div className="flex flex-col gap-1">
                        <span className="text-[16px] font-semibold">Autorização prévia {previaValida.areaComumId ? 'da administração' : previaValida.semSolicitante ? 'sem solicitante' : `de ${previaValida.solicitadaPorNome}`} ({previaValida.unidadeRotulo}), válida até {fmtData(previaValida.validaAte)}, {descreverJanela(previaValida)}.</span>
                        <span className="text-[14px]">Autorizador preenchido automaticamente. Sem restrições para esta unidade.</span>
                      </div>
                    </div>
                  )}
                  {previaFora && (
                    <Alert tom="ambar" titulo={`Autorização prévia fora do horário (${descreverHorario(previaFora)})`} role="status">
                      Válida até {fmtData(previaFora.validaAte)}, {descreverJanela(previaFora)}. Neste momento ela não vale: escolha outro meio de autorização.
                    </Alert>
                  )}

                  {semCpf && <Alert tom="ambar" titulo="Pessoa cadastrada sem CPF">Só pode entrar por exceção do porteiro, com justificativa. Interfone, morador presente e autorização prévia ficam desabilitados.</Alert>}

                  <fieldset ref={grupoMeioRef} className="grid gap-[10px]" style={{ gridTemplateColumns: `repeat(${Math.max(meiosVisiveis.length, 1)}, minmax(0, 1fr))` }}>
                    <legend className="sr-only">Meio de autorização</legend>
                    {meiosVisiveis.map((m) => {
                      const bloqueioSemCpf = semCpf && m !== 'excecao_porteiro';
                      const desabilitado = (m === 'autorizacao_previa' && !previaValida) || bloqueioSemCpf;
                      const [titulo, desc] = LABEL_MEIO[m];
                      return (
                        <label key={m} className={`flex min-h-[76px] flex-col gap-1 rounded-[10px] border-2 p-3 text-left [&:has(:focus-visible)]:outline [&:has(:focus-visible)]:outline-[3px] [&:has(:focus-visible)]:outline-offset-2 [&:has(:focus-visible)]:outline-[#0B5563] ${
                          meio === m ? 'border-[#0B5563] bg-[#F0F8F9]' : 'border-[#DCE1E5] bg-white'} ${desabilitado ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-[#9AA7B0]'}`}>
                          <input type="radio" name="meio" className="sr-only" disabled={desabilitado} checked={meio === m}
                            onChange={() => { setMeio(m); setResidenteId(null); }} />
                          <span className="font-semibold">{titulo}</span>
                          <span className="text-[13px] text-[#56616B]">{desabilitado ? (bloqueioSemCpf ? 'Pessoa sem CPF' : previaFora ? 'Fora da janela de horário' : 'Sem autorização válida') : desc}</span>
                        </label>
                      );
                    })}
                  </fieldset>

                  {(meio === 'interfone' || meio === 'morador_presente') && (
                    <div className="flex flex-col gap-2">
                      <span id="rot-morador" className="text-[14px] font-medium">Morador que autorizou <span className="text-[#B42318]">*</span> <span className="font-normal text-[#56616B]">· somente vínculo aprovado na {codUnidade}</span></span>
                      {autorizadores.length === 0
                        ? <Alert tom="ambar">Nenhum morador com vínculo válido nesta unidade. Vínculo pendente não dá acesso de morador. Use outro meio.</Alert>
                        : (
                          <div role="radiogroup" aria-labelledby="rot-morador" className="flex flex-wrap gap-2">
                            {autorizadores.map((a) => (
                              <label key={a.pessoa.id} className={`flex h-11 cursor-pointer items-center gap-2 rounded-lg border-2 px-4 [&:has(:focus-visible)]:outline [&:has(:focus-visible)]:outline-[3px] [&:has(:focus-visible)]:outline-offset-2 [&:has(:focus-visible)]:outline-[#0B5563] ${
                                residenteId === a.pessoa.id ? 'border-[#0B5563] bg-[#F0F8F9]' : 'border-[#DCE1E5] bg-white hover:border-[#9AA7B0]'}`}>
                                <input type="radio" name="morador" className="sr-only" checked={residenteId === a.pessoa.id} onChange={() => setResidenteId(a.pessoa.id)} />
                                <span className="font-medium">{a.pessoa.nome}</span>
                                <span className="text-[13px] text-[#56616B]">{a.vinculo.tipo === 'proprietario' ? 'Proprietário(a)' : a.vinculo.tipo === 'inquilino' ? 'Inquilino(a)' : 'Dependente'}</span>
                                {a.vinculo.status === 'legado' && <SeloVinculo status="legado" tamanho="xs" />}
                              </label>
                            ))}
                          </div>
                        )}
                    </div>
                  )}

                  {(meio === 'interfone' || meio === 'morador_presente') && residenteId && (
                    <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-dashed border-[#C5CDD3] px-4 py-3">
                      <Button disabled={!podeRecusar} carregando={recusando} onClick={() => void registrarRecusa()}>Morador recusou</Button>
                      <span className="text-[13px] text-[#56616B]">O morador não autorizou a visita: grava o evento “Recusado” na trilha, sem registrar entrada, e limpa a tela.</span>
                    </div>
                  )}

                  {meio === 'excecao_porteiro' && (
                    <div className="flex flex-col gap-3 rounded-[10px] border border-[#FEC84B] bg-[#FEF0C7] p-4 text-[#93370D]">
                      <div className="flex items-start gap-[10px]">
                        <AlertTriangle className="h-[22px] w-[22px] shrink-0" strokeWidth={2.2} aria-hidden />
                        <div>
                          <div className="text-[16px] font-semibold">Liberação por exceção</div>
                          <div className="text-[14px] text-[#7A2E0E]">Esta entrada ficará marcada como exceção, com {usuario!.nome} como responsável, e aparecerá no relatório de exceções.</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {SUGESTOES_EXCECAO.map((s) => (
                          <button key={s} type="button" onClick={() => setJustificativa(s)} className="h-9 rounded-full border border-[#F5B54A] bg-white px-3 text-[14px] text-[#7A2E0E] hover:bg-[#FFF8E6]">{s}</button>
                        ))}
                      </div>
                      <label htmlFor="just" className="flex flex-col gap-1.5 text-[14px] font-medium text-[#7A2E0E]">Justificativa (obrigatória, mínimo {MIN_JUSTIFICATIVA} caracteres)
                        <textarea id="just" rows={3} className="input !border-[#F5B54A] font-normal" value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
                      </label>
                      <span className="text-[13px] text-[#7A2E0E]">{justificativa.trim().length} de {MIN_JUSTIFICATIVA} caracteres{justificativaValida(justificativa) ? ' — suficiente' : ''}</span>
                    </div>
                  )}

                  {meio === 'escala' && (
                    funcionario && escalaVigente(funcionario, quando ?? agora)
                      ? <Alert tom="verde" role="status">{funcionario.funcao} em horário de escala ({funcionario.escala.horaInicio}–{funcionario.escala.horaFim}, {descreverJanela({ diasSemana: funcionario.escala.diasSemana, horaInicio: null, horaFim: null })}).</Alert>
                      : <Alert tom="ambar">O funcionário não está em horário de escala neste momento.</Alert>
                  )}

                  {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
                </div>
              )}
          </CartaoPasso>
        </div>

        <aside aria-label="Resumo do registro" className="sticky top-0 flex flex-col gap-[14px] rounded-[10px] border border-[#DCE1E5] bg-white p-5">
          <h2 className="text-[17px] font-semibold">Resumo do registro</h2>
          <div className="flex flex-col gap-0.5"><span className={rotuloResumo}>Pessoa</span><span className="font-semibold">{pessoa?.nome ?? '—'}</span></div>
          <div className="flex flex-col gap-0.5"><span className={rotuloResumo}>{emArea ? 'Área comum' : 'Unidade'}</span>
            <span className="font-mono text-[24px] font-semibold text-[#0B3F49]">{unidadeAtual ? catalogo.rotulo(unidadeAtual) : areaAtual ? catalogo.areaNome(areaAtual) : '—'}</span></div>
          <div className="flex flex-col gap-0.5"><span className={rotuloResumo}>Autorizado por</span><span className="font-semibold">{autorizadoPor}</span>
            <span className="text-[14px] text-[#33424B]">{meio ? ROTULO_MEIO[meio] : ''}</span></div>
          {retroativo && (
            <div className="flex flex-col gap-0.5"><span className={rotuloResumo}>Data e hora reais</span>
              <span className="font-semibold">{quando !== null && horaReal ? `${fmtData(quando)} ${fmtHora(quando)}` : '—'}</span></div>
          )}
          <div className="flex flex-col gap-0.5"><span className={rotuloResumo}>Registrado por</span>
            <span className="font-semibold">{ROTULO_PAPEL[usuario!.papel]} {usuario!.nome} · {fmtHora(agora)}</span></div>
          <div className="h-px bg-[#E6EAED]" />
          {pronto ? (
            <button type="button" onClick={() => void confirmar()}
              className="flex h-[52px] items-center justify-center gap-[10px] rounded-lg bg-[#0B5563] text-[16px] font-semibold text-white hover:bg-[#08434E]">
              {retroativo ? 'Confirmar lançamento' : 'Confirmar entrada'} <kbd className="rounded-[5px] border border-white/50 px-[7px] py-0.5 font-mono text-[13px]">Enter</kbd>
            </button>
          ) : (
            <>
              <button type="button" disabled className="h-[52px] cursor-not-allowed rounded-lg border border-[#D5DDE2] bg-[#EEF2F4] text-[16px] font-semibold text-[#6B7780]">
                {enviando ? 'Registrando…' : retroativo ? 'Confirmar lançamento' : 'Confirmar entrada'}
              </button>
              {faltas.length > 0 && <span className="text-[13px] text-[#56616B]">Falta: {faltas.join(', ')}</span>}
            </>
          )}
          <Button atalho="Esc" onClick={() => (algoPreenchido ? limpar() : nav('/painel'))}>Cancelar</Button>
        </aside>
      </div>

      {restricao && pr && pessoa && (
        <Modal titulo={codUnidade ? `Entrada não permitida para ${codUnidade}` : 'Entrada não permitida no condomínio'} tom="vermelho" largura={600} gap={14} tituloId="titulo-restricao" onClose={() => void resolverRestricao(false)}
          rodape={<>
            <Button variante="perigo" grande className="flex-1" onClick={() => void resolverRestricao(true)}>Registrar ocorrência</Button>
            <Button grande atalho="Esc" data-autofocus onClick={() => void resolverRestricao(false)}>Cancelar</Button>
          </>}>
          <div className="text-[18px] font-semibold">{pessoa.nome}</div>
          <div className="flex flex-col gap-0.5"><span className="text-[13px] text-[#56616B]">Motivo registrado pelo morador</span><span className="text-[17px] font-semibold text-[#912018]">“{pr.motivo}”</span></div>
          <div className="grid grid-cols-2 gap-[14px]">
            <div className="flex flex-col gap-0.5"><span className="text-[13px] text-[#56616B]">Restrição solicitada por</span><span className="font-medium">{pr.solicitadaPorNome ?? 'Administração'}</span></div>
            <div className="flex flex-col gap-0.5"><span className="text-[13px] text-[#56616B]">Cadastrada no sistema por</span><span className="font-medium">{pr.cadastradaPorNome} · {fmtData(pr.cadastradaEm)} {fmtHora(pr.cadastradaEm)}</span></div>
          </div>
          {pr.escopo === 'condominio' && <div className="text-[14px] font-medium text-[#912018]">Restrição para todo o condomínio (aprovada pelo síndico).</div>}
          <div className="rounded-lg bg-[#F3F5F6] px-3 py-[10px] text-[14px] text-[#33424B]">A tentativa será gravada na trilha de auditoria com seu nome e horário. Não há opção de liberar: os dois caminhos gravam a tentativa negada.</div>
        </Modal>
      )}
    </div>
  );
}
