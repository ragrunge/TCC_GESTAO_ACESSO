import { useState, type ReactNode } from 'react';
import { Alert } from './Alert';
import { Button } from './Button';
import { Modal } from './Modal';
import { mensagemErro } from '../app/useAsync';

/** Confirmação de ação destrutiva. `onConfirmar` falhando mantém o modal aberto e mostra o erro. */
export function ConfirmarModal({ titulo, rotulo, onConfirmar, onClose, desabilitado, children }: {
  titulo: string; rotulo: string; onConfirmar: () => Promise<void>; onClose: () => void; desabilitado?: boolean; children?: ReactNode;
}) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  async function confirmar() {
    setSalvando(true); setErro('');
    try { await onConfirmar(); } catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }
  return (
    <Modal titulo={titulo} onClose={onClose} tamanho="p" role="alertdialog"
      rodape={<><Button variante="perigo" grande className="flex-1" disabled={desabilitado} carregando={salvando} onClick={() => void confirmar()}>{rotulo}</Button><Button grande data-autofocus onClick={onClose}>Cancelar</Button></>}>
      {children}
      {erro && <Alert tom="vermelho" role="alert">{erro}</Alert>}
    </Modal>
  );
}
