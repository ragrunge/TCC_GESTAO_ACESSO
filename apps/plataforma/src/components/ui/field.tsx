// Field (padrão do shadcn/ui: rótulo, descrição e erro do campo). O controle filho recebe id, aria-describedby (dica
// e erro, os dois quando houver) e aria-invalid; o erro é texto visível, não só cor.
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Label } from './label';

type Controle = ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;

export function Field({ label, children, dica, erro, className, id: idFixo }: {
  label: ReactNode; children: Controle; dica?: ReactNode; erro?: ReactNode; className?: string; id?: string;
}) {
  const gerado = useId();
  const id = idFixo ?? gerado;
  const dicaId = `${id}-dica`;
  const erroId = `${id}-erro`;
  const descritores = [dica ? dicaId : null, erro ? erroId : null].filter(Boolean).join(' ') || undefined;
  const filho = isValidElement(children) ? cloneElement(children, { id, 'aria-describedby': descritores, 'aria-invalid': erro ? true : undefined }) : children;
  return (
    <div className={cn('flex flex-col gap-[6px]', className)}>
      <Label htmlFor={id}>{label}</Label>
      {filho}
      {dica && <p id={dicaId} className="text-[13px] text-[#56616B]">{dica}</p>}
      {erro && <p id={erroId} className="text-[13px] font-medium text-perigo">{erro}</p>}
    </div>
  );
}
