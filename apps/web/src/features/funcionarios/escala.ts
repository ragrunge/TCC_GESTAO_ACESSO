// Utilitários de exibição da escala (as regras vêm do domain).
import type { Escala } from '@portaria/domain/types';
import { descreverJanela as janela, validarEscala } from '@portaria/domain/rules';
import { hhmmParaMin } from '@portaria/domain/time';

export { validarEscala };
/** "seg a sex, 22h–6h" */
export const descreverJanela = (e: Escala) => janela({ diasSemana: e.diasSemana, horaInicio: e.horaInicio, horaFim: e.horaFim });
/** Fim antes do início: o turno passa da meia-noite (vale no dia do início, como em escalaVigente). */
export const hhmmAtravessaMeiaNoite = (e: Escala) => /^\d{2}:\d{2}$/.test(e.horaInicio) && /^\d{2}:\d{2}$/.test(e.horaFim) && hhmmParaMin(e.horaFim) < hhmmParaMin(e.horaInicio);
