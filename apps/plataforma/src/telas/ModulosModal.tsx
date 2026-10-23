// Ligar/desligar módulos de um condomínio (SAAS-19). A API grava e registra na trilha da plataforma; a recusa das rotas
// no app do condomínio (ModuloGuard) é da entrega seguinte, e o aviso abaixo diz isso.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MODULOS, ROTULO_MODULO, type Modulo } from '@portaria/domain/modulos';
import { ApiError } from '../api/cliente';
import { CHAVE_CONDOMINIOS, type CondominioPlataforma } from '../api/plataforma';
import { useSessao } from '../sessao/SessaoMaster';
import { Alert, Button, Modal } from '../ui/ui';

export function ModulosModal({ condominio, onClose }: { condominio: CondominioPlataforma; onClose: () => void }) {
  const { api } = useSessao();
  const qc = useQueryClient();
  const [marcados, setMarcados] = useState<Set<Modulo>>(new Set(condominio.modulos));
  const m = useMutation({
    mutationFn: () => api.modulos(condominio.id, MODULOS.filter((x) => marcados.has(x))),
    onSuccess: (novo) => {
      qc.setQueryData<CondominioPlataforma[]>(CHAVE_CONDOMINIOS, (l) => l?.map((c) => (c.id === novo.id ? novo : c)));
      onClose();
    },
  });
  const alternar = (x: Modulo) => setMarcados((s) => { const n = new Set(s); if (n.has(x)) n.delete(x); else n.add(x); return n; });

  return (
    <Modal titulo={`Módulos de ${condominio.nome}`} tituloId="titulo-modulos" onClose={onClose}
      rodape={<>
        <Button variante="primario" carregando={m.isPending} onClick={() => m.mutate()} className="flex-1">Salvar módulos</Button>
        <Button variante="secundario" onClick={onClose}>Cancelar</Button>
      </>}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[14px] text-ink-suave">O núcleo da portaria (acessos, pessoas, unidades, trilha, LGPD) nunca desliga.</legend>
        {MODULOS.map((x) => (
          <label key={x} className="flex min-h-[40px] items-center gap-3 rounded-lg border border-linha px-3">
            <input type="checkbox" className="h-5 w-5 accent-[#0B5563]" checked={marcados.has(x)} onChange={() => alternar(x)} />
            <span className="text-[15px]">{ROTULO_MODULO[x]}</span>
          </label>
        ))}
      </fieldset>
      <Alert tom="petroleo">O bloqueio das telas do condomínio para módulo desligado entra na próxima entrega; por enquanto a mudança fica registrada.</Alert>
      {m.isError && <Alert tom="vermelho" role="alert">{m.error instanceof ApiError ? m.error.message : 'Não foi possível salvar.'}</Alert>}
    </Modal>
  );
}
