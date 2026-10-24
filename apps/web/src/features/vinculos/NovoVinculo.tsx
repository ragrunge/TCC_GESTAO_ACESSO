// Solicitação de vínculo com unidade (RF-03/RF-04), compartilhada pelos dois pontos de entrada:
// - tela da unidade ("Incluir morador" / "Solicitar vínculo"): a unidade é fixa e a pessoa vem do PessoaCombobox;
// - ficha da pessoa ("Vincular a uma unidade"): a pessoa é fixa e a unidade vem de Bloco/Torre -> Apartamento.
// Os dois chamam a MESMA rota (POST /vinculos, `api.vinculos.criar`) com os mesmos campos: pessoa, unidade, tipo e
// vigência. O vínculo nasce PENDENTE; a conferência do comprovante (RF-05, sem guardar arquivo) e a aprovação são
// passos separados, na tela de Vínculos, por síndico/administração (RN-03). A categoria só vira "morador" na aprovação.
// A validação daqui espelha a da API (vinculos.service `criar` + índice vinculo_ativo_uq) só para avisar antes; quem
// decide é a API, e o erro dela (409/422) aparece pelo `mensagemErro`.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ROTULO_VINCULO, type Pessoa, type StatusVinculo, type TipoVinculo, type Unidade, type VinculoUnidade } from '@portaria/domain/types';
import { agora, fmtData, fromInput, toInputDate } from '@portaria/domain/time';
import { andarDoNumero, compararBlocos, compararUnidades, codigoUnidade, rotuloUnidade } from '@portaria/domain/units';
import { useApi, type PessoaBusca, type VinculoView } from '../../api';
import { useCatalogo } from '../../app/catalogo';
import { mensagemErro } from '../../app/useAsync';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { PessoaCombobox } from '../../components/PessoaCombobox';
import { Avatar } from '../../components/UnitTag';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Combobox, type OpcaoCombobox } from '../../components/ui/combobox';
import { Label } from '../../components/ui/label';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';

/** Status que impedem um vínculo novo da mesma pessoa com a mesma unidade (índice parcial vinculo_ativo_uq). */
export const STATUS_QUE_BLOQUEIAM: readonly StatusVinculo[] = ['pendente', 'aprovado', 'legado'];
const TIPOS: readonly TipoVinculo[] = ['proprietario', 'inquilino', 'dependente'];
const DICA_TIPO: Record<TipoVinculo, string> = {
  proprietario: 'Fim da vigência opcional.',
  inquilino: 'Exige data de fim da vigência.',
  dependente: 'Menor de idade dispensa CPF e telefone na aprovação.',
};

/** Vínculo já existente (pendente, aprovado ou legado) da pessoa com a unidade: a API recusaria com 409. */
export function vinculoQueBloqueia(vinculos: readonly VinculoView[] | null | undefined, pessoaId: string, unidadeId: string) {
  return vinculos?.find((v) => v.pessoaId === pessoaId && v.unidadeId === unidadeId && STATUS_QUE_BLOQUEIAM.includes(v.status));
}

/** Motivo para não oferecer a combinação pessoa + unidade; null = pode. `unidadesValidas`: o que a busca de pessoas devolve. */
export function motivoConflito(vinculos: readonly VinculoView[] | null | undefined, pessoaId: string, unidadeId: string, unidadesValidas?: readonly string[]): string | null {
  const v = vinculoQueBloqueia(vinculos, pessoaId, unidadeId);
  if (v) return `Já tem vínculo ${v.status} com esta unidade`;
  if (unidadesValidas?.includes(unidadeId)) return 'Já tem vínculo válido com esta unidade';
  return null;
}

export interface RascunhoVinculo {
  pessoa: Pick<Pessoa, 'id' | 'desativadaEm' | 'anonimizadaEm'> | null;
  unidade: Pick<Unidade, 'id' | 'ativo' | 'bloco' | 'numero'> | null;
  tipo: TipoVinculo;
  /** "AAAA-MM-DD" ou vazio. */
  inicio: string;
  fim: string;
  conflito: string | null;
}
export type ErrosVinculo = Partial<Record<'pessoa' | 'unidade' | 'fim', string>>;

/** As mesmas recusas da API (422/409), em texto para o campo. Vazio = pode seguir para a revisão. */
export function validarNovoVinculo(r: RascunhoVinculo): ErrosVinculo {
  const e: ErrosVinculo = {};
  if (!r.pessoa) e.pessoa = 'Escolha a pessoa.';
  else if (r.pessoa.anonimizadaEm) e.pessoa = 'Cadastro anonimizado não recebe vínculo.';
  else if (r.pessoa.desativadaEm) e.pessoa = 'Cadastro desativado: reative a pessoa antes de vincular.';
  if (!r.unidade) e.unidade = 'Escolha a unidade.';
  else if (!r.unidade.ativo) e.unidade = `A unidade ${codigoUnidade(r.unidade)} está desativada.`;
  else if (r.conflito) e.unidade = `${r.conflito}: não dá para duplicar.`;
  if (r.tipo === 'inquilino' && !r.fim) e.fim = 'Inquilino exige data de fim da vigência.';
  else if (r.inicio && r.fim && r.fim < r.inicio) e.fim = 'O fim da vigência não pode ser anterior ao início.';
  return e;
}

/** Bloco/Torre e depois Apartamento, do catálogo (inclui as desativadas, como indisponíveis). */
export function UnidadeSeletor({ valor, onChange, motivo, erro }: {
  valor: string | null; onChange: (unidadeId: string | null) => void;
  /** Motivo para o apartamento não poder ser escolhido (ex.: a pessoa já tem vínculo com ele). */
  motivo?: (u: Unidade) => string | null; erro?: string;
}) {
  const { unidades, agrupamento, porId } = useCatalogo();
  const atual = porId(valor);
  const [bloco, setBloco] = useState<string | null>(atual?.bloco ?? null);
  const aptoRef = useRef<HTMLButtonElement>(null);
  const blocos = useMemo((): OpcaoCombobox[] => {
    const por = new Map<string, { total: number; ativas: number }>();
    for (const u of unidades) {
      const c = por.get(u.bloco) ?? { total: 0, ativas: 0 };
      c.total++; if (u.ativo) c.ativas++;
      por.set(u.bloco, c);
    }
    return [...por.entries()].sort((a, b) => compararBlocos(a[0], b[0])).map(([b, c]) => ({
      valor: b, rotulo: `${agrupamento} ${b}`, palavras: [b],
      detalhe: `${c.ativas} apartamento(s) ativo(s)`, indisponivel: c.ativas ? undefined : 'Sem apartamento ativo',
    }));
  }, [unidades, agrupamento]);
  const aptos = useMemo((): OpcaoCombobox[] => (bloco ? unidades.filter((u) => u.bloco === bloco) : []).sort(compararUnidades).map((u) => {
    const andar = andarDoNumero(u.numero);
    return {
      valor: u.id, rotulo: `AP ${u.numero}`, palavras: [u.numero, codigoUnidade(u), `AP ${u.numero}`],
      detalhe: andar === 0 ? 'Térreo' : `${andar}º andar`,
      indisponivel: !u.ativo ? 'Desativada' : motivo?.(u) ?? undefined,
    };
  }), [unidades, bloco, motivo]);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Combobox rotulo={agrupamento} placeholder={`Escolha ${agrupamento === 'Torre' ? 'a torre' : 'o bloco'}`} opcoes={blocos} valor={bloco}
        buscaPlaceholder={`${agrupamento} (ex.: ${blocos[0]?.valor ?? 'A'})`} vazio={`Nenhum(a) ${agrupamento.toLowerCase()} com esse nome.`}
        onChange={(b) => { setBloco(b); if (atual?.bloco !== b) onChange(null); }} aposEscolher={() => aptoRef.current?.focus()} />
      <Combobox ref={aptoRef} rotulo="Apartamento" placeholder={bloco ? 'Escolha o apartamento' : `Escolha ${agrupamento === 'Torre' ? 'a torre' : 'o bloco'} antes`}
        opcoes={aptos} valor={valor} desabilitado={!bloco} buscaPlaceholder="Número (ex.: 101)" vazio="Nenhum apartamento com esse número."
        onChange={(id) => onChange(id)} erro={erro} dica={bloco ? `${aptos.length} apartamento(s) ${agrupamento === 'Torre' ? 'na torre' : 'no bloco'} ${bloco}.` : undefined} />
    </div>
  );
}

export interface NovoVinculoProps {
  /** "Incluir morador", "Solicitar vínculo" ou "Vincular a uma unidade". */
  titulo: string;
  /** Ficha: a pessoa já está escolhida. */
  pessoaFixa?: Pessoa;
  /** Tela da unidade: a unidade já está escolhida (a do detalhe, mesmo que o catálogo ainda não a tenha). */
  unidadeFixa?: Pick<Unidade, 'id' | 'bloco' | 'numero' | 'ativo'>;
  /** Vínculos já conhecidos da tela (os da unidade ou os da pessoa): marcam o que duplicaria. */
  vinculosConhecidos?: readonly VinculoView[] | null;
  /** Oferece "Cadastrar nova pessoa" no seletor: devolve o formulário de cadastro que fica no lugar deste. */
  cadastro?: (a: { texto: string; onEscolhida: (p: PessoaBusca) => void; onVoltar: () => void }) => ReactNode;
  onClose: () => void;
  onFeito: (v: VinculoUnidade, resumo: string) => void;
}

/** Formulário -> revisão -> envio. Um modal só (dois empilhados quebrariam o foco); o cadastro de pessoa entra no lugar. */
export function NovoVinculoModal({ titulo, pessoaFixa, unidadeFixa, vinculosConhecidos, cadastro, onClose, onFeito }: NovoVinculoProps) {
  const api = useApi();
  const catalogo = useCatalogo();
  const [pessoaBusca, setPessoaBusca] = useState<PessoaBusca | null>(null);
  const [unidadeId, setUnidadeId] = useState<string | null>(unidadeFixa?.id ?? null);
  const [tipo, setTipo] = useState<TipoVinculo>('proprietario');
  const [ini, setIni] = useState(toInputDate(agora()));
  const [fim, setFim] = useState('');
  const [erros, setErros] = useState<ErrosVinculo>({});
  const [passo, setPasso] = useState<'form' | 'revisao'>('form');
  const [erroApi, setErroApi] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [cadastrando, setCadastrando] = useState<string | null>(null);
  const resumoRef = useRef<HTMLParagraphElement>(null);

  const pessoa = pessoaFixa ?? pessoaBusca;
  const unidade = unidadeFixa ?? catalogo.porId(unidadeId) ?? null;
  const conflito = pessoa && unidadeId ? motivoConflito(vinculosConhecidos, pessoa.id, unidadeId, pessoaBusca?.unidadesVinculadas) : null;
  const rotulo = unidade ? rotuloUnidade(unidade, catalogo.agrupamento, false) : catalogo.codigo(unidadeId);
  const resumo = pessoa ? `Vincular ${pessoa.nome} a ${rotulo} como ${ROTULO_VINCULO[tipo]}` : '';

  useEffect(() => { if (passo === 'revisao') resumoRef.current?.focus(); }, [passo]);

  function continuar(e: FormEvent) {
    e.preventDefault();
    const v = validarNovoVinculo({ pessoa, unidade, tipo, inicio: ini, fim, conflito });
    setErros(v); setErroApi('');
    if (Object.keys(v).length) return;
    setPasso('revisao');
  }
  async function confirmar() {
    if (!pessoa || !unidadeId || enviando) return;
    setEnviando(true); setErroApi('');
    try {
      const v = await api.vinculos.criar({
        pessoaId: pessoa.id, unidadeId, tipo, vigenciaInicio: fromInput(ini)!, vigenciaFim: fim ? fromInput(fim) : null,
        solicitadoPor: '', // sem anexo: o comprovante é conferido e registrado na tela de Vínculos (RF-05) antes da aprovação
      });
      onFeito(v, resumo);
    } catch (err) { setErroApi(mensagemErro(err)); setEnviando(false); }
  }

  if (cadastrando !== null && cadastro) {
    return <>{cadastro({ texto: cadastrando, onVoltar: () => setCadastrando(null), onEscolhida: (p) => { setPessoaBusca(p); setCadastrando(null); setErros({}); } })}</>;
  }

  const rodape = passo === 'form' ? (
    <>
      <Button type="submit" form="f-novo-vinculo" variant="default" size="lg" className="flex-1">Revisar vínculo</Button>
      <Button size="lg" onClick={onClose}>Cancelar</Button>
    </>
  ) : (
    <>
      <Button variant="default" size="lg" className="flex-1" loading={enviando} onClick={() => void confirmar()}>Confirmar vínculo</Button>
      <Button size="lg" disabled={enviando} onClick={() => { setPasso('form'); setErroApi(''); }}>Voltar e corrigir</Button>
    </>
  );

  return (
    <Modal titulo={titulo} onClose={onClose} largura={640} gap={14} rodape={rodape}>
      {unidadeFixa && <div className="font-mono text-[22px] font-semibold text-[#0B3F49]">{codigoUnidade(unidadeFixa)}</div>}
      {passo === 'form' ? (
        <form id="f-novo-vinculo" onSubmit={continuar} noValidate className="flex flex-col gap-[14px]">
          {pessoaFixa ? (
            <div className="flex items-center gap-[14px] rounded-lg border border-primary-borda bg-[#F0F8F9] px-[14px] py-[10px]">
              <Avatar nome={pessoaFixa.nome} tamanho={44} />
              <span className="flex min-w-0 flex-col"><span className="truncate text-[16px] font-semibold">{pessoaFixa.nome}</span>
                <span className="font-mono text-[14px] text-[#33424B]">{pessoaFixa.documentoMascarado}</span></span>
            </div>
          ) : (
            <PessoaCombobox valor={pessoaBusca} autoFocus erro={erros.pessoa}
              onChange={(p) => { setPessoaBusca(p); setErros((x) => ({ ...x, pessoa: undefined, unidade: undefined })); }}
              onCadastrar={cadastro ? setCadastrando : undefined}
              indisponivel={unidadeId ? (p) => motivoConflito(vinculosConhecidos, p.id, unidadeId, p.unidadesVinculadas) : undefined} />
          )}
          {!unidadeFixa && (
            <UnidadeSeletor valor={unidadeId} erro={erros.unidade}
              onChange={(id) => { setUnidadeId(id); setErros((x) => ({ ...x, unidade: undefined })); }}
              motivo={pessoa ? (u) => motivoConflito(vinculosConhecidos, pessoa.id, u.id) : undefined} />
          )}
          {unidadeFixa && erros.unidade && <Alert variant="vermelho" role="alert">{erros.unidade}</Alert>}
          <fieldset className="flex flex-col gap-[6px]">
            <legend id="tipo-vinculo-legenda" className="mb-[6px] text-[14px] font-medium">Tipo de vínculo</legend>
            <RadioGroup value={tipo} onValueChange={(v) => setTipo(v as TipoVinculo)} aria-labelledby="tipo-vinculo-legenda" className="grid-cols-1 sm:grid-cols-3">
              {TIPOS.map((t) => (
                <div key={t} className="flex items-start gap-3 rounded-lg border border-[#B9C3CA] bg-white p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-claro">
                  <RadioGroupItem id={`tipo-${t}`} value={t} aria-describedby={`tipo-${t}-d`} className="mt-[2px]" />
                  <span className="flex flex-col">
                    <Label htmlFor={`tipo-${t}`} className="cursor-pointer font-semibold">{ROTULO_VINCULO[t]}</Label>
                    <span id={`tipo-${t}-d`} className="text-[13px] text-[#56616B]">{DICA_TIPO[t]}</span>
                  </span>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Início da vigência" dica="Em branco = sem data de início."><input type="date" className="input" value={ini} onChange={(e) => setIni(e.target.value)} /></Field>
            <Field label={tipo === 'inquilino' ? 'Fim da vigência (obrigatório)' : 'Fim da vigência'} erro={erros.fim}
              dica={tipo === 'inquilino' ? 'Obrigatório para inquilino.' : 'Em branco = indeterminada.'}>
              <input type="date" className={`input ${erros.fim ? 'border-perigo' : ''}`} value={fim} min={ini || undefined} aria-invalid={erros.fim ? true : undefined}
                onChange={(e) => { setFim(e.target.value); setErros((x) => ({ ...x, fim: undefined })); }} />
            </Field>
          </div>
          <Alert variant="neutro">O vínculo nasce <strong>pendente</strong> e só concede acesso depois da conferência do comprovante e da aprovação da administração ou do síndico, em Vínculos.</Alert>
        </form>
      ) : (
        <div className="flex flex-col gap-[14px]">
          <p ref={resumoRef} tabIndex={-1} className="text-[18px] font-semibold outline-none">{resumo}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg border border-[#DCE1E5] px-4 py-3 text-[15px]">
            <dt className="text-[#56616B]">Pessoa</dt><dd className="min-w-0"><span className="font-medium">{pessoa?.nome}</span> · <span className="font-mono">{pessoa?.documentoMascarado}</span></dd>
            <dt className="text-[#56616B]">Unidade</dt><dd className="min-w-0 font-medium">{rotulo}</dd>
            <dt className="text-[#56616B]">Tipo</dt><dd className="min-w-0 font-medium">{ROTULO_VINCULO[tipo]}</dd>
            <dt className="text-[#56616B]">Vigência</dt>
            <dd className="min-w-0">{ini ? `de ${fmtData(fromInput(ini)!)}` : 'sem data de início'} {fim ? `até ${fmtData(fromInput(fim)!)}` : '· indeterminada'}</dd>
          </dl>
          <Alert variant="ambar" title="Fica pendente de aprovação">
            Depois de confirmar, falta na tela <strong>Vínculos</strong>: registrar a conferência do comprovante (sem guardar arquivo) e aprovar. Enquanto pendente, não dá acesso de morador; a pessoa só passa a “Morador” na aprovação.
          </Alert>
          {erroApi && <Alert variant="vermelho" role="alert">{erroApi}</Alert>}
        </div>
      )}
    </Modal>
  );
}
