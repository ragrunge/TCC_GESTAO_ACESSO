import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** Estado de conexão do navegador (eventos online/offline). Só indica rede; a API pode cair mesmo "online". */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const subir = () => setOnline(true);
    const cair = () => setOnline(false);
    window.addEventListener('online', subir);
    window.addEventListener('offline', cair);
    return () => { window.removeEventListener('online', subir); window.removeEventListener('offline', cair); };
  }, []);
  return online;
}

const UMA_HORA = 60 * 60 * 1000;

/**
 * Avisos do PWA: (1) "Sem conexão": o sistema não grava nada offline (a trilha é append-only e dado pessoal não
 * fica no aparelho), então a pessoa precisa saber por que o registro falha; (2) "Nova versão disponível": o service
 * worker novo fica esperando até o clique em Atualizar, para não recarregar a tela no meio de um cadastro.
 */
export function AvisosPwa() {
  const online = useOnline();
  const [dispensado, setDispensado] = useState(false);
  const { needRefresh: [novaVersao], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, registro) {
      // Busca versão nova de hora em hora em quem deixa a aba aberta o dia todo (portaria 24h).
      if (registro) setInterval(() => { if (navigator.onLine) void registro.update(); }, UMA_HORA);
    },
  });

  return (
    <>
      {!online && (
        <div role="alert" className="fixed inset-x-0 bottom-0 z-[75] flex items-center justify-center gap-2 bg-[#7A271A] px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] text-[14px] font-medium text-white">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
          <span>Sem conexão — o sistema precisa de internet para registrar.</span>
        </div>
      )}
      {novaVersao && !dispensado && (
        <div role="status" className="fixed bottom-4 left-4 z-[76] flex max-w-[calc(100vw-32px)] flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-[#DCE1E5] bg-white py-2 pl-4 pr-2 text-[14px] shadow-[0_12px_32px_rgba(16,38,44,0.2)] sm:bottom-6 sm:left-6 print:hidden">
          <span>Nova versão disponível</span>
          <span className="flex items-center">
            <button type="button" onClick={() => void updateServiceWorker(true)}
              className="min-h-[44px] rounded-lg px-3 font-semibold text-[#0B5563] hover:bg-[#E3F0F2]">Atualizar</button>
            <button type="button" onClick={() => setDispensado(true)}
              className="min-h-[44px] rounded-lg px-3 text-[#56616B] hover:bg-[#EEF2F4]">Depois</button>
          </span>
        </div>
      )}
    </>
  );
}
