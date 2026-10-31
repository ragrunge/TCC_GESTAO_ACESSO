import { useState, type FormEvent } from 'react';
import { Clock, Copy, MessageSquareText, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { type NovoUsuarioInput, type UsuarioComSenhaTemporaria } from '../../api';
import { useAuth, useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Cel, Lista, ListaCab, ListaLinha } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ROTULO_PAPEL, type Papel, type UsuarioSistema } from '@portaria/domain/types';
import { fmtDataHora } from '@portaria/domain/time';
import { mensagemErro, useAgora } from '../../app/useAsync';
import { avisoSenhaTemporaria, mensagemAcesso, validadeTexto } from './senhaTemporaria';
import { useAcoesUsuario, useUsuarios } from './useUsuarios';
import { ErroCarregar } from '../../components/Carregando';

const COLUNAS = 'minmax(0,1.3fr) 160px 150px 140px 270px';

/** Senha temporária em exibição: vive só neste estado local e some ao fechar o modal. */
interface SenhaExibida extends UsuarioComSenhaTemporaria { motivo: 'criado' | 'redefinido' }

export function UsuariosPage() {
  const { usuario: eu } = useAuth();
  const { avisar } = useToast();
  const podeGerenciar = useCan('usuario.gerenciar');
  const lista = useUsuarios(podeGerenciar);
  // Prazo da senha temporária (aviso "vence em"/"vencida"): hora real, reavaliada a cada 30 s.
  const agora = useAgora(30_000);
  const [senha, setSenha] = useState<SenhaExibida | null>(null);
  const acoes = useAcoesUsuario((r, motivo) => setSenha({ ...r, motivo }));
  const [novo, setNovo] = useState(false);
  const [desativar, setDesativar] = useState<UsuarioSistema | null>(null);
  const [redefinir, setRedefinir] = useState<UsuarioSistema | null>(null);
  const [mudarPapel, setMudarPapel] = useState<UsuarioSistema | null>(null);
  // RNF-04: administração gerencia usuários, exceto síndico; ninguém altera o próprio papel
  const gerenciaSindico = useCan('usuario.gerenciar_sindico');
  const papeisPermitidos = (Object.keys(ROTULO_PAPEL) as Papel[]).filter((p) => p !== 'sindico' || gerenciaSindico);

  /** Ação de linha: sucesso vira toast; erro (403 de permissão, 422 de regra) vira toast vermelho com a mensagem da API. */
  async function executar(fn: () => Promise<unknown>, ok?: string) {
    try { await fn(); if (ok) avisar({ texto: ok }); } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); }
  }
  function pedirRedefinicao(u: UsuarioSistema) {
    setRedefinir(null);
    void executar(() => acoes.redefinirAcesso.mutateAsync(u.id));
  }
  const botao = 'h-[44px] rounded-lg lg:h-10 border px-3 text-[14px] bg-white';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Usuários do sistema" descricao="Cada pessoa tem o próprio login. Senha nova é temporária (72 h) e precisa ser trocada na primeira entrada."
        acoes={<>
          {podeGerenciar && <Button variante="primario" onClick={() => setNovo(true)}>Novo usuário</Button>}
        </>} />
      {lista.error && <ErroCarregar mensagem={mensagemErro(lista.error)} onTentar={() => lista.refetch()} />}
      <Lista legenda="Operadores do sistema" colunas={COLUNAS} empilhar carregando={lista.isLoading}>
        <ListaCab rotulos={['Nome', 'Papel', 'Situação', 'Último acesso', 'Ações']} />
        {(lista.data ?? []).map((u) => (
          <ListaLinha key={u.id} minH={56} padY={8}>
            <Cel className="flex flex-col"><span className="font-medium">{u.nome}{u.id === eu?.id && <span className="ml-2 text-[12px] font-normal text-[#56616B]">(você)</span>}</span><span className="font-mono text-[13px] text-[#56616B]">{u.login}</span>
</Cel>
            {/* Papel só em texto: trocar é mudança de permissão, então passa por um modal com confirmação (nunca um select na linha) */}
            <Cel className="flex flex-wrap items-center gap-x-2 text-[14px]">
              {ROTULO_PAPEL[u.papel]}
              {u.ativo && u.id !== eu?.id && (u.papel !== 'sindico' || gerenciaSindico) && (
                <button type="button" aria-label={`Alterar papel de ${u.nome}`} onClick={() => setMudarPapel(u)}
                  className="min-h-[44px] px-1 text-[13px] font-semibold text-[#0B5563] hover:underline lg:min-h-0">Alterar</button>
              )}
            </Cel>
            <Cel className="flex flex-col items-start gap-1">
              {(() => {
                const a = avisoSenhaTemporaria(u, agora);
                if (a) return <><Badge tom={a.vencida ? 'vermelho' : 'ambar'} icone={Clock}>{a.selo}</Badge><span className={`text-[12px] ${a.vencida ? 'font-medium text-[#B42318]' : 'text-[#56616B]'}`}>{a.detalhe}</span></>;
                return <Badge tom={u.ativo ? 'verde' : 'neutro'}>{u.ativo ? 'Ativo' : 'Inativo'}</Badge>;
              })()}
            </Cel>
            <Cel className="font-mono text-[13.5px]">{u.id === eu?.id ? <span className="font-sans text-[14px]">Agora (sessão atual)</span> : u.ultimoAcesso ? fmtDataHora(u.ultimoAcesso) : <span className="font-sans text-[14px] text-[#56616B]">Nunca</span>}</Cel>
            <Cel className="col-span-2 flex flex-wrap gap-2 md:col-span-1">
              {u.papel === 'sindico' && !gerenciaSindico ? <span className="self-center text-[13px] text-[#56616B]">Só o síndico gerencia</span> : <>
              {/* A própria senha se troca informando a atual; a API recusa redefinir a si mesmo (AUTO_REDEFINICAO). */}
              {u.ativo && u.id === eu?.id && <Link to="/trocar-senha" className={`${botao} inline-flex items-center border-[#B9C3CA] hover:bg-[#EEF2F4]`}>Trocar minha senha</Link>}
              {u.ativo && u.id !== eu?.id && <button type="button" className={`${botao} border-[#B9C3CA] hover:bg-[#EEF2F4]`} onClick={() => setRedefinir(u)}>Nova senha temporária</button>}
              {u.ativo && u.id !== eu?.id && <button type="button" className={`${botao} border-[#FDA29B] text-[#B42318] hover:bg-[#FEF3F2]`} onClick={() => setDesativar(u)}>Desativar</button>}
              {!u.ativo && <button type="button" className={`${botao} border-[#B9C3CA] hover:bg-[#EEF2F4]`} onClick={() => void executar(() => acoes.reativar.mutateAsync(u.id), `${u.nome} reativado(a).`)}>Reativar</button>}
              </>}
            </Cel>
          </ListaLinha>
        ))}
      </Lista>

      {novo && <NovoUsuarioModal onClose={() => setNovo(false)}
        onSalvar={async (f) => { await acoes.criar.mutateAsync(f); setNovo(false); }} />}
      {senha && <SenhaTemporariaModal senha={senha} onClose={() => setSenha(null)} />}
      {redefinir && (
        <Modal titulo={`Nova senha temporária para ${redefinir.nome}?`} tamanho="p" onClose={() => setRedefinir(null)}
          rodape={<>
            <Button variante="primario" grande className="flex-1" onClick={() => pedirRedefinicao(redefinir)}>Gerar senha temporária</Button>
            <Button grande data-autofocus onClick={() => setRedefinir(null)}>Cancelar</Button>
          </>}>
          <p className="text-[15px] leading-[1.5]">Será gerada uma senha temporária. As sessões abertas de {redefinir.nome} são encerradas, e a troca de senha passa a ser obrigatória no próximo login.</p>
        </Modal>
      )}
      {mudarPapel && (
        <AlterarPapelModal usuario={mudarPapel} papeis={papeisPermitidos} onClose={() => setMudarPapel(null)}
          onConfirmar={(p) => { const u = mudarPapel; setMudarPapel(null); void executar(() => acoes.alterarPapel.mutateAsync({ id: u.id, papel: p }), `${u.nome} agora é ${ROTULO_PAPEL[p]}.`); }} />
      )}
      {desativar && (
        <Modal titulo={`Desativar ${desativar.nome}?`} tamanho="p" onClose={() => setDesativar(null)}
          rodape={<>
            <Button variante="perigo" grande className="flex-1" onClick={() => { const u = desativar; setDesativar(null); void executar(() => acoes.desativar.mutateAsync(u.id), `${u.nome} desativado(a). O histórico foi mantido.`); }}>Desativar</Button>
            <Button grande data-autofocus onClick={() => setDesativar(null)}>Cancelar</Button>
          </>}>
          <div className="flex gap-[10px] rounded-lg border border-[#FEC84B] bg-[#FEF0C7] px-[14px] py-3 text-[#7A2E0E]">
            <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden />
            <span>O usuário perde o acesso imediatamente. O histórico do usuário é mantido e continua visível na auditoria: os registros feitos por ele permanecem na trilha com o nome dele.</span>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Troca de papel em dois passos: escolher e confirmar com o antes e o depois escritos (é mudança de permissão). */
function AlterarPapelModal({ usuario, papeis, onClose, onConfirmar }: { usuario: UsuarioSistema; papeis: Papel[]; onClose: () => void; onConfirmar: (p: Papel) => void }) {
  const [papel, setPapel] = useState<Papel>(usuario.papel);
  const mudou = papel !== usuario.papel;
  return (
    <Modal titulo={`Alterar o papel de ${usuario.nome}`} tamanho="p" onClose={onClose}
      rodape={<>
        <Button variante="primario" grande className="flex-1" disabled={!mudou} onClick={() => onConfirmar(papel)}>Confirmar alteração</Button>
        <Button grande onClick={onClose}>Cancelar</Button>
      </>}>
      <div className="flex flex-col gap-1.5">
        <span id="rot-novo-papel" className="text-[14px] font-medium">Novo papel</span>
        <div role="radiogroup" aria-labelledby="rot-novo-papel" className="flex flex-wrap gap-1.5">
          {papeis.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={papel === p} {...(papel === p ? { 'data-autofocus': true } : {})} onClick={() => setPapel(p)}
              className={`h-[44px] rounded-full border px-[14px] text-[14px] lg:h-10 ${papel === p ? 'border-[#0B5563] bg-[#0B5563] text-white' : 'border-[#B9C3CA] bg-white text-ink hover:bg-[#EEF2F4]'}`}>{ROTULO_PAPEL[p]}</button>
          ))}
        </div>
      </div>
      <p aria-live="polite" className="rounded-lg bg-[#F3F5F6] px-[14px] py-[10px] text-[14px] text-[#33424B]">
        {mudou
          ? <>{usuario.nome} passa de <strong>{ROTULO_PAPEL[usuario.papel]}</strong> para <strong>{ROTULO_PAPEL[papel]}</strong>. As permissões mudam na hora, mesmo com a pessoa conectada, e a troca fica na trilha de alterações.</>
          : <>Papel atual: <strong>{ROTULO_PAPEL[usuario.papel]}</strong>. Escolha o novo papel.</>}
      </p>
    </Modal>
  );
}

function NovoUsuarioModal({ onClose, onSalvar }: { onClose: () => void; onSalvar: (f: NovoUsuarioInput) => Promise<void> }) {
  const gerenciaSindico = useCan('usuario.gerenciar_sindico');
  const [f, setF] = useState<{ nome: string; login: string; papel: Papel }>({ nome: '', login: '', papel: 'porteiro' });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (salvando) return;
    setErro(''); setSalvando(true);
    try { await onSalvar({ nome: f.nome.trim(), login: f.login.trim(), papel: f.papel }); } catch (err) { setErro(mensagemErro(err)); setSalvando(false); }
  }
  return (
    <Modal titulo="Novo usuário" onClose={onClose}
      rodape={<><Button type="submit" form="f-user" variante="primario" grande className="flex-1" carregando={salvando}>Criar usuário</Button><Button grande onClick={onClose}>Cancelar</Button></>}>
      <form id="f-user" onSubmit={salvar} className="flex flex-col gap-[14px]">
        <Field label="Nome completo"><input data-autofocus className="input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
        <Field label="Login"><input className="input font-mono" value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} placeholder="nome.sobrenome" /></Field>
        <div className="flex flex-col gap-1.5">
          <span id="rot-perfil" className="text-[14px] font-medium">Perfil</span>
          <div role="radiogroup" aria-labelledby="rot-perfil" className="flex flex-wrap gap-1.5">
            {(Object.keys(ROTULO_PAPEL) as Papel[]).filter((p) => p !== 'sindico' || gerenciaSindico).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={f.papel === p} onClick={() => setF({ ...f, papel: p })}
                className={`h-[44px] rounded-full border px-[14px] text-[14px] lg:h-10 ${f.papel === p ? 'border-[#0B5563] bg-[#0B5563] text-white' : 'border-[#B9C3CA] bg-white text-ink hover:bg-[#EEF2F4]'}`}>{ROTULO_PAPEL[p]}</button>
            ))}
          </div>
        </div>
        <div className="rounded-lg bg-[#E3F0F2] px-3 py-[10px] text-[14px] text-[#0B4450]">Todo perfil entra com login e senha individuais.</div>
        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
      </form>
    </Modal>
  );
}

/**
 * Mostra a senha temporária UMA vez. Ao fechar, o estado da tela é zerado e a senha some da memória da UI
 * (não fica em contexto global, cache do React Query nem storage). A API também não a devolve de novo.
 */
function SenhaTemporariaModal({ senha, onClose }: { senha: SenhaExibida; onClose: () => void }) {
  const [copiado, setCopiado] = useState<'senha' | 'mensagem' | null>(null);
  // Texto pronto para colar no WhatsApp/e-mail. A senha é temporária e de troca obrigatória no primeiro acesso.
  const expiraEm = senha.usuario.senhaTemporariaExpiraEm ?? null;
  const mensagem = mensagemAcesso({ login: senha.usuario.login, senhaTemporaria: senha.senhaTemporaria, expiraEm, origem: window.location.origin });
  async function copiar(texto: string, qual: 'senha' | 'mensagem') {
    try { await navigator.clipboard.writeText(texto); setCopiado(qual); } catch { setCopiado(null); }
  }
  return (
    <Modal titulo={senha.motivo === 'criado' ? `Usuário ${senha.usuario.nome} criado` : `Acesso de ${senha.usuario.nome} redefinido`}
      tamanho="p" tom="petroleo" tituloId="modal-senha-temporaria" semFechar onClose={onClose}
      rodape={<Button variante="primario" grande className="flex-1" data-autofocus onClick={onClose}>Já copiei, fechar</Button>}>
      <div className="flex gap-[10px] rounded-lg border border-[#FEC84B] bg-[#FEF0C7] px-[14px] py-3 text-[#7A2E0E]">
        <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden />
        <span><strong>Copie agora.</strong> Esta senha temporária não será mostrada de novo. No primeiro acesso, {senha.usuario.nome} vai precisar trocá-la.</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[14px] font-medium">Login</span>
        <span className="font-mono text-[15px]">{senha.usuario.login}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span id="rot-senha-temp" className="text-[14px] font-medium">Senha temporária</span>
        <div className="flex flex-wrap items-center gap-2">
          <output aria-labelledby="rot-senha-temp" className="min-w-0 flex-1 select-all break-all rounded-lg border border-[#B9C3CA] bg-[#F6F8F9] px-[14px] py-[10px] font-mono text-[18px] tracking-[0.04em]">
            {senha.senhaTemporaria}
          </output>
          <Button onClick={() => void copiar(senha.senhaTemporaria, 'senha')}><Copy className="mr-1.5 inline h-4 w-4" aria-hidden />{copiado === 'senha' ? 'Copiada' : 'Copiar'}</Button>
        </div>
        <span className="text-[13px] text-[#56616B]">Digite com os hífens, só letras minúsculas e números.</span>
        {expiraEm != null && <span className="text-[14px] font-medium text-[#7A2E0E]">Válida até {validadeTexto(expiraEm)}. Depois disso, será preciso redefinir o acesso.</span>}
      </div>
      <Button onClick={() => void copiar(mensagem, 'mensagem')}>
        <MessageSquareText className="mr-1.5 inline h-4 w-4" aria-hidden />{copiado === 'mensagem' ? 'Mensagem copiada' : 'Copiar mensagem com login, senha e endereço'}
      </Button>
      <span className="sr-only" aria-live="polite">{copiado === 'mensagem' ? 'Mensagem copiada.' : copiado === 'senha' ? 'Senha copiada.' : ''}</span>
    </Modal>
  );
}
