// Passo 4: resumo de tudo, saúde do provisionador e confirmação explícita. O botão "Criar" fica no rodapé do assistente
// e só habilita com o provisionador disponível e a confirmação marcada.
import { RefreshCw } from 'lucide-react';
import { agruparPorBloco, type ResultadoListaUnidades } from '@portaria/domain/units';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { Label } from '../../components/ui/label';
import { PASSOS, type Rascunho } from './rascunho';

/** O que fazer quando o provisionador está desligado (mesmo texto da API, docs/deploy.md seção 18.5). */
export const MENSAGEM_PROVISIONADOR = 'O provisionador está desligado. Na VPS: docker compose --profile provisionar up -d provisionador';
export const COMANDO_PROVISIONADOR = 'docker compose --profile provisionar up -d provisionador';

export type EstadoSaude = 'verificando' | 'disponivel' | 'indisponivel' | 'erro';

function Bloco({ titulo, passo, onEditar, bloqueado, children }: { titulo: string; passo: number; onEditar: (p: number) => void; bloqueado: boolean; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>{titulo}</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => onEditar(passo)} disabled={bloqueado} aria-label={`Alterar ${PASSOS[passo]!.toLowerCase()}`}>Alterar</Button>
      </CardHeader>
      <CardContent className="pt-3 text-[15px]">{children}</CardContent>
    </Card>
  );
}

export function PassoRevisao({ r, u, onEditar, saude, erroSaude, onVerificar, confirmado, onConfirmar, bloqueado }: {
  r: Rascunho; u: ResultadoListaUnidades; onEditar: (p: number) => void;
  saude: EstadoSaude; erroSaude: string | null; onVerificar: () => void;
  confirmado: boolean; onConfirmar: (v: boolean) => void; bloqueado: boolean;
}) {
  const grupos = agruparPorBloco(u.unidades);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Bloco titulo="Condomínio" passo={0} onEditar={onEditar} bloqueado={bloqueado}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-ink-suave">Nome</dt><dd>{r.nome.trim()}</dd>
            <dt className="text-ink-suave">Código</dt><dd className="font-mono">{r.codigo}</dd>
            <dt className="text-ink-suave">Cidade</dt><dd>{r.cidade.trim()}/{r.uf}</dd>
            <dt className="text-ink-suave">Plano</dt><dd>Padrão</dd>
          </dl>
        </Bloco>
        <Bloco titulo="Síndico" passo={2} onEditar={onEditar} bloqueado={bloqueado}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-ink-suave">Nome</dt><dd>{r.sindicoNome.trim()}</dd>
            <dt className="text-ink-suave">Login</dt><dd className="font-mono">{r.sindicoLogin}</dd>
          </dl>
          <p className="mt-2 text-[14px] text-ink-suave">A senha temporária é gerada na criação e aparece uma vez.</p>
        </Bloco>
        <Bloco titulo={`Unidades: ${u.unidades.length}`} passo={1} onEditar={onEditar} bloqueado={bloqueado}>
          <p className="mb-2 text-[14px] text-ink-suave">{grupos.length} {grupos.length === 1 ? r.agrupamento.toLowerCase() : r.agrupamento === 'Torre' ? 'torres' : 'blocos'}, vindas {r.fonte === 'lista' ? 'da lista colada' : `da planilha ${r.arquivo ?? ''}`}.</p>
          <ul className="flex flex-wrap gap-1.5" aria-label={`Unidades por ${r.agrupamento.toLowerCase()}`}>
            {grupos.map((g) => <li key={g.bloco}><Badge variant="neutro">{r.agrupamento} {g.bloco}: {g.unidades.length}</Badge></li>)}
          </ul>
        </Bloco>
        <Bloco titulo={`Áreas comuns: ${r.areas.length}`} passo={1} onEditar={onEditar} bloqueado={bloqueado}>
          {r.areas.length ? <p>{r.areas.join(', ')}</p> : <p className="text-ink-suave">Nenhuma.</p>}
        </Bloco>
      </div>

      <div aria-live="polite">
        {saude === 'verificando' && <Alert variant="neutro" role="status">Verificando o provisionador…</Alert>}
        {saude === 'disponivel' && <Alert variant="verde" role="status">Provisionador ligado: pronto para criar.</Alert>}
        {(saude === 'indisponivel' || saude === 'erro') && (
          <Alert variant="ambar" role="alert" title="Não dá para criar agora">
            {saude === 'erro' && erroSaude ? <p>{erroSaude}</p> : (
              <p>O provisionador está desligado. Na VPS: <code className="break-all rounded bg-white px-1 font-mono text-[13px]">{COMANDO_PROVISIONADOR}</code></p>
            )}
            <Button size="sm" variant="secondary" className="mt-2" onClick={onVerificar}><RefreshCw className="h-4 w-4" aria-hidden />Verificar de novo</Button>
          </Alert>
        )}
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-aviso-borda bg-aviso-bg px-4 py-3">
        <Checkbox id="confirmar-criacao" checked={confirmado} onCheckedChange={(v) => onConfirmar(v === true)} disabled={bloqueado} className="mt-0.5" />
        <Label htmlFor="confirmar-criacao" className="font-normal text-[#7A2E0E]">
          <span className="font-semibold">Conferi os dados. A criação não pode ser desfeita:</span> o banco do condomínio, as {u.unidades.length} unidades e o acesso do síndico são criados agora, e o código <span className="font-mono">{r.codigo}</span> não muda depois.
        </Label>
      </div>
    </div>
  );
}
