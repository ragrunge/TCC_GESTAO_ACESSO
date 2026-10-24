import { useLayoutEffect, useRef, type InputHTMLAttributes } from 'react';
import { mascaraCpf, mascaraPlaca, mascaraTelefone } from '@portaria/domain/cpf';

const TIPOS = {
  cpf: { mascara: mascaraCpf, inputMode: 'numeric', autoComplete: 'off', placeholder: '000.000.000-00', extra: {} },
  telefone: { mascara: mascaraTelefone, inputMode: 'tel', autoComplete: 'tel-national', placeholder: '(11) 98765-4321', extra: {} },
  placa: { mascara: mascaraPlaca, inputMode: 'text', autoComplete: 'off', placeholder: 'ABC-1234 ou ABC1D23', extra: { autoCapitalize: 'characters', spellCheck: false } },
} as const;

export type TipoMascara = keyof typeof TIPOS;

// Letras e dígitos são os caracteres "significativos"; o resto (. - ( ) espaço) é literal da máscara.
const significativos = (s: string) => (s.match(/[0-9A-Za-z]/g) ?? []).length;

/** Posição logo depois do n-ésimo caractere significativo (0 se n = 0). */
function posicaoApos(mascarado: string, n: number): number {
  if (n <= 0) return 0;
  let vistos = 0;
  for (let i = 0; i < mascarado.length; i++) {
    if (/[0-9A-Za-z]/.test(mascarado[i]!) && ++vistos === n) return i + 1;
  }
  return mascarado.length;
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  tipo: TipoMascara;
  value: string;
  /** Recebe o valor já mascarado. */
  onChange: (valor: string) => void;
};

/**
 * Input com máscara de CPF, telefone ou placa. Aplica a máscara a cada mudança (digitação, colagem, apagar) e
 * mantém o cursor no mesmo caractere ao editar no meio. Sem maxLength nativo de propósito: ele cortaria o texto
 * colado com pontuação extra (ex.: "+55 11 ...") antes da máscara; quem limita o tamanho é a máscara.
 */
export function InputMascara({ tipo, value, onChange, className = 'input', ...resto }: Props) {
  const cfg = TIPOS[tipo];
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const exibido = cfg.mascara(value);

  useLayoutEffect(() => {
    const el = ref.current;
    if (caret.current !== null && el && document.activeElement === el) el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  return (
    <input
      ref={ref}
      inputMode={cfg.inputMode}
      autoComplete={cfg.autoComplete}
      placeholder={cfg.placeholder}
      {...cfg.extra}
      {...resto}
      className={className}
      value={exibido}
      onChange={(e) => {
        const bruto = e.target.value;
        const mascarado = cfg.mascara(bruto);
        caret.current = posicaoApos(mascarado, significativos(bruto.slice(0, e.target.selectionStart ?? bruto.length)));
        onChange(mascarado);
        // Se o estado não mudou (ex.: dígito além do limite), não há re-render para o layout effect: reposiciona já.
        if (mascarado === value) { e.target.setSelectionRange(caret.current, caret.current); caret.current = null; }
      }}
    />
  );
}
