// Regra da tela de entrada: o evento "negado" é gravado UMA vez só (RF-16).
export interface NegadoGravado { eventoId: string; codigo: string }

/**
 * Se o servidor já gravou o negado (422 PESSOA_EM_RESTRICAO na confirmação), devolve o que ele informou e NÃO
 * chama `gravar`. Só quando a restrição foi detectada antes (ao escolher pessoa/unidade), sem negado gravado,
 * é que `gravar` roda uma única vez.
 */
export async function garantirNegado(jaGravado: NegadoGravado | null, gravar: () => Promise<NegadoGravado>): Promise<NegadoGravado> {
  return jaGravado ?? gravar();
}
