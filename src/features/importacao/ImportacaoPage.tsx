import { useRef, useState } from 'react';
import { Check, TriangleAlert, Upload } from 'lucide-react';
import { useApi, type LinhaPlanilha, type RelatorioImportacao, type ResultadoImportacao } from '../../api';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { fmtData } from '@portaria/domain/time';
import { mensagemErro } from '../../app/useAsync';
import { csvExemplo, lerCsv, lerXlsx } from './csv';

const COL = 'minmax(0,1.2fr) 130px 50px 50px 100px 150px';

export function ImportacaoPage() {
  const api = useApi();
  const [linhas, setLinhas] = useState<LinhaPlanilha[]>([]);
  const [rel, setRel] = useState<RelatorioImportacao | null>(null);
  const [res, setRes] = useState<ResultadoImportacao | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function analisar(nome: string, ls: LinhaPlanilha[]) {
    setOcupado(true); setErro(''); setRes(null);
    try { setLinhas(ls); setRel(await api.importacao.analisar({ arquivo: nome, linhas: ls })); }
    catch (e) { setErro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  async function aoEscolher(f: File | undefined) {
    if (!f) return;
    setErro(''); setRel(null); setRes(null);
    if (/\.xls$/i.test(f.name)) { setErro('O formato .xls (Excel antigo) não é lido. Salve como .xlsx ou CSV UTF-8 e envie novamente.'); return; }
    let lido: { linhas: LinhaPlanilha[]; faltando: string[] };
    try { lido = /\.xlsx$/i.test(f.name) ? await lerXlsx(f) : lerCsv(await f.text()); }
    catch { setErro('Não foi possível ler a planilha. Confira se o arquivo é um .xlsx válido ou um CSV UTF-8.'); return; }
    const { linhas: ls, faltando } = lido;
    if (faltando.length) { setErro(`Colunas obrigatórias não encontradas no cabeçalho: ${faltando.join(', ')}.`); return; }
    await analisar(f.name, ls);
  }

  async function confirmar() {
    if (!rel) return;
    setOcupado(true);
    try { setRes(await api.importacao.confirmar(rel.id)); setRel(null); } catch (e) { setErro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  const reiniciar = () => { setRel(null); setRes(null); setLinhas([]); setErro(''); };
  const problemasDaLinha = (n: number) => rel?.inconsistencias.filter((i) => i.linha === n) ?? [];

  return (
    <div className="flex max-w-[1080px] flex-col gap-5">
      <PageHeader titulo="Importar planilha" descricao="Carga inicial a partir da planilha atual. Moradores entram com status Legado até a regularização do vínculo." />
      <input ref={inputRef} type="file" accept=".csv,.xlsx,text/csv" className="sr-only" aria-label="Selecionar arquivo da planilha" tabIndex={-1} onChange={(e) => { void aoEscolher(e.target.files?.[0]); e.target.value = ''; }} />
      {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}

      {!rel && !res && (
        <>
          <button type="button" onClick={() => inputRef.current?.click()}
            className="flex h-60 flex-col items-center justify-center gap-[10px] rounded-xl border-2 border-dashed border-[#9AA7B0] bg-white hover:border-[#0B5563] hover:bg-[#F5FAFB]">
            <Upload className="h-9 w-9 text-[#0B5563]" strokeWidth={1.8} aria-hidden />
            <span className="text-[18px] font-semibold">Selecionar arquivo .csv ou .xlsx</span>
            <span className="text-[14px] text-[#56616B]">Colunas esperadas: nome, CPF, torre, unidade, tipo de vínculo, telefone. O CPF não é guardado em claro; linha sem CPF entra como legado, a regularizar.</span>
          </button>
          <Button className="self-start" onClick={() => void analisar('planilha-exemplo.csv', lerCsv(csvExemplo()).linhas)} carregando={ocupado}>Usar planilha de exemplo</Button>
        </>
      )}

      {rel && (
        <>
          <div className="flex items-center justify-between gap-4 rounded-[10px] border border-[#DCE1E5] bg-white px-[18px] py-[14px]">
            <div className="flex flex-col"><span className="font-mono font-semibold">{rel.arquivo}</span>
              <span className="text-[14px] text-[#56616B]">{rel.lidas} linhas lidas · {rel.importaveis} válidas · {rel.rejeitadas} rejeitadas · {rel.avisos} avisos</span></div>
            <Button pequeno onClick={reiniciar}>Trocar arquivo</Button>
          </div>
          <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-4">
            <section className="rounded-[10px] border border-[#DCE1E5] bg-white">
              <h2 className="border-b border-[#E6EAED] px-5 py-[14px] text-[16px] font-semibold">Pré-visualização</h2>
              <div role="table" aria-label="Pré-visualização das primeiras linhas da planilha">
                <div role="row" style={{ gridTemplateColumns: COL }} className="grid gap-[10px] border-b border-[#E6EAED] px-5 py-[10px] text-[13px] font-semibold text-[#56616B]">
                  <span role="columnheader">Nome</span><span role="columnheader">Documento</span><span role="columnheader">Torre</span><span role="columnheader">Un.</span><span role="columnheader">Vínculo</span><span role="columnheader">Situação</span>
                </div>
                {linhas.slice(0, 8).map((l) => {
                  const ps = problemasDaLinha(l.linha);
                  return (
                    <div role="row" key={l.linha} style={{ gridTemplateColumns: COL }} className="grid items-center gap-[10px] border-b border-[#EEF1F3] px-5 py-2 text-[14px]">
                      <span className="truncate">{l.nome}</span>
                      <span className="font-mono text-[13px]">{l.documento ? l.documento.replace(/\d(?=.{4})/g, '•') : '—'}</span>
                      <span className="font-mono">{l.torre}</span><span className="font-mono">{l.unidade}</span><span>{l.tipo}</span>
                      {ps.length === 0 ? <span className="font-medium text-[#05603A]">Válida</span>
                        : <span className="inline-flex items-center gap-[5px] font-semibold text-[#93370D]"><TriangleAlert className="h-[14px] w-[14px]" strokeWidth={2.4} aria-hidden />{ps[0].tipo === 'erro' ? 'Inconsistente' : 'Aviso'}</span>}
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="flex flex-col gap-[14px] rounded-[10px] border border-[#DCE1E5] bg-white px-5 py-4">
              <h2 className="text-[16px] font-semibold">Inconsistências ({rel.inconsistencias.length})</h2>
              {rel.inconsistencias.length === 0 && <span className="text-[14px] text-[#56616B]">Nenhuma inconsistência.</span>}
              <div className="flex max-h-72 flex-col gap-[14px] overflow-y-auto">
                {rel.inconsistencias.map((i, k) => (
                  <div key={k} className="flex flex-col gap-0.5 rounded-lg border border-[#FEC84B] bg-[#FEF0C7] px-3 py-[10px] text-[#7A2E0E]">
                    <span className="flex justify-between font-semibold"><span>Linha {i.linha}</span><span>{i.tipo === 'erro' ? 'Erro' : 'Aviso'}</span></span>
                    <span className="text-[13px]">{i.mensagem}</span>
                  </div>
                ))}
              </div>
              <span className="text-[14px] text-[#56616B]">Linhas com inconsistência (erro) não são importadas. Prazo de regularização dos moradores: {fmtData(rel.prazoRegularizacao)}.</span>
              <Button variante="primario" grande carregando={ocupado} onClick={() => void confirmar()}>Importar {rel.importaveis} moradores válidos</Button>
            </section>
          </div>
        </>
      )}

      {res && (
        <>
          <div role="status" className="flex items-start gap-[14px] rounded-[10px] border border-[#75E0A7] bg-[#DCFAE6] px-[22px] py-5 text-[#05603A]">
            <Check className="h-[26px] w-[26px] shrink-0" strokeWidth={2.4} aria-hidden />
            <div className="flex flex-col gap-1">
              <span className="text-[19px] font-semibold">{res.importados} moradores importados com status Legado — prazo de regularização até {fmtData(res.prazoRegularizacao)}</span>
              {res.reaproveitados > 0 && <span className="text-[14px] text-[#065F46]">{res.reaproveitados} já existiam e foram reaproveitados, sem duplicar.</span>}
            </div>
          </div>
          <Button className="self-start" onClick={reiniciar}>Nova importação</Button>
        </>
      )}
    </div>
  );
}
