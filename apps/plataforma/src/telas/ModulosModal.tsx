// Ligar/desligar módulos de um condomínio (SAAS-19). A API grava e registra na trilha da plataforma; a recusa das rotas
// no app do condomínio (ModuloGuard) é da entrega seguinte, e o aviso abaixo diz isso.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MODULOS, ROTULO_MODULO, type Modulo } from '@portaria/domain/modulos';
import { ApiError } from '../api/cliente';
import { CHAVE_CONDOMINIOS, type CondominioPlataforma } from '../api/plataforma';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { useSessao } from '../sessao/SessaoMaster';

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
    <Dialog open onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Módulos de {condominio.nome}</DialogTitle>
          <DialogDescription>O núcleo da portaria (acessos, pessoas, unidades, trilha, LGPD) nunca desliga.</DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Módulos opcionais</legend>
          {MODULOS.map((x) => (
            <div key={x} className="flex min-h-[44px] items-center gap-3 rounded-lg border border-linha px-3">
              <Checkbox id={`modulo-${x}`} checked={marcados.has(x)} onCheckedChange={() => alternar(x)} />
              <Label htmlFor={`modulo-${x}`} className="flex-1 py-2 text-[15px] font-normal">{ROTULO_MODULO[x]}</Label>
            </div>
          ))}
        </fieldset>
        <Alert variant="petroleo">O bloqueio das telas do condomínio para módulo desligado entra na próxima entrega; por enquanto a mudança fica registrada.</Alert>
        {m.isError && <Alert variant="vermelho" role="alert">{m.error instanceof ApiError ? m.error.message : 'Não foi possível salvar.'}</Alert>}
        <DialogFooter>
          <Button variant="default" loading={m.isPending} onClick={() => m.mutate()} className="flex-1">Salvar módulos</Button>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
