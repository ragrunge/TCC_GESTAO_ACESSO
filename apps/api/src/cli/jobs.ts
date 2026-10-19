// Rotinas de LGPD e de selo pela linha de comando (as mesmas do agendador e dos endpoints), para rodar à mão, por cron
// externo ou depois de um restore:
//   docker compose exec api node dist/cli/jobs.js retencao          retenção completa (seção 7 dos requisitos)
//   docker compose exec api node dist/cli/jobs.js selo [AAAA-MM-DD]  selo diário do dia (padrão: ontem, BRT) + âncoras
//   docker compose exec api node dist/cli/jobs.js ancoras            só reenvia as âncoras pendentes
// Roda como app_rw (DATABASE_URL da API), com a mesma trava de job: se o agendador estiver no meio, sai com código 3.
// A saída tem só contagens e ids (sem dado pessoal).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { diaBrt, ehDiaValido, somarDias } from '../comum/datas';
import { NOME_AGENDADOR, SeloService } from '../selo/selo.module';
import { RetencaoService } from '../lgpd/retencao.service';
import { TravaJobs } from '../jobs/trava';

async function principal(): Promise<number> {
  process.env.JOBS_AGENDADOR = 'false'; // o contexto do CLI não liga os timers
  const [comando, arg] = process.argv.slice(2);
  if (!['retencao', 'selo', 'ancoras'].includes(comando ?? '')) {
    console.error('uso: jobs.js retencao | selo [AAAA-MM-DD] | ancoras');
    return 2;
  }
  const { AppModule } = await import('../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const trava = app.get(TravaJobs);
    const selo = app.get(SeloService);
    if (comando === 'retencao') {
      const r = await trava.tentar('retencao', () => app.get(RetencaoService).aplicar({ ator: null, nomeInformado: `${NOME_AGENDADOR} via CLI` }));
      if (!r.obtida) { console.error('retenção já em andamento em outro processo'); return 3; }
      console.log(JSON.stringify(r.valor));
      return 0;
    }
    const r = await trava.tentar('selo', async () => {
      if (comando === 'ancoras') return { enviados: await selo.enviarPendentes(100) };
      const dia = arg ?? somarDias(diaBrt(new Date()), -1);
      if (!ehDiaValido(dia)) throw new Error('dia inválido (AAAA-MM-DD)');
      const s = await selo.selarDia(dia);
      return { dia, selo: s ? { id: s.selo.id, ultimoSeq: s.selo.ultimoSeq, novo: s.novo } : null, enviados: await selo.enviarPendentes(100) };
    });
    if (!r.obtida) { console.error('selo já em andamento em outro processo'); return 3; }
    console.log(JSON.stringify(r.valor));
    return 0;
  } finally {
    await app.close();
  }
}

principal().then((codigo) => process.exit(codigo)).catch((e) => {
  // Só a mensagem: erro de config é nosso texto; o do pg não traz a senha na mensagem.
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
