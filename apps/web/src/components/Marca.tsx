// Símbolo do sistema de Gestão de Acesso (1b · Portal): arco de portão com uma pessoa passando.
// Decorativo: o nome "Gestão de Acesso" sempre vem em texto ao lado.
export function Marca({ tamanho = 34 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 32 32" aria-hidden className="block shrink-0">
      <rect width="32" height="32" rx="8" fill="#0B5563" />
      <path d="M9.5 24.5V15a6.5 6.5 0 0 1 13 0v9.5" fill="none" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="16" cy="19.5" r="2.8" fill="#A9D2D8" />
    </svg>
  );
}
