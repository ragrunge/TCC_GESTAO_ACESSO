// "Novo condomínio": assistente em 4 passos (Condomínio, Unidades, Síndico, Revisar e criar). Cada passo valida antes de
// avançar; voltar mantém tudo (um só rascunho em estado). As unidades vêm por lista colada ou planilha, lidas pelo
// MESMO parser do domain que a API confere de novo. O envio provisiona de ponta a ponta (banco, migrações, chaves,
// unidades, síndico) e só habilita com o provisionador respondendo (GET /plataforma/provisionador/saude).
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UFS } from '@portaria/domain/condominio';
import { ApiError, errosDeCampo } from '../api/cliente';
import { CHAVE_CONDOMINIOS, CHAVE_SAUDE_PROVISIONADOR, type ResultadoCriacao } from '../api/plataforma';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { NativeSelect } from '../components/ui/native-select';
import { Stepper } from '../components/ui/stepper';
import { useSessao } from '../sessao/SessaoMaster';
import { type EstadoSaude, MENSAGEM_PROVISIONADOR, PassoRevisao } from './novo/PassoRevisao';
import { PassoUnidades } from './novo/PassoUnidades';
import {
  comCodigo, comNome, comSindicoLogin, comSindicoNome, errosDoPasso, lerUnidades, montarEntrada, PASSOS, passoDoCampo, type Rascunho, RASCUNHO_VAZIO,
} from './novo/rascunho';
import { SenhaSindicoModal } from './SenhaSindicoModal';

const DESCRICAO_PASSO = [
  'Nome, código de acesso e cidade.',
  'Bloco ou torre, a lista de unidades e as áreas comuns.',
  'Quem recebe o primeiro acesso.',
  'Confira tudo antes de criar.',
];

export function NovoCondominio() {
  const { api } = useSessao();
  const qc = useQueryClient();
  const navegar = useNavigate();
  const [passo, setPasso] = useState(0);
  const [r, setR] = useState<Rascunho>(RASCUNHO_VAZIO);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [confirmado, setConfirmado] = useState(false);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const montado = useRef(false);
  const [focarErro, setFocarErro] = useState(0);

  // Só o que muda a lista: digitar o nome do condomínio não relê 5000 linhas.
  const u = useMemo(() => lerUnidades(r), [r.fonte, r.textoLista, r.textoPlanilha, r.agrupamento]);
  const atualizar = (f: (x: Rascunho) => Rascunho) => setR(f);

  // Foco no título do passo ao trocar (não no primeiro render: aí o foco é da navegação).
  useEffect(() => {
    if (!montado.current) { montado.current = true; return; }
    tituloRef.current?.focus();
  }, [passo]);
  // Foco no primeiro campo com erro depois de uma tentativa de avançar.
  useEffect(() => {
    if (focarErro) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focarErro]);

  const saude = useQuery({
    queryKey: CHAVE_SAUDE_PROVISIONADOR, queryFn: () => api.saudeProvisionador(), enabled: passo === 3, staleTime: 0, gcTime: 0, retry: false,
  });
  const estadoSaude: EstadoSaude = saude.isFetching ? 'verificando' : saude.isError ? 'erro' : saude.data?.disponivel ? 'disponivel' : saude.data ? 'indisponivel' : 'verificando';

  // Sem useMutation de propósito: o resultado traz a senha do síndico, e o React Query guardaria o `data` da mutação no
  // MutationCache. Aqui ele fica só no estado deste componente (e no modal), e some ao fechar.
  const [enviando, setEnviando] = useState(false);
  const [falha, setFalha] = useState<{ mensagem: string; campos: [string, string][] } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [senha, setSenha] = useState<ResultadoCriacao | null>(null);

  function irPara(p: number) {
    setErros({});
    setPasso(p);
  }

  function avancar(ev?: FormEvent) {
    ev?.preventDefault();
    if (passo >= 3) return;
    const e = errosDoPasso(passo, r, u);
    setErros(e);
    if (Object.keys(e).length) { setFocarErro((n) => n + 1); return; }
    irPara(passo + 1);
  }

  async function criar() {
    if (enviando || !confirmado || estadoSaude !== 'disponivel') return;
    // Confere tudo de novo (o Master pode ter voltado e mudado algo).
    for (let p = 0; p < 3; p++) {
      const e = errosDoPasso(p, r, u);
      if (Object.keys(e).length) { setErros(e); setPasso(p); setFocarErro((n) => n + 1); return; }
    }
    setAviso(null);
    setFalha(null);
    setEnviando(true);
    try {
      const res = await api.criarCondominio(montarEntrada(r, u));
      void qc.invalidateQueries({ queryKey: CHAVE_CONDOMINIOS });
      if (res.sindico) setSenha(res);
      else {
        setAviso('Este condomínio já estava provisionado com estes dados: nada mudou e nenhuma senha foi gerada. '
          + 'Para uma nova senha temporária do síndico, use a CLI provisionar-condominio com --nova-senha-sindico (docs/deploy.md, seção 16).');
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PROVISIONADOR_INDISPONIVEL') {
        qc.setQueryData(CHAVE_SAUDE_PROVISIONADOR, { disponivel: false });
        setFalha(e.message === MENSAGEM_PROVISIONADOR ? null : { mensagem: e.message, campos: [] });
      } else {
        const campos = errosDeCampo(e);
        setErros(campos);
        setFalha({ mensagem: e instanceof ApiError ? e.message : 'Não foi possível criar o condomínio.', campos: Object.entries(campos) });
      }
    } finally {
      setEnviando(false);
    }
  }

  const fecharSenha = () => {
    const codigo = senha?.condominio.codigo;
    setSenha(null);
    navegar('/', { state: { destaque: codigo } });
  };

  return (
    <section aria-labelledby="titulo-novo" className="flex max-w-[960px] flex-col gap-5">
      <div>
        <h1 id="titulo-novo" className="text-[24px] font-semibold">Novo condomínio</h1>
        <p className="text-[14px] text-ink-suave">Cria o banco do condomínio, as unidades e o acesso do síndico (senha temporária mostrada uma vez).</p>
      </div>
      <Stepper passos={PASSOS} atual={passo} />

      <form ref={formRef} onSubmit={avancar} noValidate aria-labelledby="titulo-passo" className="flex flex-col gap-5">
        <div>
          <h2 id="titulo-passo" ref={tituloRef} tabIndex={-1} className="text-[20px] font-semibold">{PASSOS[passo]}</h2>
          <p className="text-[14px] text-ink-suave">{DESCRICAO_PASSO[passo]}</p>
        </div>

        {passo === 0 && (
          <Card><CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do condomínio" erro={erros.nome} className="sm:col-span-2">
              <Input autoComplete="off" value={r.nome} onChange={(e) => atualizar((x) => comNome(x, e.target.value))} />
            </Field>
            <Field label="Código do condomínio" erro={erros.codigo} className="sm:col-span-2"
              dica={<>É o que a portaria digita no login; <span className="font-semibold">não muda depois</span>. Sugerido a partir do nome; pode editar (3 a 31 caracteres: minúsculas, números e hífen, começando por letra).</>}>
              <Input className="font-mono sm:max-w-[360px]" autoComplete="off" spellCheck={false} value={r.codigo} onChange={(e) => atualizar((x) => comCodigo(x, e.target.value))} />
            </Field>
            <Field label="Cidade" erro={erros.cidade}>
              <Input autoComplete="off" value={r.cidade} onChange={(e) => atualizar((x) => ({ ...x, cidade: e.target.value }))} />
            </Field>
            <Field label="UF">
              <NativeSelect value={r.uf} onChange={(e) => atualizar((x) => ({ ...x, uf: e.target.value }))}>
                {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </NativeSelect>
            </Field>
          </CardContent></Card>
        )}

        {passo === 1 && <PassoUnidades r={r} atualizar={atualizar} u={u} erros={erros} />}

        {passo === 2 && (
          <Card><CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do síndico" erro={erros['sindico.nome']} className="sm:col-span-2">
              <Input autoComplete="off" value={r.sindicoNome} onChange={(e) => atualizar((x) => comSindicoNome(x, e.target.value))} />
            </Field>
            <Field label="Login do síndico" erro={erros['sindico.login']} className="sm:col-span-2"
              dica="Sugerido a partir do nome (ex.: maria.souza); pode editar. 3 a 40 caracteres: minúsculas, números, ponto, hífen ou sublinhado, começando por letra. O síndico entra com o código do condomínio, este login e a senha temporária.">
              <Input className="font-mono sm:max-w-[360px]" autoComplete="off" spellCheck={false} value={r.sindicoLogin} onChange={(e) => atualizar((x) => comSindicoLogin(x, e.target.value))} />
            </Field>
          </CardContent></Card>
        )}

        {passo === 3 && (
          <PassoRevisao r={r} u={u} onEditar={irPara} saude={estadoSaude}
            erroSaude={saude.error instanceof ApiError ? saude.error.message : saude.isError ? 'Não foi possível consultar o provisionador.' : null}
            onVerificar={() => void saude.refetch()} confirmado={confirmado} onConfirmar={setConfirmado} bloqueado={enviando} />
        )}

        <div aria-live="polite" className="flex flex-col gap-3 empty:hidden">
          {enviando && <Alert variant="petroleo" role="status">Provisionando… (pode levar alguns segundos; não feche a página)</Alert>}
          {falha && (
            <Alert variant="vermelho" role="alert" title="O condomínio não foi criado">
              <p>{falha.mensagem}</p>
              {falha.campos.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {falha.campos.map(([campo, msg]) => (
                    <li key={campo}>{campo}: {msg} <Button size="sm" variant="ghost" onClick={() => irPara(passoDoCampo(campo))}>Ir para {PASSOS[passoDoCampo(campo)]}</Button></li>
                  ))}
                </ul>
              )}
            </Alert>
          )}
          {aviso && <Alert variant="ambar" role="status">{aviso}</Alert>}
        </div>

        <div className="flex flex-wrap items-center gap-[10px] border-t border-linha pt-4">
          {passo > 0 && <Button variant="secondary" onClick={() => irPara(passo - 1)} disabled={enviando}>Voltar</Button>}
          {passo < 3 && <Button type="submit" variant="default">Avançar</Button>}
          {passo === 3 && (
            <Button variant="default" loading={enviando} disabled={!confirmado || estadoSaude !== 'disponivel'} onClick={() => void criar()}>Criar condomínio</Button>
          )}
          <Button variant="ghost" className="ml-auto" onClick={() => navegar('/')} disabled={enviando}>Cancelar</Button>
        </div>
      </form>
      {senha?.sindico && <SenhaSindicoModal codigo={senha.condominio.codigo} nome={senha.condominio.nome} sindico={senha.sindico} onClose={fecharSenha} />}
    </section>
  );
}
