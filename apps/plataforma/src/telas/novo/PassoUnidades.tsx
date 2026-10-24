// Passo 2: agrupamento, unidades (lista colada OU planilha) com prévia por bloco, e áreas comuns. O parser é o do
// domain (`lerListaUnidades`/`linhasDePlanilha`), o mesmo que a API confere de novo; nada vem pré-preenchido.
import { useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { FileSpreadsheet, ListPlus, X } from 'lucide-react';
import {
  AGRUPAMENTOS, type Agrupamento, agruparPorBloco, codigoUnidade, doAgrupamento, LIMITE_UNIDADES, linhasDePlanilha, matrizDeCsv,
  type ResultadoListaUnidades,
} from '@portaria/domain/units';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { NativeSelect } from '../../components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Textarea } from '../../components/ui/textarea';
import { type Fonte, problemaArea, type Rascunho, semLinhas } from './rascunho';

const LIMITE_ARQUIVO = 2 * 1024 * 1024;
const CHIPS_POR_BLOCO = 48;
const PROBLEMAS_VISIVEIS = 50;

/** Célula do Excel (texto, número, data, vazio) -> texto. */
const celulaTexto = (c: unknown) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim());

/** Lê CSV ou XLSX para a matriz de texto (o .xlsx pela mesma read-excel-file do apps/web, carregada sob demanda). */
export async function lerPlanilha(arquivo: File): Promise<string[][]> {
  const nome = arquivo.name.toLowerCase();
  if (nome.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    return (await readSheet(arquivo)).map((l) => l.map(celulaTexto));
  }
  if (nome.endsWith('.csv') || nome.endsWith('.txt')) return matrizDeCsv(await arquivo.text());
  throw new Error('Formato não aceito: envie um arquivo .csv ou .xlsx.');
}

type Atualizar = (f: (r: Rascunho) => Rascunho) => void;

export function PassoUnidades({ r, atualizar, u, erros }: { r: Rascunho; atualizar: Atualizar; u: ResultadoListaUnidades; erros: Record<string, string> }) {
  const [lendo, setLendo] = useState(false);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const nomeGrupo = r.agrupamento === 'Torre' ? 'torres' : 'blocos';
  const grupos = agruparPorBloco(u.unidades);
  const linhaDe = new Map(u.linhas.filter((l) => l.situacao === 'ok').map((l) => [codigoUnidade(l.unidade!), l.linha]));
  const problemas = u.linhas.filter((l) => l.situacao !== 'ok');
  const rotuloLinha = r.fonte === 'planilha' ? 'Linha da planilha' : 'Linha';

  async function escolherArquivo(ev: ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    ev.target.value = ''; // permite escolher o mesmo arquivo de novo depois de corrigir
    if (!f) return;
    setErroArquivo(null);
    if (f.size > LIMITE_ARQUIVO) { setErroArquivo('Arquivo maior que 2 MB.'); return; }
    setLendo(true);
    try {
      const linhas = linhasDePlanilha(await lerPlanilha(f));
      if (!linhas.some(Boolean)) { setErroArquivo('A planilha está vazia.'); return; }
      atualizar((x) => ({ ...x, textoPlanilha: linhas.join('\n'), arquivo: f.name }));
    } catch (e) {
      setErroArquivo(e instanceof Error && e.message.startsWith('Formato') ? e.message : 'Não foi possível ler o arquivo. Confira se é um CSV ou XLSX válido.');
    } finally {
      setLendo(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Field label="Como o condomínio chama o agrupamento" dica="Muda só o rótulo (Bloco A · AP 101 ou Torre A · AP 101); o código da unidade é o mesmo.">
        <NativeSelect value={r.agrupamento} onChange={(e) => atualizar((x) => ({ ...x, agrupamento: e.target.value as Agrupamento }))} className="sm:max-w-[240px]">
          {AGRUPAMENTOS.map((a) => <option key={a} value={a}>{a}</option>)}
        </NativeSelect>
      </Field>

      <Tabs value={r.fonte} onValueChange={(v) => atualizar((x) => ({ ...x, fonte: v as Fonte }))}>
        <TabsList aria-label="De onde vêm as unidades">
          <TabsTrigger value="lista"><ListPlus className="h-4 w-4" aria-hidden />Colar lista</TabsTrigger>
          <TabsTrigger value="planilha"><FileSpreadsheet className="h-4 w-4" aria-hidden />Enviar planilha</TabsTrigger>
        </TabsList>
        <TabsContent value="lista">
          <Field label="Unidades (uma por linha)" erro={r.fonte === 'lista' ? erros.unidades : undefined}
            dica={<>Bloco (ou torre) e número, separados por hífen, espaço, barra ou ponto e vírgula. Aceitos: <span className="font-mono">A-101</span>, <span className="font-mono">a 101</span>, <span className="font-mono">Bloco A 101</span>, <span className="font-mono">Torre 2 - 34</span>, <span className="font-mono">A;101</span> (colado do Excel). Bloco: 1 a 3 letras ou dígitos; número: até 4 dígitos (3 vira 03).</>}>
            <Textarea rows={8} className="font-mono" spellCheck={false} autoComplete="off" placeholder={'A-101\nA-102\nB-201'}
              value={r.textoLista} onChange={(e) => atualizar((x) => ({ ...x, textoLista: e.target.value }))} />
          </Field>
        </TabsContent>
        <TabsContent value="planilha">
          <Field label="Arquivo CSV ou XLSX" erro={erroArquivo ?? (r.fonte === 'planilha' ? erros.unidades : undefined)}
            dica={<>Uma unidade por linha: numa coluna (<span className="font-mono">A-101</span>) ou em duas (bloco e número). Cabeçalho opcional (ex.: <span className="font-mono">Bloco | Unidade</span>). Até 2 MB; só a primeira aba do XLSX.</>}>
            <Input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => void escolherArquivo(e)} disabled={lendo} />
          </Field>
          {lendo && <p role="status" className="text-[14px]">Lendo a planilha…</p>}
          {r.arquivo && !lendo && <p className="text-[14px] text-ink-suave">Arquivo lido: <span className="font-medium text-ink">{r.arquivo}</span></p>}
        </TabsContent>
      </Tabs>

      <Card aria-labelledby="titulo-previa">
        <CardHeader>
          <CardTitle id="titulo-previa">Prévia das unidades</CardTitle>
          <CardDescription role="status" aria-live="polite">
            {u.unidades.length
              ? `${u.unidades.length} ${u.unidades.length === 1 ? 'unidade' : 'unidades'} em ${grupos.length} ${grupos.length === 1 ? r.agrupamento.toLowerCase() : nomeGrupo}`
              : 'Nenhuma unidade ainda. Cole a lista ou envie a planilha.'}
            {problemas.length ? ` · ${problemas.length} ${problemas.length === 1 ? 'linha' : 'linhas'} com problema` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {u.acimaDoLimite && <Alert variant="vermelho">No máximo {LIMITE_UNIDADES} unidades por condomínio.</Alert>}
          {problemas.length > 0 && (
            <Alert variant="vermelho" title={`${problemas.length} ${problemas.length === 1 ? 'linha' : 'linhas'} com problema`}>
              <ul className="mt-1 flex flex-col gap-1" aria-label="Linhas com problema">
                {problemas.slice(0, PROBLEMAS_VISIVEIS).map((l) => (
                  <li key={l.linha} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span><span className="font-medium">{rotuloLinha} {l.linha}</span>: <span className="font-mono">"{l.texto}"</span>. {l.motivo}</span>
                    <Button size="sm" variant="ghost" onClick={() => atualizar((x) => semLinhas(x, [l.linha]))} aria-label={`Remover a linha ${l.linha}`}>Remover</Button>
                  </li>
                ))}
              </ul>
              {problemas.length > PROBLEMAS_VISIVEIS && <p className="mt-1">… e mais {problemas.length - PROBLEMAS_VISIVEIS}.</p>}
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => atualizar((x) => semLinhas(x, problemas.map((l) => l.linha)))}>
                Remover todas as linhas com problema
              </Button>
            </Alert>
          )}
          {grupos.map((g) => {
            const todas = abertos.has(g.bloco) || g.unidades.length <= CHIPS_POR_BLOCO;
            const titulo = `${r.agrupamento} ${g.bloco}`;
            return (
              <section key={g.bloco} aria-label={`${titulo}: ${g.unidades.length} unidades`} className="flex flex-col gap-2">
                <h4 className="flex items-center gap-2 text-[15px] font-semibold">{titulo}<Badge variant="petroleo">{g.unidades.length}</Badge></h4>
                <ul className="flex flex-wrap gap-1.5">
                  {(todas ? g.unidades : g.unidades.slice(0, CHIPS_POR_BLOCO)).map((un) => {
                    const c = codigoUnidade(un);
                    return (
                      <li key={c}>
                        <Badge variant="neutro" className="pr-1 font-mono">
                          {un.numero}
                          <button type="button" aria-label={`Remover ${c}`} onClick={() => atualizar((x) => semLinhas(x, [linhaDe.get(c)!]))}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-white">
                            <X className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
                {!todas && (
                  <Button size="sm" variant="ghost" className="self-start" onClick={() => setAbertos((s) => new Set(s).add(g.bloco))}>
                    Mostrar todas as {g.unidades.length} unidades {doAgrupamento(r.agrupamento)} {g.bloco}
                  </Button>
                )}
              </section>
            );
          })}
        </CardContent>
      </Card>

      <AreasComuns areas={r.areas} onChange={(areas) => atualizar((x) => ({ ...x, areas }))} />
    </div>
  );
}

/** Áreas comuns como etiquetas: começa com as sugestões do domain, cada uma remove com um clique. */
export function AreasComuns({ areas, onChange }: { areas: string[]; onChange: (a: string[]) => void }) {
  const [nova, setNova] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  function adicionar() {
    const p = problemaArea(areas, nova);
    setErro(p);
    if (p) return;
    onChange([...areas, nova.trim()]);
    setNova('');
  }
  const tecla = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } };
  return (
    <Card aria-labelledby="titulo-areas">
      <CardHeader>
        <CardTitle id="titulo-areas">Áreas comuns</CardTitle>
        <CardDescription>Usadas nas reservas e ocorrências. Sugestões iniciais: remova as que o condomínio não tem.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {areas.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Áreas comuns escolhidas">
            {areas.map((a) => (
              <li key={a}>
                <Badge variant="petroleo" className="pr-1">
                  {a}
                  <button type="button" aria-label={`Remover ${a}`} onClick={() => onChange(areas.filter((x) => x !== a))}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-white">
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        ) : <p className="text-[14px] text-ink-suave">Nenhuma área comum (podem ser cadastradas depois).</p>}
        <div className="flex flex-col gap-[6px]">
          <Label htmlFor="nova-area">Nova área comum</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="nova-area" value={nova} maxLength={120} placeholder="Ex.: Churrasqueira" className="min-w-[200px] flex-1"
              aria-invalid={erro ? true : undefined} aria-describedby={erro ? 'nova-area-erro' : undefined}
              onChange={(e) => { setNova(e.target.value); setErro(null); }} onKeyDown={tecla} />
            <Button variant="outline" onClick={adicionar}>Adicionar</Button>
            {areas.length > 0 && <Button variant="ghost" onClick={() => onChange([])}>Remover todas</Button>}
          </div>
          {erro && <p id="nova-area-erro" className="text-[13px] font-medium text-perigo">{erro}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
