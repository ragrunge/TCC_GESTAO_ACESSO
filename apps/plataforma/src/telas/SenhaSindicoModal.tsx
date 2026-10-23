// Mostra a senha temporária do síndico UMA vez (como o SenhaTemporariaModal do apps/web). Ela vive só nas props deste
// modal: não vai para o cache do React Query, contexto global nem storage; ao fechar, quem abriu zera o estado e ela some.
// A API também não a devolve de novo (reenviar a mesma entrada responde `ja_provisionado`, sem senha).
import { useState } from 'react';
import type { SenhaSindico } from '../api/plataforma';
import { Alert, Button, Modal } from '../ui/ui';

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function SenhaSindicoModal({ codigo, nome, sindico, onClose }: { codigo: string; nome: string; sindico: SenhaSindico; onClose: () => void }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try { await navigator.clipboard.writeText(sindico.senhaTemporaria); setCopiado(true); } catch { setCopiado(false); }
  }
  return (
    <Modal titulo={`${nome}: acesso do síndico`} tituloId="titulo-senha-sindico" onClose={onClose}
      rodape={<Button variante="primario" data-autofocus className="flex-1" onClick={onClose}>Já copiei, fechar</Button>}>
      <Alert tom="ambar">Esta senha aparece só agora. Entregue ao síndico por um canal fora do sistema; ele troca a senha no primeiro acesso.</Alert>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
        <dt className="text-ink-suave">Código do condomínio</dt><dd className="font-mono">{codigo}</dd>
        <dt className="text-ink-suave">Login</dt><dd className="font-mono">{sindico.login}</dd>
        <dt className="text-ink-suave">Senha temporária</dt><dd className="font-mono text-[17px] font-semibold" data-testid="senha-sindico">{sindico.senhaTemporaria}</dd>
        <dt className="text-ink-suave">Válida até</dt><dd>{dataHora(sindico.expiraEm)}</dd>
      </dl>
      <div className="flex items-center gap-3">
        <Button variante="contorno" onClick={() => void copiar()}>Copiar senha</Button>
        <span role="status" className="text-[14px] text-ok">{copiado ? 'Senha copiada.' : ''}</span>
      </div>
    </Modal>
  );
}
