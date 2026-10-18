# Prompt para o Claude Design — Protótipo navegável

Como usar: copie todo o bloco abaixo da linha "INÍCIO DO PROMPT" e cole no Claude Design. Se
quiser, anexe também `01_requisitos.md` como referência. O prompt já funciona sozinho.

Gere em etapas se o resultado vier raso: primeiro o fluxo da portaria (T01 a T08), depois o da
administração (T09 a T14), pedindo para manter o mesmo sistema visual.

---

INÍCIO DO PROMPT

Crie um protótipo navegável, em alta fidelidade e em português do Brasil, de um sistema web de
controle de acesso e gestão de portaria para um condomínio residencial. O protótipo será usado
em um TCC de Sistemas de Informação para demonstrar os requisitos. Todas as telas devem estar
ligadas entre si: clicar em menus, botões e linhas de tabela leva à tela correspondente, e os
fluxos descritos em "Roteiros de demonstração" precisam funcionar de ponta a ponta com dados
simulados.

## Contexto

- Condomínio Residencial do Parque, São Paulo: 165 unidades em 9 torres (Torre 1 a Torre 9),
500 a 600 moradores, cerca de 175 veículos.
- Hoje o controle é feito em planilha Excel e caderno. Problemas reais relatados pelo síndico:
porteiro liberou uma visitante só por "reconhecer" a pessoa, o que gerou conflito grave na
unidade; um homem tentou se apossar de um apartamento apresentando contrato de locação falso
na portaria; ninguém consegue rastrear quem entrou, quando e quem autorizou; encomendas são
entregues para a unidade errada.
- O sistema existe para resolver esses quatro problemas. Toda tela deve deixar visível **quem
autorizou** e **quem registrou** cada ação.
- Referência de estilo de produto: softwares brasileiros de guarita e portaria, como o Nice
Guarita, só que mais modernos e simples.

## Usuários e dispositivo

- **Porteiro**: usa um PC desktop na guarita, 24h por dia, muitas vezes com pressa e com alguém
esperando no portão. Precisa operar quase só pelo teclado. Prioridade absoluta: rapidez e
clareza.
- **Administração e síndico**: desktop, tarefas de cadastro, aprovação e consulta.
- **Auditor (conselho fiscal)**: somente leitura de histórico e relatórios.
- Moradores **não** usam o sistema nesta versão.

Projete para desktop, 1440 × 900. Não faça versão mobile.

## Direção visual

- Interface de ferramenta operacional: sóbria, densa na medida certa, sem decoração.
- Fundo claro neutro, uma cor de destaque azul petróleo para ações primárias. Vermelho reservado
a bloqueio e restrição; âmbar a exceção e pendência; verde a confirmação. Nunca use cor como
único sinal: acompanhe com ícone e texto.
- Tipografia sem serifa legível (Inter ou similar). Texto base de 15 px; números de torre e
unidade em destaque grande quando precisam ser conferidos.
- Contraste WCAG 2.1 AA, foco de teclado sempre visível, alvos de clique de no mínimo 40 px.
- Atalhos de teclado visíveis nos botões da portaria (ex.: `F2 Nova entrada`, `F3 Encomenda`,
`F4 Ocorrência`, `Enter` confirmar, `Esc` cancelar).

## Estrutura de navegação

Barra lateral fixa à esquerda, com itens visíveis conforme o perfil logado:

- Portaria: Painel, Registrar entrada, Pessoas no condomínio, Encomendas, Ocorrências.
- Administração: Unidades, Vínculos pendentes (com contador), Pessoas, Importar planilha.
- Auditoria: Histórico de acessos, Relatórios.
- Sistema (só síndico): Usuários.

Barra superior: nome do condomínio, campo de busca global ("Buscar por nome, documento, unidade
ou placa"), relógio, nome do operador logado e o perfil, botão sair.

Inclua um seletor de perfil discreto na tela de login (Porteiro, Administração, Síndico,
Auditor) para a banca alternar entre visões durante a apresentação.

## Telas

**T01 — Login.** Usuário e senha. Para síndico e administração, segunda etapa com código de 6
dígitos (autenticação em dois fatores). Mensagem: "Cada operador usa o próprio login. Não
compartilhe sua senha."

**T02 — Painel da portaria.** Tela inicial do porteiro. Três atalhos grandes: Nova entrada (F2),
Encomenda (F3), Ocorrência (F4). Abaixo, quatro cartões de pendências do turno: pessoas no
condomínio agora (ex.: 14), encomendas aguardando retirada (ex.: 23), ocorrências abertas (ex.:
2), autorizações prévias de hoje (ex.: 6). Lista das últimas 10 movimentações com hora, nome,
unidade, tipo (visitante, prestador, funcionário) e meio de autorização. Botão "Passar turno"
que abre um resumo do turno para confirmar.

**T03 — Registrar entrada.** O fluxo mais importante. Passo a passo em uma única tela:

1. Campo de busca com foco automático. Ao digitar, sugestões com foto (ou avatar com iniciais),
 nome, documento mascarado (ex.: `***.456.789-**`), tipo e último acesso.
2. Opção "Pessoa sem cadastro" abre formulário curto: nome, tipo de documento, número, telefone,
 tipo (visitante ou prestador), empresa e serviço (se prestador), foto opcional com o texto
 "Opcional — a recusa não impede o cadastro".
3. Unidade de destino: seletor de torre e unidade, exibidos grandes depois de escolhidos
 ("TORRE 4 · AP 32").
4. O sistema verifica restrições e autorizações prévias. Se houver autorização prévia válida,
 mostrar cartão verde "Autorização prévia de Ana Ribeiro (morador, T4-32) válida até 30/11,
 seg a sex, 8h–18h" e preencher o autorizador.
5. Caso contrário, bloco "Quem autorizou?" com quatro opções: Interfone, Morador presente na
 portaria, Autorização prévia, Exceção do porteiro. Para interfone e morador presente, campo
 obrigatório com o nome do morador da unidade (lista dos moradores com vínculo aprovado).
6. Botão "Confirmar entrada (Enter)". O botão só habilita quando o autorizador está preenchido.
 Após confirmar, toast "Entrada registrada às 14:32 por Porteiro João Lima — autorizada por
 Ana Ribeiro via interfone" e retorno ao painel.

**T04 — Alerta de restrição.** Quando a pessoa buscada consta em restrição para a unidade
escolhida: modal vermelho bloqueante, ícone de proibido, "ENTRADA NÃO PERMITIDA PARA TORRE 4 ·
AP 32", motivo registrado pelo morador, quem cadastrou a restrição e quando. Botões: "Registrar
ocorrência" e "Cancelar". Não existe botão para liberar mesmo assim.

**T05 — Liberação por exceção.** Ao escolher "Exceção do porteiro": painel âmbar explicando que
a liberação ficará marcada e aparecerá no relatório de exceções. Campo de justificativa
obrigatório (mínimo 15 caracteres) com sugestões rápidas: "Morador não atende o interfone",
"Emergência médica", "Serviço público (luz, água, gás)".

**T06 — Pessoas no condomínio.** Tabela de quem entrou e ainda não saiu: nome, tipo, unidade,
hora de entrada, tempo de permanência, autorizado por. Botão "Registrar saída" em cada linha.
Destaque em âmbar para permanências acima de 8 horas.

**T07 — Encomendas.** Duas abas: Aguardando retirada e Entregues. Botão "Receber encomenda"
abre formulário: torre e unidade, destinatário, transportadora, código de rastreio. Antes de
salvar, confirmação com a unidade em fonte grande: "Confirma que a encomenda é para TORRE 7 ·
AP 11?". Na retirada: busca da pessoa; se ela tem vínculo com a unidade, botão "Confirmar
entrega"; se não tem, mensagem bloqueante "Esta pessoa não tem vínculo com a T7-11. Contate a
unidade." Encomendas com mais de 7 dias aparecem em âmbar.

**T08 — Ocorrências.** Lista com tipo, data, unidade, status. Formulário de nova ocorrência:
tipo (conflito, tentativa de acesso indevido, dano, encomenda, outro), descrição, unidade,
envolvidos, anexos, e "Vincular eventos de acesso" que abre a lista de movimentações recentes
para selecionar.

**T09 — Unidade (detalhe).** Cabeçalho "Torre 4 · Apartamento 32". Seções: moradores com tipo
de vínculo e status (aprovado, pendente, legado), veículos, autorizações prévias ativas (com
validade), restrições, histórico recente de acessos para a unidade. Botões: Nova autorização
prévia, Nova restrição, Solicitar vínculo.

**T10 — Vínculos pendentes.** Fila de solicitações: pessoa, unidade, tipo (proprietário,
inquilino, dependente), vigência, data da solicitação, quem solicitou. Ao abrir, visualização do
documento anexado ao lado dos dados, e os botões "Aprovar" e "Rejeitar" (rejeitar exige
justificativa). Faixa informativa: "Vínculo pendente não dá acesso de morador. Documento
apresentado na portaria não substitui esta aprovação." Inclua um caso pendente de inquilino com
contrato de locação para demonstrar o problema de fraude.

**T11 — Importar planilha.** Upload de arquivo `.xlsx` ou `.csv`, pré-visualização das linhas,
relatório de inconsistências (documento ausente, unidade inexistente, nome duplicado) e
resultado: "482 moradores importados com status Legado — prazo de regularização até
31/03/2027".

**T12 — Histórico e auditoria.** Filtros: período, unidade, pessoa, porteiro, tipo, meio de
autorização, somente exceções, somente retroativos. Tabela com todos os campos. Ao abrir um
evento: linha do tempo do evento, quem registrou, quem autorizou, e um selo "Integridade
verificada" (verde) com o código do registro. Botões: "Verificar integridade da trilha" e
"Exportar trilha (arquivo verificável)". Registros lançados depois por contingência aparecem com
etiqueta "Retroativo" mostrando a hora real e a hora do lançamento.

**T13 — Relatórios.** Cartões e gráficos simples: acessos por dia (últimos 30 dias), acessos por
meio de autorização, liberações por exceção por porteiro, encomendas pendentes por idade,
unidades com cadastro completo (%). Botão exportar PDF.

**T14 — Usuários do sistema.** Tabela de operadores: nome, perfil, status, último acesso,
segundo fator ativo. Ações: novo usuário, desativar (com aviso "o histórico do usuário é
mantido"), redefinir acesso.

## Roteiros de demonstração (devem funcionar clicando)

1. **Visitante com interfone:** login como Porteiro, F2, buscar "Marcos", escolher Torre 4 · AP
 32, escolher Interfone, selecionar morador "Ana Ribeiro", confirmar, ver o toast e a nova
 linha no painel.
2. **Pessoa em restrição:** F2, buscar "Bruno Teixeira", escolher Torre 4 · AP 32, ver o modal
 vermelho T04, registrar ocorrência.
3. **Exceção:** F2, buscar "Técnico Enel", Torre 2 · AP 104, escolher Exceção, justificar com
 "Serviço público", confirmar e ver a etiqueta âmbar no painel.
4. **Encomenda:** F3, receber para Torre 7 · AP 11, confirmar a unidade; depois tentar entregar
 para uma pessoa sem vínculo e ver o bloqueio.
5. **Fraude de locação:** login como Administração, abrir Vínculos pendentes, abrir a solicitação
 de "Rodrigo Alves — inquilino — T9-21", ver o contrato, rejeitar com justificativa.
6. **Auditoria:** login como Auditor, Histórico, filtrar "somente exceções", abrir o evento do
 roteiro 3, verificar integridade, exportar.

## Dados simulados

Use apenas nomes fictícios e documentos mascarados. Torres 1 a 9, unidades no formato de andar
e número (11, 12, 21 ... 104). Inclua: moradores Ana Ribeiro (T4-32, proprietária), Carla Mendes
(T7-11, inquilina); visitante Marcos Pereira; Bruno Teixeira com restrição na T4-32 (motivo:
"Morador não autoriza a entrada"); prestador Técnico Enel; inquilino pendente Rodrigo Alves
(T9-21); porteiros João Lima e Sérgio Matos; administração Paula Nogueira; síndico Roberto
Faria; auditora Luíza Campos.

## Não inclua

Financeiro, boletos, reservas de áreas comuns, comunicados, aplicativo do morador, câmeras,
reconhecimento facial ou biometria. Não crie nenhuma tela que permita editar ou excluir um
registro de acesso: correção só por novo registro com justificativa.

FIM DO PROMPT