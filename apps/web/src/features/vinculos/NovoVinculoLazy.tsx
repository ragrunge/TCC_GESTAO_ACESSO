// Carga sob demanda do formulário de vínculo: Popover/cmdk/RadioGroup (shadcn/ui) só baixam quando alguém abre o
// fluxo, não no bundle inicial da portaria. `precarregarNovoVinculo` antecipa o download (ex.: ao abrir a ficha).
import { lazy, Suspense } from 'react';
import { Modal } from '../../components/Modal';
import type { VinculoUnidade } from '@portaria/domain/types';
import type { NovoVinculoProps } from './NovoVinculo';

const carregar = () => import('./NovoVinculo');
const NovoVinculoModal = lazy(() => carregar().then((m) => ({ default: m.NovoVinculoModal })));

/** Texto do aviso de sucesso, pelo status que a API devolveu (hoje sempre pendente). */
export function mensagemSucesso(v: Pick<VinculoUnidade, 'status'>): string {
  return v.status === 'pendente'
    ? 'Vínculo solicitado. Fica pendente até a aprovação; pendente não dá acesso de morador.'
    : `Vínculo registrado (${v.status}).`;
}

export const precarregarNovoVinculo = () => { void carregar(); };

export function NovoVinculoModalLazy(props: NovoVinculoProps) {
  return (
    <Suspense fallback={<Modal titulo={props.titulo} onClose={props.onClose}><p role="status" className="text-[#56616B]">Carregando…</p></Modal>}>
      <NovoVinculoModal {...props} />
    </Suspense>
  );
}
