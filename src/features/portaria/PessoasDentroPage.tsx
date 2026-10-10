import { TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApi } from '../../api';
import { useCan } from '../../auth/AuthContext';
import { Alert } from '../../components/Alert';
import { PageHeader } from '../../components/PageHeader';
import { Cel, CelUnidade, Lista, ListaCab, ListaLinha, Vazio } from '../../components/Table';
import { useToast } from '../../components/Toast';
import { ROTULO_CATEGORIA } from '../../domain/types';
import { permanenciaExcedida } from '../../domain/rules';
import { fmtHora } from '../../domain/time';
import { mensagemErro, useAgora, useAsync } from '../../app/useAsync';
import { chipDoEvento, textoAutorizacao } from '../common/evento';

const COLUNAS = 'minmax(0,1.4fr) 110px 80px 80px 150px minmax(0,1.3fr) 160px';

export function PessoasDentroPage() {
  const api = useApi();
  const { avisar } = useToast();
  const agora = useAgora(15000);
  const podeRegistrar = useCan('evento.registrar');
  const lista = useAsync(() => api.eventos.presentes(), []);

  async function saida(id: string, nome: string) {
    try {
      // A saída é um NOVO evento ligado à entrada; a entrada original não é alterada (RN-04)
      const ev = await api.eventos.registrarSaida(id);
      avisar({ texto: `Saída de ${nome} registrada às ${fmtHora(ev.ocorridoEm)} (${ev.codigo}, ligada à entrada ${ev.entradaCodigo}).` });
      void lista.recarregar();
    } catch (e) { avisar({ tom: 'vermelho', texto: mensagemErro(e) }); }
  }

  const dados = lista.data ?? [];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader titulo="Pessoas no condomínio"
        descricao={`${dados.length} ${dados.length === 1 ? 'pessoa entrou' : 'pessoas entraram'} e ainda não ${dados.length === 1 ? 'teve' : 'tiveram'} a saída registrada.`}
        acoes={podeRegistrar && <Link to="/entrada" className="inline-flex h-11 items-center gap-[10px] rounded-lg bg-[#0B5563] px-[18px] font-semibold !text-white hover:bg-[#08434E]">Nova entrada <kbd className="rounded-[5px] border border-white/50 px-[7px] py-0.5 font-mono text-[13px]">F2</kbd></Link>} />
      {lista.error && <Alert tom="vermelho" role="alert">{lista.error}</Alert>}
      <Lista legenda="Pessoas atualmente no condomínio" colunas={COLUNAS}>
        <ListaCab rotulos={['Nome', 'Tipo', 'Unidade', 'Entrada', 'Permanência', 'Autorizado por', '']} />
        {dados.map((e) => {
          const excedeu = permanenciaExcedida(e.ocorridoEm, agora);
          const min = Math.max(0, Math.floor((agora - e.ocorridoEm) / 60000));
          const dur = `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
          return (
            <ListaLinha key={e.id} destaque={excedeu ? 'ambar' : undefined} minH={56} padY={8}>
              <Cel className="truncate font-medium">{e.pessoaNome}</Cel>
              <Cel className="text-[14px]">{ROTULO_CATEGORIA[e.categoriaPessoa]}</Cel>
              <CelUnidade id={e.unidadeDestinoId} />
              <Cel className="font-mono">{fmtHora(e.ocorridoEm)}</Cel>
              <Cel className={`flex items-center gap-1.5 font-mono ${excedeu ? 'font-semibold text-[#93370D]' : ''}`}>
                {excedeu && <TriangleAlert className="h-4 w-4" strokeWidth={2.4} aria-hidden />}
                {dur}{excedeu && <span className="font-sans text-[12px]">acima de 8h</span>}
              </Cel>
              <Cel className="text-[14px]">{textoAutorizacao(e)}<span className="text-[#56616B]"> · {chipDoEvento(e).texto}</span></Cel>
              <Cel>{podeRegistrar && (
                <button type="button" onClick={() => void saida(e.id, e.pessoaNome)}
                  className="h-10 rounded-lg border border-[#B9C3CA] bg-white px-[14px] text-[14px] font-medium hover:border-[#0B5563] hover:text-[#0B5563]">Registrar saída</button>
              )}</Cel>
            </ListaLinha>
          );
        })}
        {!lista.loading && dados.length === 0 && <Vazio>Ninguém no condomínio no momento.</Vazio>}
      </Lista>
    </div>
  );
}
