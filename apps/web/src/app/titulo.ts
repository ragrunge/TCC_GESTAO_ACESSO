import { useEffect } from 'react';

const SUFIXO = 'Gestão de Acesso';

/** Mantém o <title> da aba alinhado à tela atual: "<tela> · Gestão de Acesso". */
export function useTituloPagina(titulo?: string) {
  useEffect(() => {
    document.title = titulo ? `${titulo} · ${SUFIXO}` : SUFIXO;
  }, [titulo]);
}
