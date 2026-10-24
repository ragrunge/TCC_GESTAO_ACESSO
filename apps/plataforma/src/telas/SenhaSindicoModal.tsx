// Mostra a senha temporária do síndico UMA vez (como o SenhaTemporariaModal do apps/web). Ela vive só nas props deste
// modal: não vai para o cache do React Query, contexto global nem storage; ao fechar, quem abriu zera o estado e ela some.
// A API também não a devolve de novo (reenviar a mesma entrada responde `ja_provisionado`, sem senha).
// "Copiar tudo" monta o texto pronto para o síndico (endereço do login da PORTARIA, sem /admin, código, login, senha).
import { useState } from 'react';
import type { SenhaSindico } from '../api/plataforma';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';

/** Onde o síndico entra: o login do app da portaria (o mesmo site, fora do /admin). */
export const URL_LOGIN_PORTARIA = 'https://tccgestaoacesso.vercel.app/login';

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Texto para colar na mensagem ao síndico. */
export function textoParaSindico(nome: string, codigo: string, s: SenhaSindico): string {
  return [
    `Acesso de síndico ao sistema da portaria: ${nome}`,
    `Endereço: ${URL_LOGIN_PORTARIA}`,
    `Código do condomínio: ${codigo}`,
    `Login: ${s.login}`,
    `Senha temporária: ${s.senhaTemporaria}`,
    `A senha vale até ${dataHora(s.expiraEm)}. No primeiro acesso o sistema pede uma senha nova, só sua.`,
  ].join('\n');
}

export function SenhaSindicoModal({ codigo, nome, sindico, onClose }: { codigo: string; nome: string; sindico: SenhaSindico; onClose: () => void }) {
  const [copiado, setCopiado] = useState<'' | 'tudo' | 'senha' | 'falhou'>('');
  async function copiar(texto: string, o: 'tudo' | 'senha') {
    try { await navigator.clipboard.writeText(texto); setCopiado(o); } catch { setCopiado('falhou'); }
  }
  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
      <DialogContent semFechar onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{nome}: acesso do síndico</DialogTitle>
          <DialogDescription>Condomínio criado. Esta senha aparece só agora.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
          <dt className="text-ink-suave">Endereço</dt><dd className="break-all font-mono text-[14px]">{URL_LOGIN_PORTARIA}</dd>
          <dt className="text-ink-suave">Código do condomínio</dt><dd className="font-mono">{codigo}</dd>
          <dt className="text-ink-suave">Login</dt><dd className="font-mono">{sindico.login}</dd>
          <dt className="text-ink-suave">Senha temporária</dt><dd className="font-mono text-[17px] font-semibold" data-testid="senha-sindico">{sindico.senhaTemporaria}</dd>
          <dt className="text-ink-suave">Válida até</dt><dd>{dataHora(sindico.expiraEm)}</dd>
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => void copiar(textoParaSindico(nome, codigo, sindico), 'tudo')}>Copiar tudo</Button>
          <Button variant="ghost" onClick={() => void copiar(sindico.senhaTemporaria, 'senha')}>Copiar só a senha</Button>
          <span role="status" className={copiado === 'falhou' ? 'text-[14px] text-perigo' : 'text-[14px] text-ok'}>
            {copiado === 'tudo' ? 'Texto para o síndico copiado.' : copiado === 'senha' ? 'Senha copiada.' : copiado === 'falhou' ? 'Não foi possível copiar: selecione e copie à mão.' : ''}
          </span>
        </div>
        <Alert variant="ambar" title="Próximo passo">
          Entregue estes dados ao síndico por um canal fora do sistema (pessoalmente ou por mensagem direta). Ele entra pelo
          endereço acima e troca a senha no primeiro acesso.
        </Alert>
        <DialogFooter>
          <Button variant="default" data-autofocus className="flex-1" onClick={onClose}>Já copiei, fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
