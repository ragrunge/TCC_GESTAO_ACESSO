# Rastreabilidade: requisito funcional → API → tela

Cada linha liga um RF de `docs/01_requisitos.md` ao código que o implementa. Caminhos a partir da raiz do monorepo.
Regras puras compartilhadas (UI e API) ficam em `packages/domain/src/` (`rules.ts`, `rbac.ts`, `units.ts`, `hashChain.ts`).
A trilha RN/UC → arquivo mais detalhada está nos comentários do código (`git grep -n 'RF-'`).

| RF | Descrição resumida | API (`apps/api/src/`) | Tela (`apps/web/src/`) |
|---|---|---|---|
| RF-01 | Cadastro de unidades (bloco e número) | `unidades/unidades.controller.ts`, `unidades/unidades.service.ts`, `db/seed.ts` | `features/unidades/UnidadesPage.tsx` |
| RF-02 | Cadastro de pessoas (CPF, exceção sem CPF) | `pessoas/pessoas.module.ts`, `pessoas/pessoas.service.ts` | `features/cadastro/CadastroPage.tsx`, `features/cadastro/FichaPessoaModal.tsx` |
| RF-03, RF-04, RF-06 | Vínculo com a unidade, pendente até aprovação, quem aprovou/rejeitou | `vinculos/vinculos.controller.ts`, `vinculos/vinculos.service.ts` | `features/vinculos/VinculosPage.tsx` |
| RF-05 | Conferência do comprovante de vínculo | `vinculos/vinculos.controller.ts`, `vinculos/vinculos.service.ts` | `features/vinculos/VinculosPage.tsx` |
| RF-07 | Encerramento do vínculo no fim da vigência | `vinculos/vinculos.service.ts`, `vinculos/vinculo-valido.ts` | `features/vinculos/VinculosPage.tsx` |
| RF-08 | Veículos da unidade | `veiculos/veiculos.module.ts` | `features/unidades/UnidadeDetalhePage.tsx` |
| RF-09 | Funcionários, função e escala | `funcionarios/funcionarios.module.ts` | `features/funcionarios/FuncionariosPage.tsx`, `features/funcionarios/escala.ts` |
| RF-10 | Dispositivos de acesso (prioridade C) | não implementado | não implementado |
| RF-11 | Importação da planilha de moradores | `importacao/importacao.module.ts` | `features/importacao/ImportacaoPage.tsx`, `features/importacao/csv.ts` |
| RF-12, RF-13, RF-17 | Entrada e saída, quem autorizou, justificativa da exceção | `eventos/acesso.module.ts`, `eventos/eventos.service.ts` | `features/portaria/EntradaPage.tsx`; saída (UC07): `features/portaria/SaidaPage.tsx` (`/saida`, `?entrada=<id>`), `features/portaria/saida.tsx` (confirmação e saída retroativa) |
| RF-14 | Autorização prévia | `eventos/autorizacoes.service.ts`, `eventos/acesso.module.ts` | `features/unidades/UnidadeDetalhePage.tsx` |
| RF-15 | Restrições da unidade | `eventos/autorizacoes.service.ts`, `eventos/acesso.module.ts` | `features/unidades/UnidadeDetalhePage.tsx`, `features/portaria/PainelPage.tsx` |
| RF-16 | Bloqueio por restrição (evento `negado`) | `eventos/eventos.service.ts` | `features/portaria/EntradaPage.tsx`, `features/portaria/negado.ts` |
| RF-18, RF-34 | Busca de pessoa e reaproveitamento de cadastro | `pessoas/busca.service.ts`, `pessoas/pessoas.module.ts` | `components/PessoaPicker.tsx`, `features/portaria/EntradaPage.tsx` |
| RF-19 | Histórico de acessos | `eventos/eventos.service.ts`, `eventos/evento-view.ts`, `eventos/efetivo.ts` | `features/historico/HistoricoPage.tsx`, `features/historico/EventoGaveta.tsx` |
| RF-20 | Pessoas dentro do condomínio | `eventos/eventos.service.ts` (`presentes`) | `features/portaria/PessoasDentroPage.tsx`, `features/portaria/presentes.tsx` |
| RF-22, RF-23, RF-25, RF-26 | Encomendas: recebimento, conferência da unidade, retirada, atrasadas | `encomendas/encomendas.module.ts` | `features/encomendas/EncomendasPage.tsx` |
| RF-24 | Notificação da unidade (interfone no MVP) | fora do sistema no MVP | fora do sistema no MVP |
| RF-27, RF-28 | Ocorrências e vínculo com eventos | `ocorrencias/ocorrencias.module.ts`, `documentos/cofre.ts` | `features/ocorrencias/OcorrenciasPage.tsx` |
| RF-29, RF-38 | Passagem de turno e painel da portaria | `eventos/eventos.service.ts` (`resumoTurno`) | `features/portaria/PainelPage.tsx` |
| RF-30, RF-31 | Relatórios (acessos e liberações por exceção) | `relatorios/relatorios.module.ts`; CSV em `packages/domain/src/relatorio.ts` | `features/relatorios/RelatoriosPage.tsx` |
| RF-32, RF-37 | Exportação verificável e verificação de integridade da trilha | `auditoria/auditoria.controller.ts`, `db/cadeia.ts`, `selo/selo.module.ts`; formato em `packages/domain/src/exportacao.ts` e `hashChain.ts` | `features/historico/HistoricoPage.tsx`, `features/historico/SeloAncora.tsx`, `features/historico/TrilhaAlteracoes.tsx` |
| RF-33 | Gestão de usuários do sistema | `usuarios/usuarios.controller.ts`, `usuarios/usuarios.service.ts` | `features/usuarios/UsuariosPage.tsx` |
| RF-35 | Registro retroativo (contingência) | `eventos/eventos.service.ts`, `eventos/acesso.module.ts` | `features/portaria/EntradaPage.tsx` (`?retroativo=1`) |
| RF-36 | Prestador com empresa/serviço e áreas comuns | `eventos/eventos.service.ts`, `eventos/autorizacoes.service.ts`, `db/seed.ts` | `features/portaria/EntradaPage.tsx` |

RF-21 foi removido em 2026-10-17 (ver `docs/01_requisitos.md` §14).

Requisitos não funcionais com código próprio:

| RNF | Onde |
|---|---|
| RNF-01 (auditabilidade) | `apps/api/drizzle/` (triggers de imutabilidade), `apps/api/src/db/cadeia.ts`, `packages/domain/src/hashChain.ts` |
| RNF-02 (autenticação) | `apps/api/src/auth/` |
| RNF-03 (anexos cifrados) | `apps/api/src/documentos/cofre.ts` |
| RNF-04 (RBAC) | `packages/domain/src/rbac.ts`, `apps/api/src/auth/guards.ts` (`PapelGuard`), `RequireRole` em `apps/web/src/auth/AuthContext.tsx` |
| RNF-07 (teclado) | `apps/web/src/app/Layout.tsx` (F2 entrada, F8 saída, F3 encomenda, F4 ocorrência), `apps/web/src/features/portaria/EntradaPage.tsx`, `apps/web/src/features/portaria/SaidaPage.tsx`, `apps/web/src/components/TowerUnitPicker.tsx` |
| RNF-09 (retenção e LGPD) | `apps/api/src/lgpd/lgpd.service.ts`, `apps/api/src/lgpd/retencao.service.ts` |
