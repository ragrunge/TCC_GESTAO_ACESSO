// Datas de calendário no fuso do condomínio. O domain (@portaria/domain/time) trabalha em BRT fixo (UTC-3, sem horário
// de verão desde 2019); a API usa a mesma regra para que "hoje" seja o mesmo dia no mock e no banco.
const BRT_MS = 3 * 3600 * 1000;

/** "AAAA-MM-DD" do dia em BRT do instante (comparável com colunas `date` do banco). */
export const diaBrt = (instante: Date): string => new Date(instante.getTime() - BRT_MS).toISOString().slice(0, 10);
