import { useState, type FormEvent } from 'react';
import { Copy, MessageSquareText, TriangleAlert } from 'lucide-react';
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
import { mensagemErro } from '../../app/useAsync';
import { RetencaoLgpd } from './RetencaoLgpd';
import { useAcoesUsuario, useUsuarios } from './useUsuarios';

const COLUNAS = 'minmax(0,1.3fr) 140px 100px 190px 280px';

/** Senha temporária em exibição: vive só neste estado local e some ao fechar o modal. */
interface SenhaExibida extends UsuarioComSenhaTemporaria { motivo: 'criado' | 'redefinido' }

export function UsuariosPage() {
  const { usuario: eu } = useAuth();
  const { avisar } = useToast();
  const podeGerenciar = useCan('usuario.gerenciar');
  const lista = useUsuarios(podeGerenciar);
  const [senha, setSenha] = useState<SenhaExibida | null>(null);
  const acoes = useAcoesUsuario((r, motivo) => setSenha({ ...r, motivo }));
  const [novo, setNovo] = useState(false);
  const [desativar, setDesativar] = useState<UsuarioSistema | null>(null);
  const [redefinir, setRedefinir] = useState<UsuarioSistema | null>(null);
  // RNF-04: administração gerencia usuários, exceto síndico; ninguém altera o próprio papel
  const gerenciaSindico = useCan('usuario.gerenciar_sindico');
  // Retenção (LGPD, RNF-09): só o síndico; existe no mock e na API real.
  const podeRetencao = useCan('lgpd.retencao');
  const papeisPermitidos = (Object.keys(ROTULO_PAPEL) as Papel[]).filter((p) => p !== 'sindico' || gerenciaSindico);

  /** Ação de linha: sucesso vira toast; erro (403 de permissão, 422 de regra) vira toast vermelho com a mensagem da API. */
  async function executar(fn: () => Promise<unknown>, ok?: string) {
    try { await fn(); if (ok) avisar({ texto: ok }); } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); }
  }
  function pedirRedefinicao(u: UsuarioSistema) {
    setRedefinir(null);
    void executar(() => acoes.redefinirAcesso.mutateAsync(u.id));
  }
  const botao = 'h-10 rounded-lg border px-3 text-[14px] bg-white';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Usuários do sistema" descricao="Cada operador tem login próprio. Usuários desativados mantêm o histórico."
        acoes={<>
          {podeGerenciar && <Button variante="primario" onClick={() => setNovo(true)}>Novo usuário</Button>}
        </>} />
      {lista.error && <Alert tom="vermelho" role="alert">{mensagemErro(lista.error)}</Alert>}
      {lista.isPending && podeGerenciar && <p className="text-[14px] text-[#56616B]">Carregando usuários…</p>}
      <Lista legenda="Operadores do sistema" colunas={COLUNAS}>
        <ListaCab rotulos={['Nome', 'Perfil', 'Status', 'Último acesso', 'Ações']} />
        {(lista.data ?? []).map((u) => (
          <ListaLinha key={u.id} minH={56} padY={8}>
            <Cel className="flex flex-col"><span className="font-medium">{u.nome}{u.id === eu?.id && <span className="ml-2 text-[12px] font-normal text-[#56616B]">(você)</span>}</span><span className="font-mono text-[13px] text-[#56616B]">{u.login}</span></Cel>
            <Cel className="text-[14px]">{u.id === eu?.id || (u.papel === 'sindico' && !gerenciaSindico) ? ROTULO_PAPEL[u.papel] : (
              <select aria-label={`Papel de ${u.nome}`} className="h-10 rounded-lg border border-[#B9C3CA] bg-white px-2 text-[14px]" value={u.papel}
                disabled={acoes.alterarPapel.isPending}
                onChange={(e) => { const p = e.target.value as Papel; void executar(() => acoes.alterarPapel.mutateAsync({ id: u.id, papel: p }), `${u.nome} agora é ${ROTULO_PAPEL[p]}.`); }}>
                {papeisPermitidos.map((p) => <option key={p} value={p}>{ROTULO_PAPEL[p]}</option>)}
              </select>
            )}</Cel>
            <Cel><Badge tom={u.ativo ? 'verde' : 'neutro'}>{u.ativo ? 'Ativo' : 'Inativo'}</Badge></Cel>
            <Cel className="text-[14px]">{u.id === eu?.id ? 'Agora (sessão atual)' : u.ultimoAcesso ? fmtDataHora(u.ultimoAcesso) : 'Nunca'}</Cel>
            <Cel className="flex gap-2">
              {u.papel === 'sindico' && !gerenciaSindico ? <span className="self-center text-[13px] text-[#56616B]">Só o síndico gerencia</span> : <>
              {/* A própria senha se troca informando a atual; a API recusa redefinir a si mesmo (AUTO_REDEFINICAO). */}
              {u.ativo && u.id === eu?.id && <Link to="/trocar-senha" className={`${botao} inline-flex items-center border-[#B9C3CA] hover:bg-[#EEF2F4]`}>Trocar minha senha</Link>}
              {u.ativo && u.id !== eu?.id && <button type="button" className={`${botao} border-[#B9C3CA] hover:bg-[#EEF2F4]`} onClick={() => setRedefinir(u)}>Redefinir acesso</button>}
              {u.ativo && u.id !== eu?.id && <button type="button" className={`${botao} border-[#FDA29B] text-[#B42318] hover:bg-[#FEF3F2]`} onClick={() => setDesativar(u)}>Desativar</button>}
              {!u.ativo && <button type="button" className={`${botao} border-[#B9C3CA] hover:bg-[#EEF2F4]`} onClick={() => void executar(() => acoes.reativar.mutateAsync(u.id), `${u.nome} reativado(a).`)}>Reativar</button>}
              </>}
            </Cel>
          </ListaLinha>
        ))}
      </Lista>
      {podeRetencao && <RetencaoLgpd />}

      {novo && <NovoUsuarioModal onClose={() => setNovo(false)}
        onSalvar={async (f) => { await acoes.criar.mutateAsync(f); setNovo(false); }} />}
      {senha && <SenhaTemporariaModal senha={senha} onClose={() => setSenha(null)} />}
      {redefinir && (
        <Modal titulo={`Redefinir o acesso de ${redefinir.nome}?`} largura={520} gap={14} onClose={() => setRedefinir(null)}
          rodape={<>
            <Button variante="primario" grande className="flex-1" onClick={() => pedirRedefinicao(redefinir)}>Redefinir acesso</Button>
            <Button grande data-autofocus onClick={() => setRedefinir(null)}>Cancelar</Button>
          </>}>
          <p className="text-[15px] leading-[1.5]">Será gerada uma senha temporária. As sessões abertas de {redefinir.nome} são encerradas, e a troca de senha passa a ser obrigatória no próximo login.</p>
        </Modal>
      )}
      {desativar && (
        <Modal titulo={`Desativar ${desativar.nome}?`} largura={520} gap={14} onClose={() => setDesativar(null)}
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
    <Modal titulo="Novo usuário" largura={560} gap={14} onClose={onClose}
      rodape={<><Button type="submit" form="f-user" variante="primario" grande className="flex-1" carregando={salvando}>Criar usuário</Button><Button grande onClick={onClose}>Cancelar</Button></>}>
      <form id="f-user" onSubmit={salvar} className="flex flex-col gap-[14px]">
        <Field label="Nome completo"><input data-autofocus className="input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
        <Field label="Login"><input className="input font-mono" value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} placeholder="nome.sobrenome" /></Field>
        <div className="flex flex-col gap-1.5">
          <span id="rot-perfil" className="text-[14px] font-medium">Perfil</span>
          <div role="radiogroup" aria-labelledby="rot-perfil" className="flex flex-wrap gap-1.5">
            {(Object.keys(ROTULO_PAPEL) as Papel[]).filter((p) => p !== 'sindico' || gerenciaSindico).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={f.papel === p} onClick={() => setF({ ...f, papel: p })}
                className={`h-10 rounded-full border px-[14px] text-[14px] ${f.papel === p ? 'border-[#0B5563] bg-[#0B5563] text-white' : 'border-[#B9C3CA] bg-white text-ink hover:bg-[#EEF2F4]'}`}>{ROTULO_PAPEL[p]}</button>
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
  const mensagem = `Acesso ao sistema da portaria\nLogin: ${senha.usuario.login}\nSenha temporária: ${senha.senhaTemporaria}\n`
    + `Entre em ${window.location.origin} e troque a senha no primeiro acesso.`;
  async function copiar(texto: string, qual: 'senha' | 'mensagem') {
    try { await navigator.clipboard.writeText(texto); setCopiado(qual); } catch { setCopiado(null); }
  }
  return (
    <Modal titulo={senha.motivo === 'criado' ? `Usuário ${senha.usuario.nome} criado` : `Acesso de ${senha.usuario.nome} redefinido`}
      largura={560} gap={14} tom="petroleo" tituloId="modal-senha-temporaria" onClose={onClose}
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
        <div className="flex items-center gap-2">
          <output aria-labelledby="rot-senha-temp" className="flex-1 select-all rounded-lg border border-[#B9C3CA] bg-[#F6F8F9] px-[14px] py-[10px] font-mono text-[18px] tracking-[0.04em]">
            {senha.senhaTemporaria}
          </output>
          <Button onClick={() => void copiar(senha.senhaTemporaria, 'senha')}><Copy className="mr-1.5 inline h-4 w-4" aria-hidden />{copiado === 'senha' ? 'Copiada' : 'Copiar'}</Button>
        </div>
        <span className="text-[13px] text-[#56616B]">Digite com os hífens, só letras minúsculas e números.</span>
      </div>
      <Button onClick={() => void copiar(mensagem, 'mensagem')}>
        <MessageSquareText className="mr-1.5 inline h-4 w-4" aria-hidden />{copiado === 'mensagem' ? 'Mensagem copiada' : 'Copiar mensagem com login, senha e endereço'}
      </Button>
      <span className="sr-only" aria-live="polite">{copiado === 'mensagem' ? 'Mensagem copiada.' : copiado === 'senha' ? 'Senha copiada.' : ''}</span>
    </Modal>
  );
}
