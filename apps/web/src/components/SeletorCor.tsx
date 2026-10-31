// Cor do veículo (RF-08) como amostras clicáveis (Radix RadioGroup do shadcn/ui): setas trocam a cor, Tab entra e sai do
// grupo. As cores são as da tabela do Denatran; "Outra" abre um campo livre. O valor salvo continua sendo o NOME da cor
// (texto, até 30 caracteres, como a API espera), então veículos já cadastrados com cor livre aparecem em "Outra".
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { Check } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '../lib/utils';

export const CORES_VEICULO: readonly { nome: string; hex: string }[] = [
  { nome: 'Branca', hex: '#FFFFFF' },
  { nome: 'Prata', hex: '#C0C4C8' },
  { nome: 'Cinza', hex: '#7A8088' },
  { nome: 'Preta', hex: '#1B1F23' },
  { nome: 'Vermelha', hex: '#C62828' },
  { nome: 'Grená', hex: '#6D1A27' },
  { nome: 'Azul', hex: '#1E56A0' },
  { nome: 'Verde', hex: '#2E7D32' },
  { nome: 'Amarela', hex: '#F2C230' },
  { nome: 'Laranja', hex: '#E8711A' },
  { nome: 'Marrom', hex: '#6B4226' },
  { nome: 'Bege', hex: '#D9C7A3' },
  { nome: 'Dourada', hex: '#B8963E' },
  { nome: 'Rosa', hex: '#E58BB0' },
  { nome: 'Roxa', hex: '#6A3FA0' },
];

const OUTRA = '__outra__';
const daLista = (cor: string) => CORES_VEICULO.find((c) => c.nome.toLowerCase() === cor.trim().toLowerCase());

/** `valor` = nome da cor. Cor fora da lista entra em "Outra", com o texto no campo livre. */
export function SeletorCor({ valor, onChange, rotuloId }: { valor: string; onChange: (cor: string) => void; rotuloId: string }) {
  const idOutra = useId();
  const [outra, setOutra] = useState(() => (valor.trim() !== '' && !daLista(valor)));
  const escolhida = outra ? OUTRA : (daLista(valor)?.nome ?? '');
  return (
    <div className="flex flex-col gap-3">
      <RadioGroupPrimitive.Root aria-labelledby={rotuloId} value={escolhida} className="flex flex-wrap gap-2"
        onValueChange={(v) => {
          if (v === OUTRA) { setOutra(true); onChange(daLista(valor) ? '' : valor); }
          else { setOutra(false); onChange(v); }
        }}>
        {CORES_VEICULO.map((c) => (
          <RadioGroupPrimitive.Item key={c.nome} value={c.nome} aria-label={c.nome} title={c.nome}
            className="group flex flex-col items-center gap-1 rounded-lg p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <span className="grid h-9 w-9 place-items-center rounded-full border border-[#B9C3CA] shadow-sm ring-offset-2 group-data-[state=checked]:ring-2 group-data-[state=checked]:ring-primary"
              style={{ backgroundColor: c.hex }}>
              <RadioGroupPrimitive.Indicator>
                <Check className={cn('h-4 w-4', ['Branca', 'Prata', 'Bege', 'Amarela'].includes(c.nome) ? 'text-[#1B1F23]' : 'text-white')} strokeWidth={3} aria-hidden />
              </RadioGroupPrimitive.Indicator>
            </span>
            <span className="text-[12px] text-[#33424B] group-data-[state=checked]:font-semibold">{c.nome}</span>
          </RadioGroupPrimitive.Item>
        ))}
        <RadioGroupPrimitive.Item value={OUTRA} aria-label="Outra cor"
          className="group flex flex-col items-center gap-1 rounded-lg p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          <span className="grid h-9 w-9 place-items-center rounded-full border border-dashed border-[#56616B] bg-[conic-gradient(#C62828,#F2C230,#2E7D32,#1E56A0,#6A3FA0,#C62828)] ring-offset-2 group-data-[state=checked]:ring-2 group-data-[state=checked]:ring-primary">
            <RadioGroupPrimitive.Indicator><Check className="h-4 w-4 text-white" strokeWidth={3} aria-hidden /></RadioGroupPrimitive.Indicator>
          </span>
          <span className="text-[12px] text-[#33424B] group-data-[state=checked]:font-semibold">Outra</span>
        </RadioGroupPrimitive.Item>
      </RadioGroupPrimitive.Root>
      {outra && (
        <div className="flex flex-col gap-1">
          <label htmlFor={idOutra} className="text-[14px] font-medium">Qual cor?</label>
          <input id={idOutra} className="input" maxLength={30} autoFocus value={valor} onChange={(e) => onChange(e.target.value)} placeholder="Ex.: Verde-musgo, Fantasia" />
        </div>
      )}
    </div>
  );
}
