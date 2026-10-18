// Gestão de usuários do sistema (spec §5.2, RNF-04): usuario.gerenciar (SI, AD); alvo ou papel "síndico" exige
// também usuario.gerenciar_sindico (só SI). Ninguém desativa, rebaixa ou redefine a si mesmo por aqui.
import { Inject, Injectable } from '@nestjs/common';
import { pode, type Acao } from '@portaria/domain/rbac';
import type { Papel } from '@portaria/domain/types';
import { asc, eq } from 'drizzle-orm';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { colunasPublicas, paraPublico, type UsuarioPublico } from '../auth/auth.service';
import { LimiteLoginService } from '../auth/limite-login.service';
import { SenhaService } from '../auth/senha.service';
import { SessaoService } from '../auth/sessao.service';
import type { Contexto } from '../auth/tipos';
import { AcessoNegado, codigoPg, erroApi } from '../comum/erros';
import { RELOGIO, type Relogio } from '../comum/relogio';
import { DB, type Db, type Tx } from '../database/database.module';
import { usuarioSistema } from '../db/schema';

type Alvo = Awaited<ReturnType<UsuariosService['travarAlvo']>>;

@Injectable()
export class UsuariosService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(SenhaService) private readonly senhas: SenhaService,
    @Inject(SessaoService) private readonly sessoes: SessaoService,
    @Inject(LimiteLoginService) private readonly limite: LimiteLoginService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * O guard decidiu com o papel lido no início da requisição. Dentro da transação, o ator é relido com FOR UPDATE:
   * fecha a janela em que ele foi desativado ou rebaixado nesse meio tempo, e serializa ações cruzadas (dois
   * síndicos desativando um ao outro: um deles recebe deadlock e nenhum sistema fica sem síndico ativo).
   */
  private async revalidarAtor(tx: Tx, ctx: Contexto, acao: Acao) {
    const [eu] = await tx.select({ papel: usuarioSistema.papel, ativo: usuarioSistema.ativo }).from(usuarioSistema)
      .where(eq(usuarioSistema.id, ctx.ator.id)).for('update');
    if (!eu?.ativo || !pode(eu.papel, acao)) throw new AcessoNegado(acao);
    return eu.papel;
  }

  private async travarAlvo(tx: Tx, id: string) {
    const [x] = await tx.select(colunasPublicas).from(usuarioSistema).where(eq(usuarioSistema.id, id)).for('update');
    if (!x) throw erroApi(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.');
    return x;
  }

  /** Administração não mexe em síndico (spec §5.2). */
  private exigirGestaoDeSindico(papelAtor: Papel, alvoOuNovo: Papel[]) {
    if (alvoOuNovo.includes('sindico') && !pode(papelAtor, 'usuario.gerenciar_sindico')) {
      throw new AcessoNegado('usuario.gerenciar_sindico', 'Só o síndico gerencia usuários com o papel de síndico.');
    }
  }

  private naoSiMesmo(ctx: Contexto, id: string, codigo: string, mensagem: string) {
    if (ctx.ator.id === id) throw erroApi(422, codigo, mensagem);
  }

  async listar(): Promise<UsuarioPublico[]> {
    const linhas = await this.db.select(colunasPublicas).from(usuarioSistema).orderBy(asc(usuarioSistema.nome));
    return linhas.map(paraPublico);
  }

  async criar(ctx: Contexto, i: { nome: string; login: string; papel: Papel }) {
    this.exigirGestaoDeSindico(ctx.ator.papel, [i.papel]);
    const senhaTemporaria = this.senhas.gerarTemporaria();
    const senhaHash = await this.senhas.gerarHash(senhaTemporaria); // fora da transação
    const agora = this.relogio.agora();
    try {
      const usuario = await this.db.transaction(async (tx) => {
        const papelAtor = await this.revalidarAtor(tx, ctx, 'usuario.gerenciar');
        this.exigirGestaoDeSindico(papelAtor, [i.papel]);
        const [novo] = await tx.insert(usuarioSistema).values({
          nome: i.nome, login: i.login, papel: i.papel, senhaHash, deveTrocarSenha: true, criadoEm: agora, atualizadoEm: agora,
        }).returning(colunasPublicas);
        await this.auditoria.registrar(tx, {
          ator: ctx.ator, acao: 'usuario.criar', entidade: 'usuario_sistema', registroId: novo!.id, ip: ctx.ip, depois: novo,
        });
        return novo!;
      });
      return { usuario: paraPublico(usuario), senhaTemporaria };
    } catch (e) {
      // Aqui a transação já terminou (rollback): traduzir o erro não depende de consultar o banco.
      if (codigoPg(e) === '23505') throw erroApi(409, 'LOGIN_EXISTENTE', 'Já existe um usuário com este login.');
      throw e;
    }
  }

  /** Escrita padrão sobre um alvo: revalida o ator, trava o alvo, aplica `fn` e audita antes/depois. */
  private async alterar(
    ctx: Contexto, id: string, acaoAuditoria: string, novoPapel: Papel | null,
    fn: (tx: Tx, alvo: Alvo, agora: Date) => Promise<Alvo | null>,
  ) {
    const agora = this.relogio.agora();
    return this.db.transaction(async (tx) => {
      const papelAtor = await this.revalidarAtor(tx, ctx, 'usuario.gerenciar');
      const antes = await this.travarAlvo(tx, id);
      this.exigirGestaoDeSindico(papelAtor, novoPapel ? [antes.papel, novoPapel] : [antes.papel]);
      const depois = await fn(tx, antes, agora);
      if (!depois) return paraPublico(antes); // nada mudou: sem linha de auditoria
      await this.auditoria.registrar(tx, {
        ator: ctx.ator, acao: acaoAuditoria, entidade: 'usuario_sistema', registroId: id, ip: ctx.ip, antes, depois,
      });
      return paraPublico(depois);
    });
  }

  desativar(ctx: Contexto, id: string) {
    this.naoSiMesmo(ctx, id, 'AUTO_DESATIVACAO', 'Você não pode desativar o próprio usuário.');
    return this.alterar(ctx, id, 'usuario.desativar', null, async (tx, alvo, agora) => {
      if (!alvo.ativo) return null;
      const [d] = await tx.update(usuarioSistema).set({ ativo: false, atualizadoEm: agora }).where(eq(usuarioSistema.id, id)).returning(colunasPublicas);
      // Desativar derruba as sessões abertas na mesma transação (o guard também recusa usuário inativo).
      await this.sessoes.revogarDoUsuario(tx, id, 'desativacao', agora);
      return d!;
    });
  }

  reativar(ctx: Contexto, id: string) {
    return this.alterar(ctx, id, 'usuario.reativar', null, async (tx, alvo, agora) => {
      if (alvo.ativo) return null;
      const [d] = await tx.update(usuarioSistema).set({ ativo: true, atualizadoEm: agora }).where(eq(usuarioSistema.id, id)).returning(colunasPublicas);
      return d!;
    });
  }

  alterarPapel(ctx: Contexto, id: string, papel: Papel) {
    this.naoSiMesmo(ctx, id, 'AUTO_ALTERACAO_PAPEL', 'Ninguém altera o próprio papel.');
    this.exigirGestaoDeSindico(ctx.ator.papel, [papel]);
    return this.alterar(ctx, id, 'usuario.alterar_papel', papel, async (tx, alvo, agora) => {
      if (alvo.papel === papel) return null;
      // O papel é lido a cada requisição pelo SessaoGuard: a mudança vale já na próxima, sem revogar sessão.
      const [d] = await tx.update(usuarioSistema).set({ papel, atualizadoEm: agora }).where(eq(usuarioSistema.id, id)).returning(colunasPublicas);
      return d!;
    });
  }

  async redefinirSenha(ctx: Contexto, id: string) {
    this.naoSiMesmo(ctx, id, 'AUTO_REDEFINICAO', 'Para mudar a própria senha, use "trocar senha".');
    const senhaTemporaria = this.senhas.gerarTemporaria();
    const senhaHash = await this.senhas.gerarHash(senhaTemporaria);
    const usuario = await this.alterar(ctx, id, 'usuario.redefinir_senha', null, async (tx, alvo, agora) => {
      const [d] = await tx.update(usuarioSistema)
        .set({ senhaHash, deveTrocarSenha: true, senhaAlteradaEm: agora, atualizadoEm: agora })
        .where(eq(usuarioSistema.id, id)).returning(colunasPublicas);
      await this.sessoes.revogarDoUsuario(tx, id, 'redefinicao_senha', agora);
      await this.limite.zerar(tx, this.limite.chave('login', alvo.login), agora); // desbloqueia o login do alvo
      return d!;
    });
    return { usuario, senhaTemporaria };
  }
}
