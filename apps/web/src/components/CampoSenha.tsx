import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Campo de senha com o botão de olho para mostrar ou esconder o que foi digitado. Recebe id e aria-describedby do
 * `Field` e repassa ao input. O olho nativo do Edge é escondido para não aparecerem dois.
 */
export function CampoSenha({ className = '', ...resto }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visivel, setVisivel] = useState(false);
  return (
    <div className="relative">
      <input {...resto} type={visivel ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        className={`input !h-[46px] !px-[14px] !pr-12 [&::-ms-reveal]:hidden ${className}`} />
      <button type="button" onClick={() => setVisivel((v) => !v)} aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
        aria-controls={resto.id} title={visivel ? 'Ocultar senha' : 'Mostrar senha'}
        className="absolute right-[1px] top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-[#56616B] transition-colors hover:bg-[#EEF2F4] hover:text-ink">
        {visivel ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
      </button>
    </div>
  );
}
