import { useState, type FormEvent } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useApi } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Cel, Lista, ListaCab, ListaLinha } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { exigeTotpNoCadastro } from '../../domain/rbac';
import { ROTULO_PAPEL, type Papel, type UsuarioSistema } from '../../domain/types';
import { fmtDataHora } from '../../domain/time';
import { mensagemErro, useAsync } from '../../app/useAsync';

const COLUNAS = 'minmax(0,1.3fr) 140px 100px 190px 120px 280px';

export function UsuariosPage() {
  const api = useApi();
  const { usuario: eu } = useAuth();
  const { avisar } = useToast();
  const lista = useAsync(() => api.usuarios.listar(), []);
  const [novo, setNovo] = useState(false);
  const [desativar, setDesativar] = useState<UsuarioSistema | null>(null);

  async function executar(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); avisar({ texto: ok }); void lista.recarregar(); } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); }
  }
  const botao = 'h-10 rounded-lg border px-3 text-[14px] bg-white';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Usuários do sistema" descricao="Cada operador tem login próprio. Usuários desativados mantêm o histórico. Perfis diferentes de porteiro exigem segundo fator."
        acoes={<Button variante="primario" onClick={() => setNovo(true)}>Novo usuário</Button>} />
      {lista.error && <Alert tom="vermelho" role="alert">{lista.error}</Alert>}
      <Lista legenda="Operadores do sistema" colunas={COLUNAS}>
        <ListaCab rotulos={['Nome', 'Perfil', 'Status', 'Último acesso', 'Segundo fator', 'Ações']} />
        {(lista.data ?? []).map((u) => (
          <ListaLinha key={u.id} minH={56} padY={8}>
            <Cel className="flex flex-col"><span className="font-medium">{u.nome}{u.id === eu?.id && <span className="ml-2 text-[12px] font-normal text-[#56616B]">(você)</span>}</span><span className="font-mono text-[13px] text-[#56616B]">{u.login}</span></Cel>
            <Cel className="text-[14px]">{ROTULO_PAPEL[u.papel]}</Cel>
            <Cel><Badge tom={u.ativo ? 'verde' : 'neutro'}>{u.ativo ? 'Ativo' : 'Inativo'}</Badge></Cel>
            <Cel className="text-[14px]">{u.id === eu?.id ? 'Agora (sessão atual)' : u.ultimoAcesso ? fmtDataHora(u.ultimoAcesso) : 'Nunca'}</Cel>
            <Cel className={`text-[14px] font-semibold ${u.totpAtivo ? 'text-[#05603A]' : 'text-[#56616B]'}`}>{u.totpAtivo ? 'Ativo' : 'Não'}</Cel>
            <Cel className="flex gap-2">
              {u.ativo && <button type="button" className={`${botao} border-[#B9C3CA] hover:bg-[#EEF2F4]`} onClick={() => void executar(() => api.usuarios.redefinirAcesso(u.id), `Acesso de ${u.nome} redefinido. Senha temporária gerada; troca obrigatória no próximo login.`)}>Redefinir acesso</button>}
              {u.ativo && u.id !== eu?.id && <button type="button" className={`${botao} border-[#FDA29B] text-[#B42318] hover:bg-[#FEF3F2]`} onClick={() => setDesativar(u)}>Desativar</button>}
              {!u.ativo && <button type="button" className={`${botao} border-[#B9C3CA] hover:bg-[#EEF2F4]`} onClick={() => void executar(() => api.usuarios.reativar(u.id), `${u.nome} reativado(a).`)}>Reativar</button>}
            </Cel>
          </ListaLinha>
        ))}
      </Lista>

      {novo && <NovoUsuarioModal onClose={() => setNovo(false)} onFeito={(u) => { setNovo(false); avisar({ texto: `Usuário ${u.nome} criado.` }); void lista.recarregar(); }} />}
      {desativar && (
        <Modal titulo={`Desativar ${desativar.nome}?`} largura={520} gap={14} onClose={() => setDesativar(null)}
          rodape={<>
            <Button variante="perigo" grande className="flex-1" onClick={() => { const u = desativar; setDesativar(null); void executar(() => api.usuarios.desativar(u.id), `${u.nome} desativado(a). O histórico foi mantido.`); }}>Desativar</Button>
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

function NovoUsuarioModal({ onClose, onFeito }: { onClose: () => void; onFeito: (u: UsuarioSistema) => void }) {
  const api = useApi();
  const [f, setF] = useState<{ nome: string; login: string; papel: Papel }>({ nome: '', login: '', papel: 'porteiro' });
  const [erro, setErro] = useState('');
  async function salvar(e: FormEvent) {
    e.preventDefault();
    try { onFeito(await api.usuarios.criar(f)); } catch (err) { setErro(mensagemErro(err)); }
  }
  return (
    <Modal titulo="Novo usuário" largura={560} gap={14} onClose={onClose}
      rodape={<><Button type="submit" form="f-user" variante="primario" grande className="flex-1">Criar usuário</Button><Button grande onClick={onClose}>Cancelar</Button></>}>
      <form id="f-user" onSubmit={salvar} className="flex flex-col gap-[14px]">
        <Field label="Nome completo"><input data-autofocus className="input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
        <Field label="Login"><input className="input font-mono" value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} placeholder="nome.sobrenome" /></Field>
        <div className="flex flex-col gap-1.5">
          <span id="rot-perfil" className="text-[14px] font-medium">Perfil</span>
          <div role="radiogroup" aria-labelledby="rot-perfil" className="flex flex-wrap gap-1.5">
            {(Object.keys(ROTULO_PAPEL) as Papel[]).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={f.papel === p} onClick={() => setF({ ...f, papel: p })}
                className={`h-10 rounded-full border px-[14px] text-[14px] ${f.papel === p ? 'border-[#0B5563] bg-[#0B5563] text-white' : 'border-[#B9C3CA] bg-white text-ink hover:bg-[#EEF2F4]'}`}>{ROTULO_PAPEL[p]}</button>
            ))}
          </div>
        </div>
        <div className="rounded-lg bg-[#E3F0F2] px-3 py-[10px] text-[14px] text-[#0B4450]">
          {exigeTotpNoCadastro(f.papel) ? 'Este perfil exige segundo fator: o aplicativo autenticador será cadastrado no primeiro acesso.' : 'Este perfil entra apenas com login e senha individuais.'}
        </div>
        {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
      </form>
    </Modal>
  );
}
