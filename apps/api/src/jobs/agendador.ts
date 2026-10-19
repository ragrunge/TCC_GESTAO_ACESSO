// Agendador interno (selo diário, âncoras pendentes, retenção). Escolha: timer DENTRO da API, não um serviço cron no
// compose. Motivos: a VPS tem pouca memória (a API roda com 384 MiB) e um segundo processo Node só para o cron custaria
// outra imagem e outro tanto de RAM; e o agendador não depende de horário exato. A cada `intervaloMin` ele pergunta ao
// BANCO o que falta (o selo de ontem existe? a retenção já rodou hoje?) e faz só isso. Assim:
//  - API reiniciada na hora "marcada" não perde o dia (recupera no próximo ciclo);
//  - várias réplicas não duplicam: a trava de job (advisory lock) pula quem chega depois, e cada passo é idempotente
//    no banco (selo diário único por dia, pessoa reconferida com a linha travada);
//  - nada depende de @nestjs/schedule (seria só um setInterval com decorator).
// Desligado com JOBS_AGENDADOR=false (testes e CLI). As rotinas continuam disponíveis sob demanda e pelo CLI.
import { Inject, Injectable, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { and, eq, gte } from 'drizzle-orm';
import { diaBrt, inicioDoDiaBrt } from '../comum/datas';
import { codigoPg } from '../comum/erros';
import { log } from '../comum/log';
import { RELOGIO, type Relogio } from '../comum/relogio';
import { CONFIG, type Config } from '../config/config';
import { DB, type Db } from '../database/database.module';
import { auditLog } from '../db/schema';
import { LgpdModule } from '../lgpd/lgpd.module';
import { RetencaoService } from '../lgpd/retencao.service';
import { NOME_AGENDADOR, SeloModule, SeloService } from '../selo/selo.module';
import { TravaJobs } from './trava';

const BRT_MS = 3 * 3600 * 1000;

@Injectable()
export class Agendador implements OnApplicationBootstrap, OnApplicationShutdown {
  private timers: NodeJS.Timeout[] = [];
  private rodando = false;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: Db,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(SeloService) private readonly selo: SeloService,
    @Inject(RetencaoService) private readonly retencao: RetencaoService,
    @Inject(TravaJobs) private readonly trava: TravaJobs,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.jobs.agendador) return;
    // Primeiro ciclo logo depois do boot (com folga para o pool e o healthcheck), depois a cada intervalo.
    const inicial = setTimeout(() => void this.ciclo(), 30_000);
    const periodico = setInterval(() => void this.ciclo(), this.config.jobs.intervaloMin * 60_000);
    inicial.unref(); periodico.unref();
    this.timers.push(inicial, periodico);
    log('info', 'agendador.ligado', { detalhe: `a cada ${this.config.jobs.intervaloMin} min; retenção a partir das ${this.config.jobs.horaRetencaoBrt}h BRT` });
  }

  onApplicationShutdown() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** Um ciclo: selo de ontem e âncoras pendentes; retenção, se já passou da hora e ainda não rodou hoje. */
  async ciclo(): Promise<void> {
    if (this.rodando) return; // ciclo anterior ainda em curso neste processo
    this.rodando = true;
    try {
      const s = await this.selo.rotinaDiaria();
      if (s && (s.selado || s.enviados)) log('info', 'agendador.selo', { detalhe: `selado=${s.selado} ancoras_enviadas=${s.enviados}` });
      const agora = this.relogio.agora();
      const horaBrt = new Date(agora.getTime() - BRT_MS).getUTCHours();
      if (horaBrt >= this.config.jobs.horaRetencaoBrt && !(await this.retencaoRodouHoje(agora))) {
        const r = await this.trava.tentar('retencao', () => this.retencao.aplicar({ ator: null, nomeInformado: NOME_AGENDADOR }));
        if (r.obtida) {
          const v = r.valor;
          log('info', 'agendador.retencao', { detalhe: `pessoas=${v.pessoaIds.length} eventos=${v.eventosDescartados} trilha=${v.trilhaDescartada} orfaos=${v.arquivosOrfaosRemovidos}` });
        }
      }
    } catch (e) {
      // Só códigos: o erro do driver pode trazer parâmetros de conexão.
      log('error', 'agendador.falhou', { codigo_pg: codigoPg(e), erro: e instanceof Error ? e.name : 'erro' });
    } finally {
      this.rodando = false;
    }
  }

  private async retencaoRodouHoje(agora: Date): Promise<boolean> {
    const [l] = await this.db.select({ id: auditLog.id }).from(auditLog)
      .where(and(eq(auditLog.acao, 'lgpd.retencao'), gte(auditLog.em, inicioDoDiaBrt(diaBrt(agora))))).limit(1);
    return !!l;
  }
}

@Module({ imports: [SeloModule, LgpdModule], providers: [Agendador] })
export class JobsModule {}
