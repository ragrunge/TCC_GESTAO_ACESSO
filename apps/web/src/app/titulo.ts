import { useEffect } from 'react';

const SUFIXO = 'Portaria Parque';

/** Mantém o <title> da aba alinhado à tela atual: "<tela> · Portaria Parque". */
export function useTituloPagina(titulo?: string) {
  useEffect(() => {
    document.title = titulo ? `${titulo} · ${SUFIXO}` : SUFIXO;
  }, [titulo]);
}
