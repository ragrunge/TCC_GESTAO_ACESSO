import { useApi } from '../../api';
import { Alert } from '../../components/Alert';
import { Badge, SeloVinculo } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { Avatar } from '../../components/UnitTag';
import { ROTULO_CATEGORIA, ROTULO_VINCULO } from '../../domain/types';
import { agora, fmtDataHora } from '../../domain/time';
import { useAsync } from '../../app/useAsync';
import { chipDoEvento, quandoCurto, textoAutorizacao } from '../common/evento';

export function FichaPessoaModal({ id, onClose }: { id: string; onClose: () => void }) {
  const api = useApi();
  const ficha = useAsync(() => api.pessoas.ficha(id), [id]);
  const f = ficha.data;
  return (
    <Modal titulo="Ficha da pessoa" largura={680} onClose={onClose} rodape={<Button className="ml-auto" data-autofocus onClick={onClose}>Fechar</Button>}>
      {ficha.error && <Alert tom="vermelho" role="alert">{ficha.error}</Alert>}
      {f && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-[14px]">
            <Avatar nome={f.pessoa.nome} tamanho={44} />
            <div className="flex-1">
              <p className="text-[18px] font-semibold">{f.pessoa.nome}</p>
              <p className="text-[14px] text-[#33424B]"><span className="font-mono">{f.pessoa.documentoMascarado}</span>{f.pessoa.telefone && <> · {f.pessoa.telefone}</>}{f.pessoa.empresa && <> · {f.pessoa.empresa}{f.pessoa.servico ? ` (${f.pessoa.servico})` : ''}</>}</p>
            </div>
            <Badge tom="neutro">{ROTULO_CATEGORIA[f.pessoa.categoria]}</Badge>
          </div>
          {f.funcionario && <Alert tom="petroleo">Funcionário do condomínio: {f.funcionario.funcao}. Escala {f.funcionario.escala.horaInicio}–{f.funcionario.escala.horaFim}.</Alert>}
          <section>
            <h3 className="mb-2 text-[15px] font-semibold">Vínculos com unidades</h3>
            {f.vinculos.length === 0 ? <p className="text-[#56616B]">Sem vínculos.</p> : (
              <div className="rounded-[10px] border border-[#DCE1E5]">
                {f.vinculos.map((v) => (
                  <div key={v.id} className="grid min-h-12 grid-cols-[100px_minmax(0,1fr)_120px] items-center gap-3 border-b border-[#EEF1F3] px-4 py-2 last:border-b-0">
                    <span className="font-mono font-semibold">{v.unidadeId}</span><span className="text-[14px]">{ROTULO_VINCULO[v.tipo]}</span><SeloVinculo status={v.status} />
                  </div>
                ))}
              </div>
            )}
          </section>
          <section>
            <h3 className="mb-2 text-[15px] font-semibold">Últimos acessos</h3>
            {f.eventos.length === 0 ? <p className="text-[#56616B]">Sem acessos registrados.</p> : (
              <div className="rounded-[10px] border border-[#DCE1E5]" title={`Atualizado em ${fmtDataHora(agora())}`}>
                {f.eventos.map((e) => (
                  <div key={e.id} className="grid min-h-12 grid-cols-[110px_90px_minmax(0,1fr)] items-center gap-3 border-b border-[#EEF1F3] px-4 py-2 last:border-b-0">
                    <span className="font-mono text-[14px]">{quandoCurto(e.ocorridoEm, agora())}</span>
                    <span className="font-mono font-semibold">{e.unidadeDestinoId ?? '—'}</span>
                    <span className="flex min-w-0 items-center gap-2"><Badge tom={chipDoEvento(e).tom} icone={chipDoEvento(e).icone}>{chipDoEvento(e).texto}</Badge><span className="truncate text-[14px]">{textoAutorizacao(e)}</span></span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
