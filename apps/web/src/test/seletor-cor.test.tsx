// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SeletorCor } from '../components/SeletorCor';

function Campo({ inicial = '' }: { inicial?: string }) {
  const [v, setV] = useState(inicial);
  return <><span id="r">Cor</span><SeletorCor rotuloId="r" valor={v} onChange={setV} /><output data-testid="estado">{v}</output></>;
}
const estado = () => screen.getByTestId('estado').textContent;

describe('SeletorCor', () => {
  afterEach(cleanup);

  it('grupo de rádio rotulado; clicar numa amostra grava o nome da cor', () => {
    render(<Campo />);
    expect(screen.getByRole('radiogroup', { name: 'Cor' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Prata' }));
    expect(estado()).toBe('Prata');
    expect(screen.getByRole('radio', { name: 'Prata' }).getAttribute('aria-checked')).toBe('true');
  });

  it('cor já cadastrada da lista vem marcada, sem diferenciar maiúsculas', () => {
    render(<Campo inicial="preta" />);
    expect(screen.getByRole('radio', { name: 'Preta' }).getAttribute('aria-checked')).toBe('true');
  });

  it('cor fora da lista abre "Outra" com o texto; trocar para uma amostra fecha o campo', () => {
    render(<Campo inicial="Verde-musgo" />);
    expect(screen.getByRole('radio', { name: 'Outra cor' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText('Qual cor?') as HTMLInputElement).value).toBe('Verde-musgo');
    fireEvent.click(screen.getByRole('radio', { name: 'Azul' }));
    expect(estado()).toBe('Azul');
    expect(screen.queryByLabelText('Qual cor?')).toBeNull();
  });

  it('"Outra" a partir de uma cor da lista limpa o valor para digitar', () => {
    render(<Campo inicial="Branca" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Outra cor' }));
    expect(estado()).toBe('');
    fireEvent.change(screen.getByLabelText('Qual cor?'), { target: { value: 'Fantasia' } });
    expect(estado()).toBe('Fantasia');
  });
});
