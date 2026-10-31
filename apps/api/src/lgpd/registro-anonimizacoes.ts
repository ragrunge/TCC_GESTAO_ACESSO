// Registro das anonimizações FORA do banco (LGPD art. 18, VI). Existe por causa do restore: a lista de quem foi
// anonimizado vive no banco (pessoa.anonimizada_em, retencao_execucao), e voltar um backup de antes do pedido desfaria
// a anonimização sem ninguém perceber. Aqui fica só (pessoa_id, motivo, quando): nenhum dado pessoal, e o pessoa_id
// aponta para uma linha já anonimizada.
//
// Arquivo append-only em JSON Lines (`PORTARIA_REGISTRO_ANONIMIZACOES`; padrão: `anonimizacoes.jsonl` na pasta dos
// anexos, que já fica fora do banco e do backup dele). Uma linha por pessoa: gravar de novo quem já está lá não faz nada.
// A varredura de órfãos da retenção só lista `<uuid>.bin`/`<uuid>.tmp`, então não toca este arquivo.
//
// Gravação em dois caminhos, ambos idempotentes:
//  1. logo depois do COMMIT da anonimização (a pedido). Se a gravação falhar, a anonimização vale do mesmo jeito e só
//     o registro atrasa;
//  2. na retenção diária, que copia de `retencao_execucao` (tipo 'pessoas') tudo o que faltar. Fecha a janela do item 1.
// A leitura (`todas`) alimenta a reaplicação depois de um restore (LgpdService.reaplicar).
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type Config } from '../config/config';

export interface AnonimizacaoRegistrada { pessoaId: string; motivo: 'pedido' | 'retencao'; anonimizadaEm: Date }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

@Injectable()
export class RegistroAnonimizacoes {
  private readonly arquivo: string;

  constructor(@Inject(CONFIG) config: Config) {
    this.arquivo = config.documentos.registroAnonimizacoes;
  }

  /** Linhas do arquivo, na ordem gravada. Arquivo ausente: nenhuma. Linha ilegível: erro (registro adulterado). */
  async todas(): Promise<AnonimizacaoRegistrada[]> {
    let texto: string;
    try {
      texto = await readFile(this.arquivo, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    return texto.split('\n').filter((l) => l.trim()).map((l) => {
      const x = JSON.parse(l) as { pessoa_id?: unknown; motivo?: unknown; em?: unknown };
      if (typeof x.pessoa_id !== 'string' || !UUID.test(x.pessoa_id) || (x.motivo !== 'pedido' && x.motivo !== 'retencao') || typeof x.em !== 'string') {
        throw new Error('registro de anonimizações com linha fora do formato');
      }
      return { pessoaId: x.pessoa_id, motivo: x.motivo, anonimizadaEm: new Date(x.em) };
    });
  }

  /** Grava o que ainda não está registrado. Devolve quantas linhas eram novas. */
  async registrar(itens: AnonimizacaoRegistrada[]): Promise<number> {
    if (!itens.length) return 0;
    const ja = new Set((await this.todas()).map((x) => x.pessoaId));
    const novas: string[] = [];
    for (const x of itens) {
      if (ja.has(x.pessoaId)) continue;
      ja.add(x.pessoaId);
      novas.push(JSON.stringify({ pessoa_id: x.pessoaId, motivo: x.motivo, em: x.anonimizadaEm.toISOString() }));
    }
    if (!novas.length) return 0;
    await mkdir(dirname(this.arquivo), { recursive: true, mode: 0o700 });
    await appendFile(this.arquivo, `${novas.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
    return novas.length;
  }
}
