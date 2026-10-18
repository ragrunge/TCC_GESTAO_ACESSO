import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

/** Campo com label sempre visível e ligada ao controle (WCAG 1.3.1 / 3.3.2). */
export function Field({ label, children, dica, erro, className = '' }: {
  label: ReactNode; children: ReactElement<{ id?: string; 'aria-describedby'?: string }>; dica?: ReactNode; erro?: ReactNode; className?: string;
}) {
  const id = useId();
  const dicaId = `${id}-d`;
  const filho = isValidElement(children)
    ? cloneElement(children, { id, 'aria-describedby': dica || erro ? dicaId : undefined })
    : children;
  return (
    <div className={`flex flex-col gap-[6px] ${className}`}>
      <label htmlFor={id} className="text-[14px] font-medium">{label}</label>
      {filho}
      {(dica || erro) && (
        <p id={dicaId} className={`text-[13px] ${erro ? 'font-medium text-[#B42318]' : 'text-[#56616B]'}`}>{erro ?? dica}</p>
      )}
    </div>
  );
}

/** Tecla em caixa (F2, Enter, Esc). */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[5px] border border-[#B9C3CA] bg-white px-[7px] py-[2px] font-mono text-[13px] font-semibold text-ink">{children}</kbd>;
}
