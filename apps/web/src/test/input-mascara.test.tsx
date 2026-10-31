// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InputMascara, type TipoMascara } from '../components/InputMascara';

function Campo({ tipo, inicial = '' }: { tipo: TipoMascara; inicial?: string }) {
  const [v, setV] = useState(inicial);
  return <><label htmlFor="c">Campo</label><input id="ignorado" hidden /><InputMascara id="c" tipo={tipo} value={v} onChange={setV} /><output data-testid="estado">{v}</output></>;
}
const campo = () => screen.getByLabelText('Campo') as HTMLInputElement;
// Sem user-event no projeto: simula uma tecla por vez (valor atual + caractere, cursor no fim) e a colagem (valor inteiro).
const digitar = (texto: string) => { for (const ch of texto) fireEvent.change(campo(), { target: { value: campo().value + ch } }); };
const colar = (texto: string) => fireEvent.change(campo(), { target: { value: texto } });
const apagarFim = (n = 1) => { for (let i = 0; i < n; i++) fireEvent.change(campo(), { target: { value: campo().value.slice(0, -1) } }); };

afterEach(cleanup);

describe('InputMascara', () => {
  it('CPF: mascara ao digitar e limita em 11 dígitos', () => {
    render(<Campo tipo="cpf" />);
    digitar('12345678909999');
    expect(campo().value).toBe('123.456.789-09');
    expect(campo().inputMode).toBe('numeric');
  });
  it('telefone: celular e fixo', () => {
    const { unmount } = render(<Campo tipo="telefone" />);
    digitar('11987654321');
    expect(campo().value).toBe('(11) 98765-4321');
    expect(campo().autocomplete).toBe('tel-national');
    unmount();
    render(<Campo tipo="telefone" />);
    digitar('1134567890');
    expect(campo().value).toBe('(11) 3456-7890');
  });
  it('placa: maiúsculas, antiga e Mercosul', () => {
    const { unmount } = render(<Campo tipo="placa" />);
    digitar('abc1234');
    expect(campo().value).toBe('ABC-1234');
    unmount();
    render(<Campo tipo="placa" />);
    digitar('abc1d23');
    expect(campo().value).toBe('ABC-1D23');
  });
  it('colar texto com e sem pontuação', () => {
    render(<Campo tipo="cpf" />);
    colar('123.456.789-09');
    expect(campo().value).toBe('123.456.789-09');
    colar('');
    colar('  12345678909 ');
    expect(campo().value).toBe('123.456.789-09');
    expect(screen.getByTestId('estado').textContent).toBe('123.456.789-09');
  });
  it('apagar do fim até esvaziar, passando pelos separadores', () => {
    render(<Campo tipo="cpf" inicial="123.456" />);
    apagarFim();
    expect(campo().value).toBe('123.45');
    apagarFim(4);
    expect(campo().value).toBe('1');
    apagarFim();
    expect(campo().value).toBe('');
  });
  it('editar no meio não joga o cursor para o fim', () => {
    render(<Campo tipo="telefone" inicial="(11) 98765-4321" />);
    const el = campo();
    el.focus();
    // insere "0" depois de "(11) 9": dígitos antes do cursor = 3
    el.setSelectionRange(6, 6);
    fireEvent.change(el, { target: { value: '(11) 90 8765-4321', selectionStart: 7 } });
    expect(el.value).toBe('(11) 90876-5432');
    expect(el.selectionStart).toBe(7); // logo após o "0" digitado: "(11) 90|876-5432"
  });
  it('valor inicial sem máscara aparece mascarado', () => {
    render(<Campo tipo="cpf" inicial="12345678909" />);
    expect(campo().value).toBe('123.456.789-09');
  });
});
