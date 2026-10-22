import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/types';
import { mensagemErro } from '../app/useAsync';

describe('mensagemErro', () => {
  it('400 de validação lista campo e mensagem', () => {
    const e = new ApiError(400, 'DADOS_INVALIDOS', 'Dados inválidos.', [
      { field: 'telefone', message: 'telefone inválido' }, { field: 'vigenciaFim', message: 'obrigatório para inquilino' },
    ]);
    expect(mensagemErro(e)).toBe('Dados inválidos: telefone: telefone inválido; vigenciaFim: obrigatório para inquilino');
  });
  it('erro no corpo todo mostra só a mensagem', () => {
    expect(mensagemErro(new ApiError(400, 'DADOS_INVALIDOS', 'Dados inválidos.', [{ field: '(corpo)', message: 'campo desconhecido' }]))).toBe('Dados inválidos: campo desconhecido');
  });
  it('sem details ou outro código mantém a mensagem da API', () => {
    expect(mensagemErro(new ApiError(400, 'DADOS_INVALIDOS', 'Dados inválidos.'))).toBe('Dados inválidos.');
    expect(mensagemErro(new ApiError(422, 'REGRA', 'Regra violada.', [{ field: 'x', message: 'y' }]))).toBe('Regra violada.');
    expect(mensagemErro('?')).toBe('Erro inesperado.');
  });
});
