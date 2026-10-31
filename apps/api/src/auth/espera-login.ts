// Atraso crescente das falhas de login (spec §5.1), num ponto só: o cálculo e a espera (os testes trocam a espera).
import { Injectable } from '@nestjs/common';
import { setTimeout as esperar } from 'node:timers/promises';
import type { Config } from '../config/config';

/** A espera do atraso crescente, num ponto só (os testes a observam). */
@Injectable()
export class EsperaLogin {
  async esperar(ms: number): Promise<void> {
    if (ms > 0) await esperar(ms);
  }
}

/** Atraso crescente das falhas: base * 2^(n-1), com teto (o mesmo de LimiteLoginService.atraso). */
export function atrasoDaFalha(c: Config['login'], falhas: number): number {
  if (c.atrasoBaseMs <= 0) return 0;
  return Math.min(c.atrasoMaxMs, c.atrasoBaseMs * 2 ** Math.max(0, falhas - 1));
}
