// Negado gravado uma vez só (RF-16): a tela não repete o "negado" que o servidor já gravou no 422 da entrada.
// O contrato do servidor (cada tentativa bloqueada grava um negado) é testado na API: eventos.test.ts.
import { describe, expect, it } from 'vitest';
import { garantirNegado } from '../features/portaria/negado';

describe('item 7: negado gravado uma vez só', () => {
  it('o modal não grava de novo quando o servidor já gravou o negado', async () => {
    let gravacoes = 0;
    const gravar = async () => { gravacoes++; return { eventoId: 'novo', codigo: 'EV-novo' }; };
    // restrição veio no 422 da confirmação: usa o que o servidor informou
    expect(await garantirNegado({ eventoId: 'ev-1', codigo: 'EV-1' }, gravar)).toEqual({ eventoId: 'ev-1', codigo: 'EV-1' });
    expect(gravacoes).toBe(0);
    // restrição detectada antes, sem negado gravado: grava uma única vez
    expect(await garantirNegado(null, gravar)).toEqual({ eventoId: 'novo', codigo: 'EV-novo' });
    expect(gravacoes).toBe(1);
  });
});
