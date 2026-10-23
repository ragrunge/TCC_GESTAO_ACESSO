// Criar condomínio: o formulário equivalente ao JSON da CLI provisionar-condominio (docs/deploy.md §16.2). A prévia das
// unidades usa o MESMO gerarUnidades do domain que a API e a CLI usam. O envio provisiona de ponta a ponta (banco,
// migrações, chaves, estrutura, síndico) e pode levar alguns segundos.
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CODIGO_CONDOMINIO, normalizarCodigoCondominio, UFS } from '@portaria/domain/condominio';
import { AGRUPAMENTOS, AREAS_COMUNS_INICIAIS, type Agrupamento, codigoUnidade, gerarUnidades } from '@portaria/domain/units';
import { ApiError, errosDeCampo } from '../api/cliente';
import { CHAVE_CONDOMINIOS, type NovoCondominio as Dados, type ResultadoCriacao } from '../api/plataforma';
import { useSessao } from '../sessao/SessaoMaster';
import { Alert, Button, Field } from '../ui/ui';
import { SenhaSindicoModal } from './SenhaSindicoModal';

const LOGIN_SINDICO = /^[a-z][a-z0-9._-]{2,39}$/;
const lista = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
const numeros = (s: string) => lista(s).map(Number);

interface Form {
  codigo: string; nome: string; cidade: string; uf: string; plano: string; agrupamento: Agrupamento;
  blocos: string; andares: string; finais: string; ausentes: string; areas: string; sindicoNome: string; sindicoLogin: string;
}
const VAZIO: Form = {
  codigo: '', nome: '', cidade: '', uf: 'SP', plano: 'padrao', agrupamento: 'Bloco', blocos: 'A, B', andares: '1, 2, 3', finais: '1, 2, 3, 4',
  ausentes: '', areas: AREAS_COMUNS_INICIAIS.join('\n'), sindicoNome: '', sindicoLogin: '',
};

/** Form -> corpo da API (mesmo formato do JSON da CLI). */
export function paraEntrada(f: Form): Dados {
  return {
    codigo: normalizarCodigoCondominio(f.codigo), nome: f.nome.trim(), cidade: f.cidade.trim(), uf: f.uf, plano: f.plano.trim() || 'padrao',
    estrutura: { agrupamento: f.agrupamento, blocos: lista(f.blocos).map((b) => b.toUpperCase()), andares: numeros(f.andares), finais: numeros(f.finais), ausentes: lista(f.ausentes).map((a) => a.toUpperCase()) },
    areasComuns: f.areas.split('\n').map((a) => a.trim()).filter(Boolean),
    sindico: { nome: f.sindicoNome.trim(), login: f.sindicoLogin.trim().toLowerCase() },
  };
}

function problemas(f: Form, e: Dados): Record<string, string> {
  const p: Record<string, string> = {};
  if (!CODIGO_CONDOMINIO.test(e.codigo)) p.codigo = '3 a 31 caracteres: letras minúsculas, dígitos e hífen, começando por letra.';
  if (!e.nome) p.nome = 'Informe o nome.';
  if (!e.cidade) p.cidade = 'Informe a cidade.';
  if (e.sindico.nome.length < 3) p['sindico.nome'] = 'Informe o nome do síndico (3 caracteres ou mais).';
  if (!LOGIN_SINDICO.test(e.sindico.login)) p['sindico.login'] = '3 a 40 caracteres, começando por letra (a-z, 0-9, ".", "-", "_").';
  if (!f.blocos.trim()) p.estrutura = 'Informe ao menos um bloco ou torre.';
  return p;
}

export function NovoCondominio() {
  const { api } = useSessao();
  const qc = useQueryClient();
  const navegar = useNavigate();
  const [f, setF] = useState<Form>(VAZIO);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [senha, setSenha] = useState<{ r: ResultadoCriacao } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const campo = (k: keyof Form) => ({ value: f[k], onChange: (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value }) });

  const entrada = useMemo(() => paraEntrada(f), [f]);
  const previa = useMemo(() => {
    try { return { unidades: gerarUnidades({ ...entrada.estrutura }), erro: null }; } catch (e) { return { unidades: [], erro: (e as Error).message }; }
  }, [entrada]);

  // Sem useMutation de propósito: o resultado traz a senha do síndico, e o React Query guardaria o `data` da mutação no
  // MutationCache. Aqui ele fica só no estado deste componente (e no modal), e some ao fechar.
  const [enviando, setEnviando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (enviando) return;
    setAviso(null);
    setFalha(null);
    const p = problemas(f, entrada);
    if (previa.erro) p.estrutura = previa.erro;
    setErros(p);
    if (Object.keys(p).length) return;
    setEnviando(true);
    try {
      const r = await api.criarCondominio(entrada);
      void qc.invalidateQueries({ queryKey: CHAVE_CONDOMINIOS });
      if (r.sindico) setSenha({ r });
      else {
        setAviso('Este condomínio já estava provisionado com estes dados: nada mudou e nenhuma senha foi gerada. '
          + 'Para uma nova senha temporária do síndico, use a CLI provisionar-condominio com --nova-senha-sindico (docs/deploy.md, seção 16).');
      }
    } catch (e) {
      setErros(errosDeCampo(e));
      setFalha(e instanceof ApiError ? e.message : 'Não foi possível criar o condomínio.');
    } finally {
      setEnviando(false);
    }
  }

  const fecharSenha = () => { setSenha(null); navegar('/'); };

  return (
    <section aria-labelledby="titulo-novo" className="flex max-w-[880px] flex-col gap-5">
      <div>
        <h1 id="titulo-novo" className="text-[24px] font-semibold">Novo condomínio</h1>
        <p className="text-[14px] text-ink-suave">Cria o banco do condomínio, a estrutura de unidades e o acesso do síndico (senha temporária mostrada uma vez).</p>
      </div>
      <form onSubmit={enviar} noValidate className="flex flex-col gap-5">
        <fieldset className="grid gap-4 rounded-xl border border-linha bg-white p-5 sm:grid-cols-2">
          <legend className="px-1 text-[16px] font-semibold">Cadastro</legend>
          <Field label="Código do condomínio" erro={erros.codigo} dica="O que a portaria digita no login. Não muda depois.">
            <input className="input font-mono" autoComplete="off" {...campo('codigo')} onBlur={() => setF({ ...f, codigo: normalizarCodigoCondominio(f.codigo) })} />
          </Field>
          <Field label="Nome exibido" erro={erros.nome}><input className="input" {...campo('nome')} /></Field>
          <Field label="Cidade" erro={erros.cidade}><input className="input" {...campo('cidade')} /></Field>
          <Field label="UF"><select className="input" {...campo('uf')}>{UFS.map((u) => <option key={u} value={u}>{u}</option>)}</select></Field>
          <Field label="Plano" dica="Rótulo comercial; as cotas ainda não são aplicadas."><input className="input" {...campo('plano')} /></Field>
        </fieldset>

        <fieldset className="grid gap-4 rounded-xl border border-linha bg-white p-5 sm:grid-cols-2">
          <legend className="px-1 text-[16px] font-semibold">Estrutura de unidades</legend>
          <Field label="Agrupamento">
            <select className="input" {...campo('agrupamento')}>{AGRUPAMENTOS.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          </Field>
          <Field label={`${f.agrupamento === 'Torre' ? 'Torres' : 'Blocos'} (separados por vírgula)`} dica="1 a 3 letras ou dígitos cada (ex.: A, B ou 1, 2, 3)">
            <input className="input" {...campo('blocos')} />
          </Field>
          <Field label="Andares" dica="De 0 a 9 (número = andar × 10 + final)"><input className="input" {...campo('andares')} /></Field>
          <Field label="Finais por andar" dica="De 1 a 9"><input className="input" {...campo('finais')} /></Field>
          <Field label="Unidades que não existem (opcional)" dica={'"01" vale para todos; "A-01" só para um.'} className="sm:col-span-2">
            <input className="input" {...campo('ausentes')} />
          </Field>
          <div className="sm:col-span-2" aria-live="polite">
            {previa.erro || erros.estrutura
              ? <Alert tom="vermelho" role="alert">{erros.estrutura ?? previa.erro}</Alert>
              : <Alert tom="petroleo" titulo={`${previa.unidades.length} unidades`}>
                  <span className="break-words font-mono text-[13px]">{previa.unidades.slice(0, 40).map(codigoUnidade).join(' ')}{previa.unidades.length > 40 ? ' …' : ''}</span>
                </Alert>}
          </div>
          <Field label="Áreas comuns (uma por linha)" className="sm:col-span-2">
            <textarea className="input" rows={4} {...campo('areas')} />
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 rounded-xl border border-linha bg-white p-5 sm:grid-cols-2">
          <legend className="px-1 text-[16px] font-semibold">Síndico (primeiro acesso)</legend>
          <Field label="Nome do síndico" erro={erros['sindico.nome']}><input className="input" autoComplete="off" {...campo('sindicoNome')} /></Field>
          <Field label="Login do síndico" erro={erros['sindico.login']}><input className="input font-mono" autoComplete="off" {...campo('sindicoLogin')} /></Field>
        </fieldset>

        <div aria-live="polite">
          {enviando && <Alert tom="petroleo" role="status">Provisionando… (pode levar alguns segundos; não feche a página)</Alert>}
          {falha && <Alert tom="vermelho" role="alert">{falha}</Alert>}
          {aviso && <Alert tom="ambar" role="status">{aviso}</Alert>}
        </div>
        <div className="flex flex-wrap gap-[10px]">
          <Button type="submit" variante="primario" carregando={enviando}>Criar condomínio</Button>
          <Button variante="secundario" onClick={() => navegar('/')} disabled={enviando}>Voltar</Button>
        </div>
      </form>
      {senha?.r.sindico && <SenhaSindicoModal codigo={senha.r.condominio.codigo} nome={senha.r.condominio.nome} sindico={senha.r.sindico} onClose={fecharSenha} />}
    </section>
  );
}
