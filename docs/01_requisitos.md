# Sistema de Controle de Acesso e Gestão de Portaria — Documento de Requisitos

> Proposta conceitual para um condomínio residencial vertical na cidade de São Paulo–SP, aqui chamado apenas de "o condomínio". O nome do condomínio e o do entrevistado foram omitidos para preservar a identidade dos participantes. Insumo para a seção **4. Resultados** do artigo *Controle e Gestão de Acesso em Condomínio Residencial: contribuições para a segurança patrimonial, administrativa e jurídica*. Especificação técnica de implementação: `02_especificacao_tecnica.md`. Diagramas de casos de uso: `../diagramas/` (seção 12).

| Item | Valor |
| --- | --- |
| Versão | 0.3 |
| Data | 2026-10-17 |
| Fonte primária | Entrevista semiestruturada com o síndico do condomínio, 16/05/2026 (10 perguntas, respostas escritas e assinadas) |
| Referência de mercado | Modelo de cadastro e eventos do Nice/Linear-HCS Guarita |
| Alterações nesta versão | Ver seção 14 |

---

## 1. Contexto

| Característica | Valor |
| --- | --- |
| Unidades | 165 |
| Torres | 9 |
| Moradores (estimativa) | 500 a 600 |
| Veículos cadastrados | ~175 |
| Portaria | 1 portaria social, 24h, equipe orgânica (própria) |
| Controle atual de moradores | Planilha Excel |
| Controle atual de funcionários e encomendas | Caderno manual |
| Sistema informatizado | Nenhum |
| Hardware de acesso | Nenhum |

### 1.1 Problemas levantados na entrevista

Cada problema recebe um código (P) usado na matriz de rastreabilidade (seção 9).

| Código | Problema | Evidência (pergunta) |
| --- | --- | --- |
| P1 | Liberação por "reconhecimento" do porteiro, sem consulta ao morador. Caso: ex-namorada liberada, conflito na unidade e ameaça judicial. | Q3 |
| P2 | Tentativa de apropriação indébita de unidade com "possível documentação de locação" apresentada na portaria. | Q3 |
| P3 | Impossibilidade de rastrear quem entrou, quando e quem autorizou. | Q6 |
| P4 | Encomendas entregues a unidades erradas. | Q6 |
| P5 | Cadastro de visitantes, prestadores e funcionários desorganizado; falhas recorrentes. | Q1, Q5 |
| P6 | Resistência de moradores a fornecer dados pessoais, fotos e biometria. | Q7 |
| P7 | Cultura "porque eu pago posso tudo", concentrada em moradores mais antigos e idosos. | Q2, Q10 |
| P8 | Soluções de mercado percebidas como complexas, incompletas e caras. | Q8 |
| P9 | Regimento e convenção insuficientes para sustentar exigências de cadastro. | Q7, Q9 |

### 1.2 Medida já adotada pelo condomínio

Após os incidentes, a administração passou a exigir comprovação de compra ou locação por e-mail antes da entrada de novo morador (Q5). O sistema formaliza essa prática registrando a conferência do comprovante (RF-05, RF-06, RN-02). O arquivo do comprovante continua fora do sistema: o condomínio não precisa guardar o contrato de locação para provar que conferiu, e a minimização dos dados (LGPD, art. 6º, III) recomenda não guardá-lo.

---

## 2. Escopo

### 2.1 Dentro do escopo

| Módulo | Finalidade |
| --- | --- |
| M1 — Cadastro e vínculo | Unidades, pessoas, vínculos com a unidade (proprietário, inquilino, dependente), veículos, funcionários e dispositivos de acesso |
| M2 — Controle de acesso | Registro de entradas e saídas, autorização de visitantes e prestadores, restrições, trilha de auditoria |
| M3 — Encomendas | Recebimento, notificação e retirada confirmada |
| M4 — Ocorrências e relatórios | Livro de ocorrências digital e relatórios gerenciais e de auditoria |

### 2.2 Fora do escopo

| Item | Motivo |
| --- | --- |
| Financeiro (boletos, inadimplência) | Já coberto por administradoras; aumentaria custo (P8) |
| Portaria remota | Condomínio opera portaria presencial; mudança contratual fora do objeto |
| Integração com hardware no MVP | Condomínio não possui equipamento; integração prevista como fase posterior |
| Biometria e reconhecimento facial no MVP | Sem hardware que os utilize; coletar sem uso fere o princípio da necessidade (LGPD, art. 6º, III) e alimenta a resistência (P6) |
| CFTV e gravação de imagens | Sistema distinto, com regras próprias de retenção |
| Reservas de áreas comuns, comunicados, assembleias | Não apontados como dor pelo síndico |
| Aplicativo do morador (autorização de visitante por QR Code) | O morador não opera o sistema. Toda autorização passa pela portaria ou pela administração |
| Registro de entrada e saída de moradores | Sem hardware, registrar manualmente 500 a 600 moradores é inviável. O registro passa a existir na fase com dispositivos de acesso (RF-10) |

---

## 3. Atores

| Ator | Descrição | Acesso ao sistema |
| --- | --- | --- |
| Síndico | Responsável legal (CC, art. 1.348). Aprova vínculos, consulta relatórios. | Sim |
| Administração | Equipe de apoio ao síndico (zeladoria, administradora). Mantém cadastros. | Sim |
| Porteiro | Opera a portaria 24h. Registra acessos, encomendas e ocorrências. | Sim, login individual |
| Conselho fiscal / auditor | Consulta trilha de auditoria e relatórios, sem editar. | Sim, somente leitura |
| Morador | Proprietário, inquilino ou dependente vinculado a uma unidade. Autoriza visitantes pelo interfone ou pela administração. | Não opera o sistema (interação via portaria, interfone e administração) |
| Visitante | Pessoa sem vínculo, com acesso pontual. | Não |
| Prestador de serviço | Pessoa ou empresa com acesso recorrente ou agendado a uma unidade ou à área comum. | Não |
| Funcionário do condomínio | Equipe orgânica com acesso por escala. | Não |

---

## 4. Requisitos funcionais

Prioridade: **M** = obrigatório no MVP, **S** = desejável no MVP, **C** = fase posterior.

**Critério do MVP.** O núcleo do sistema é registrar cada acesso com a identificação de quem o autorizou, de forma rastreável e auditável. Um requisito é **M** quando atende a pelo menos uma das condições abaixo, ressalvada a regra do C:

1. sem ele, um problema da entrevista (P1 a P9, coluna Origem) fica sem tratamento;
2. é passo obrigatório de um caso de uso principal (UC02, UC08, UC15/UC17, UC21/UC23, UC30/UC31);
3. é o único requisito que produz uma métrica da matriz de indicadores (seção 9);
4. é pré-requisito da implantação (seção 8).
5. é pré-requisito técnico de outro requisito M (por exemplo, RF-01 para o registro de acesso do RF-12; RF-08 para a busca por placa do RF-34) ou decorre de obrigação legal (por exemplo, RNF-08, Lei 13.146/2015).

Requisitos que melhoram a produtividade, mas cuja falta não impede nenhum dos itens acima, são **S**. Requisitos que dependem de hardware de acesso são **C**. A regra do C prevalece sobre as condições de M. Na matriz da seção 9, os requisitos S estão marcados com "(S)": apoiam a métrica, mas não são indispensáveis a ela. A seção 4.5 resume o MVP resultante.

### M1 — Cadastro e vínculo

| ID | Requisito | Prioridade | Origem |
| --- | --- | --- | --- |
| RF-01 | Cadastrar unidades por torre e número. | M | Contexto |
| RF-02 | Cadastrar pessoas com nome, CPF e telefone (obrigatórios) e foto opcional. Pessoa sem CPF é cadastrada como exceção e só entra por liberação do porteiro com justificativa (RF-17). O CPF é guardado apenas mascarado, mais um código de busca (HMAC com chave secreta); o número completo não é armazenado. | M | P5 |
| RF-03 | Vincular pessoa a unidade com tipo de vínculo (proprietário, inquilino, dependente) e período de vigência. | M | P2 |
| RF-04 | Manter o vínculo em estado **pendente** até a aprovação da administração; vínculo pendente não autoriza acesso. | M | P2 |
| RF-05 | Registrar a conferência do comprovante de vínculo apresentado à administração (tipo de documento, data, quem conferiu), sem armazenar o arquivo. | M | P2, Q5 |
| RF-06 | Registrar quem aprovou ou rejeitou o vínculo, quando e com qual justificativa. | M | P2, P3 |
| RF-07 | Encerrar vínculo automaticamente no fim da vigência do contrato de locação. | S | P2 |
| RF-08 | Cadastrar veículos (placa, modelo, cor) vinculados à unidade. | M | Contexto |
| RF-09 | Cadastrar funcionários do condomínio com função e escala. | M | P5 |
| RF-10 | Cadastrar dispositivos de acesso (tag, controle, cartão) vinculados a pessoa, unidade e, quando aplicável, veículo. Cada dispositivo pode ser liberado para pontos de acesso específicos. | C | Referência Guarita |
| RF-11 | Importar a planilha Excel atual de moradores, com relatório de inconsistências. | M | Contexto |
| RF-33 | Gerenciar usuários do sistema: criar, desativar e redefinir acesso de operadores, atribuindo papel. Desativação não apaga o histórico do usuário. | M | RN-05 |
| RF-34 | Buscar pessoa por nome, CPF, unidade ou placa a partir de um único campo na tela da portaria. | M | P5 |

### M2 — Controle de acesso

| ID | Requisito | Prioridade | Origem |
| --- | --- | --- | --- |
| RF-12 | Registrar entrada e saída de visitantes, prestadores e funcionários, com ponto de acesso, data e hora. | M | P3 |
| RF-13 | Exigir, para todo acesso de não morador, a identificação de **quem autorizou** e por qual meio: interfone, morador presente na portaria, autorização prévia ou exceção do porteiro. Funcionário do condomínio em horário de escala tem a escala como meio; prestador recorrente usa autorização prévia. | M | P1, P3 |
| RF-14 | Registrar, a pedido do morador, autorizações prévias (pessoa, unidade ou área comum, validade, dias e horários), pela portaria ou pela administração. Autorização sem morador solicitante só com justificativa, e ela conta como liberação por exceção no relatório RF-31, atribuída a quem a cadastrou. | M | P1, P5 |
| RF-15 | Manter lista de **restrições** por unidade: pessoas que o morador não autoriza, com motivo e validade. | M | P1 |
| RF-16 | Bloquear o registro de entrada, com alerta e motivo, quando a pessoa constar em restrição para a unidade de destino. | M | P1 |
| RF-17 | Exigir justificativa textual quando o porteiro liberar acesso por exceção (morador não atende, urgência). | M | P1 |
| RF-18 | Reaproveitar o cadastro de visitantes e prestadores frequentes, sem nova digitação. | S | P5 |
| RF-19 | Consultar o histórico de acessos por pessoa, unidade, período e porteiro. | M | P3 |
| RF-20 | Exibir quem está dentro do condomínio no momento (entradas sem saída correspondente). | S | P3 |
| RF-21 | *Removido em 2026-10-17: fora do escopo, porque o morador não opera o sistema.* | — | — |
| RF-35 | Lançar registro retroativo de acesso feito durante contingência, com data e hora reais da ocorrência, marcado como retroativo e com identificação de quem lançou. | M | RNF-05 |
| RF-36 | Registrar o acesso de prestador com empresa, serviço e unidade ou área atendida. | M | P5 |

### M3 — Encomendas

| ID | Requisito | Prioridade | Origem |
| --- | --- | --- | --- |
| RF-22 | Registrar recebimento de encomenda com unidade de destino, destinatário, transportadora, código de rastreio e porteiro responsável. | M | P4 |
| RF-23 | Exigir conferência da unidade de destino no registro (torre + número exibidos para confirmação). | M | P4 |
| RF-24 | Notificar a unidade sobre encomenda pendente (interfone no MVP; mensagem automática na fase posterior). | S | P4 |
| RF-25 | Registrar a retirada com identificação de quem retirou, vínculo com a unidade e data e hora. | M | P4 |
| RF-26 | Listar encomendas pendentes há mais de N dias. | S | P4 |

### M4 — Ocorrências e relatórios

| ID | Requisito | Prioridade | Origem |
| --- | --- | --- | --- |
| RF-27 | Registrar ocorrências com tipo, descrição, envolvidos, unidade e anexos. | M | P1, P2 |
| RF-28 | Vincular uma ocorrência aos eventos de acesso relacionados. | S | P3 |
| RF-29 | Passagem de turno: resumo do turno com ocorrências abertas e encomendas pendentes. | S | P5 |
| RF-30 | Relatório de acessos por período, unidade, tipo de pessoa e meio de autorização. | M | P3 |
| RF-31 | Relatório de liberações por exceção, por porteiro. | M | P1 |
| RF-32 | Exportar a trilha de auditoria de um evento ou período em formato verificável, para uso administrativo ou judicial. | M | P3, P9 |
| RF-37 | Verificar a integridade da trilha de auditoria e apontar qualquer registro adulterado. | M | RNF-01 |
| RF-38 | Painel inicial da portaria com pendências do turno: encomendas aguardando retirada, ocorrências abertas e autorizações prévias do dia. | S | P5 |

### 4.5 Resumo do MVP

| Módulo | M (MVP) | S (desejável) | C (fase posterior) |
| --- | --- | --- | --- |
| M1 — Cadastro e vínculo | RF-01 a RF-06, RF-08, RF-09, RF-11, RF-33, RF-34 | RF-07 | RF-10 |
| M2 — Controle de acesso | RF-12 a RF-17, RF-19, RF-35, RF-36 | RF-18, RF-20 | — |
| M3 — Encomendas | RF-22, RF-23, RF-25 | RF-24, RF-26 | — |
| M4 — Ocorrências e relatórios | RF-27, RF-30, RF-31, RF-32, RF-37 | RF-28, RF-29, RF-38 | — |
| **Total** | **28** | **8** | **1** |

Requisitos não funcionais no MVP: RNF-01 a RNF-11 (seção 6). Regras de negócio no MVP: todas (RN-01 a RN-11).

O RF-21 foi removido e não entra nos totais (1 removido); o ID não é reaproveitado.

O artigo apresenta este resumo; esta especificação é a referência completa.

---

## 5. Regras de negócio

| ID | Regra |
| --- | --- |
| RN-01 | Nenhuma entrada de não morador é registrada sem o campo "autorizado por" preenchido. |
| RN-02 | Novo morador ou inquilino só ganha acesso após a aprovação do vínculo pela administração, com o comprovante conferido (RF-05) e cadastro completo (CPF e telefone). Apresentar documento ao porteiro não basta. |
| RN-03 | Porteiro não aprova vínculo. Aprovação é exclusiva de síndico ou administração. |
| RN-04 | Registro de acesso não pode ser alterado nem excluído. Correção é feita por novo registro que referencia o original, com justificativa. |
| RN-05 | Cada operador usa login individual. Login compartilhado na portaria é proibido, pois anula a rastreabilidade. |
| RN-06 | Restrição pedida por um morador, e registrada pela portaria ou pela administração com o nome do solicitante, vale para a unidade dele. Restrição para todo o condomínio exige aprovação do síndico. |
| RN-07 | Autorização prévia tem validade obrigatória. Não existe autorização por prazo indeterminado. |
| RN-08 | Encomenda só é entregue a pessoa com vínculo aprovado à unidade de destino ou a pessoa autorizada por ela. |
| RN-09 | Moradores importados da planilha entram com status "legado" e prazo, definido em assembleia, para ter o comprovante de vínculo conferido (RF-05). Ao fim do prazo, a administração revisa os pendentes. |
| RN-10 | Foto da pessoa é opcional. A recusa não impede o cadastro. |
| RN-11 | Toda decisão de acesso tomada por um usuário do sistema (entrada, recusa do morador ou negativa por restrição) gera registro imutável com o usuário e o papel no momento, o meio de autorização, quem autorizou ou recusou, a autorização prévia ou a justificativa quando houver, a data e a hora do fato e do registro, e o ponto de acesso. Toda criação, alteração ou revogação de cadastro, vínculo, autorização prévia, restrição, encomenda, ocorrência e usuário, assim como login, logout e tentativa sem permissão, entra na trilha de alterações com os valores antes e depois, sem dado pessoal em claro. |

---

## 6. Requisitos não funcionais

| ID | Categoria | Requisito | Prioridade | Origem |
| --- | --- | --- | --- | --- |
| RNF-01 | Auditabilidade | Registros de acesso protegidos contra alteração e exclusão, com verificação de integridade (encadeamento de hashes). | M | P3, P9 |
| RNF-02 | Segurança | Autenticação individual; senhas armazenadas com hash forte (argon2id). Segundo fator (TOTP) para síndico e administração fica para a fase de segurança, após o MVP. | M | P3, RN-05 |
| RNF-03 | Segurança | Comunicação criptografada (TLS) e fotos e anexos de ocorrência criptografados em repouso. | M | P6 |
| RNF-04 | Controle de acesso lógico | Permissões por papel (síndico, administração, porteiro, auditor), com privilégio mínimo. | M | P3, RN-03 |
| RNF-05 | Disponibilidade | Portaria é 24h: o sistema precisa de procedimento de contingência documentado para queda de internet ou energia, com lançamento posterior marcado como retroativo. | M | P3 |
| RNF-06 | Desempenho | Registro de visitante já cadastrado em até 30 segundos de operação; consulta de restrição em até 1 segundo. | M | P1, P5 |
| RNF-07 | Usabilidade | Tela da portaria operável só por teclado, com fluxo principal em no máximo 3 telas. | M | P7 |
| RNF-08 | Acessibilidade | Interfaces administrativas aderentes às WCAG 2.1 nível AA, por obrigação legal (Lei 13.146/2015, art. 63) e porque a portaria é operada só por teclado (RNF-07). Nenhum fluxo exige que o morador use aplicativo. | M | P7, Lei 13.146/2015 |
| RNF-09 | Privacidade | Coleta mínima: só os dados listados na seção 7. Política de retenção aplicada automaticamente. | M | P6 |
| RNF-10 | Preservação dos dados | Backup diário automatizado do banco de dados, usando o recurso nativo do provedor de hospedagem, com teste de restauração periódico. Garante que a trilha de auditoria (RNF-01) e as evidências exportáveis (RF-32) não se percam em caso de falha. | M | P3, P9 |
| RNF-11 | Custo | Executável em um computador comum na guarita e hospedagem de baixo custo, sem licença por unidade. | M | P8 |
| RNF-12 | Extensibilidade | Camada de integração isolada para ligar hardware de acesso no futuro, sem alterar as regras de negócio. | C | Referência Guarita |

**Por que backup e não sincronização (RNF-10).** O sistema é web, com banco central. Sincronização só faria sentido com um cliente offline na guarita, o que contradiz a contingência manual com lançamento retroativo (RNF-05, RF-35) e quebraria a ordem única exigida pelo encadeamento de hashes (RNF-01). Além disso, sincronizar replica erros e exclusões; só o backup permite restaurar um estado anterior. Um modo offline com sincronização fica registrado como evolução futura.

---

## 7. Proteção de dados (LGPD)

O condomínio é o **controlador** (Lei 13.709/2018, art. 5º, VI), representado pelo síndico. A empresa fornecedora do sistema, se houver, é **operadora** (art. 5º, VII).

| Dado | Titular | Finalidade | Base legal (proposta) | Retenção (proposta) |
| --- | --- | --- | --- | --- |
| Nome, CPF (guardado mascarado, com código de busca HMAC) e telefone | Morador | Identificação, vínculo com a unidade e contato | Legítimo interesse — segurança da coletividade (art. 7º, IX), respaldado no regimento interno | Enquanto houver vínculo + 3 anos |
| Nome, CPF (mascarado e HMAC) e telefone; empresa e serviço, no caso do prestador | Visitante, prestador | Registro de acesso. O telefone serve para contato em caso de ocorrência ou de pendência do acesso | Legítimo interesse (art. 7º, IX) | 3 anos após o último acesso |
| Registro da conferência do comprovante (tipo, data, responsável) | Morador | Prevenção de fraude na ocupação da unidade (P2) | Legítimo interesse (art. 7º, IX); exercício regular de direitos (art. 7º, VI) | Enquanto houver vínculo + 3 anos |
| Foto (opcional) | Morador, prestador | Identificação visual pelo porteiro | Consentimento (art. 7º, I) — por ser opcional | Até a revogação ou o fim do vínculo |
| Veículo (placa, modelo, cor), vinculado à unidade | Morador | Identificação do veículo na portaria | Legítimo interesse (art. 7º, IX) | Enquanto houver vínculo + 3 anos |
| Operador, usuário do sistema (nome, login, papel, registros de ação) | Porteiro, administração, síndico, auditor | Rastreabilidade das decisões e ações (RN-11) | Exercício regular de direitos (art. 7º, VI) | Enquanto ativo + 3 anos |
| Funcionário do condomínio (função e escala) | Funcionário | Controle de acesso por escala | Execução de contrato (art. 7º, V) | Enquanto durar o contrato de trabalho + 3 anos |
| Eventos de acesso, incluindo negado e recusado | Todos | Rastreabilidade e defesa em processo | Exercício regular de direitos (art. 7º, VI) | 3 anos a partir da data do evento |
| Trilha de alterações | Todos | Rastreabilidade das alterações de cadastro e de permissões (RN-11) | Exercício regular de direitos (art. 7º, VI) | 3 anos a partir da data do registro |
| Biometria (fase posterior) | Morador | Autenticação no acesso | Prevenção à fraude e segurança do titular em processos de identificação e autenticação (art. 11, II, "g") | Enquanto houver vínculo; exclusão imediata depois |

Observações:

- O condomínio é o controlador. O canal do titular é o atendimento presencial ou por e-mail na administração, com registro do pedido. A resposta sai em até 15 dias (art. 19, II).
- O condomínio indica o encarregado pelo tratamento de dados pessoais (art. 41) e divulga seu nome e canal de contato. A eventual flexibilização aplicável a agentes de tratamento de pequeno porte (Resolução CD/ANPD nº 2/2022) precisa de validação jurídica.
- O aviso de privacidade é entregue impresso ou afixado no mural, junto ao regimento, porque nenhum titular usa aplicativo.
- Direitos do art. 18: o acesso é atendido por exportação dos dados da pessoa; a correção é feita pela administração; a eliminação é feita por anonimização. Eventos de acesso e trilha de alterações ficam retidos até o fim do prazo, por exercício regular de direitos.
- O evento de acesso referencia pessoas por identificador, sem copiar o nome, para que a anonimização não quebre a verificação de integridade (RNF-01).
- A anonimização apaga também o código de busca do CPF (HMAC). Como ele é determinístico, mantê-lo permitiria reidentificar a pessoa a partir de um CPF conhecido.
- Campos de texto livre (justificativa, observação) não devem conter nome nem documento de terceiros. Isso entra no treinamento (seção 8, etapa 4).
- Não há armazenamento do arquivo do comprovante de vínculo: registra-se só a conferência. Isso atende à minimização (art. 6º, III); o condomínio não precisa guardar contrato de locação para provar que conferiu.
- A retenção de 3 anos acompanha o prazo de prescrição da pretensão de reparação civil (CC, art. 206, § 3º, V). É uma proposta técnica: precisa de validação jurídica e aprovação em assembleia.
- Biometria é dado pessoal sensível (art. 5º, II). A hipótese do art. 11, II, "g" dispensa o consentimento, mas não dispensa transparência, necessidade e segurança. Precisa de relatório de impacto (art. 38) antes de ser adotada.

---

## 8. Diretrizes de implantação

O próprio síndico afirma que a tecnologia sozinha não resolve: é preciso equipe treinada e mudança de cultura (Q10). A implantação, portanto, é um processo organizacional.

| Etapa | Ação | Responde a |
| --- | --- | --- |
| 1 | Aprovar em assembleia a alteração do regimento interno, tornando obrigatório o cadastro mínimo e a validação de vínculo. Alteração da convenção exige 2/3 dos votos dos condôminos (CC, art. 1.351). | P9, P6 |
| 2 | Publicar aviso de privacidade em linguagem simples (quais dados, para quê, por quanto tempo), entregue impresso ou afixado no mural, junto ao regimento. | P6 |
| 3 | Importar a planilha atual (RF-11) e iniciar o prazo de regularização dos moradores legados (RN-09). | P5 |
| 4 | Treinar os porteiros, com ênfase em RN-01, RN-05, no fluxo de exceção e na regra de que campos de texto livre (justificativa, observação) não levam nome nem documento de terceiros. | P1, P7 |
| 5 | Operar em paralelo com o caderno por 30 dias e depois desativá-lo. | Risco de transição |
| 6 | Atendimento presencial na administração para moradores sem familiaridade com tecnologia. | P7 |
| 7 | Revisar após 90 dias os indicadores da seção 9. | Validação |

---

## 9. Matriz de rastreabilidade e indicadores

Os indicadores são os três definidos na metodologia do artigo: Conformidade Legal (CL), Mitigação de Risco Operacional (MR) e Aceitação Tecnológica — TAM (AT).

| Problema | Requisitos e regras | Indicador | Métrica de verificação |
| --- | --- | --- | --- |
| P1 Liberação por reconhecimento | RF-13, RF-15, RF-16, RF-17, RF-31, RN-01 | MR | % de acessos com "autorizado por" = 100%; nº de liberações por exceção por mês |
| P2 Fraude de locação | RF-03 a RF-06, RF-07 (S), RN-02, RN-03 | MR, CL | Nº de vínculos ativos sem aprovação e sem conferência registrada = 0 (fora os legados no prazo) |
| P3 Sem rastreabilidade | RF-12, RF-19, RF-28 (S), RF-32, RN-04, RN-11, RNF-01, RNF-10 | MR, CL | Tempo para responder "quem entrou, quando, quem autorizou" sobre um evento |
| P4 Encomenda errada | RF-22, RF-23, RF-24 (S), RF-25, RF-26 (S), RN-08 | MR | Nº de encomendas entregues à unidade errada por mês |
| P5 Cadastro desorganizado | RF-02, RF-09, RF-11, RF-18 (S) | MR | % de unidades com cadastro completo |
| P6 Resistência a dados | Seção 7, RN-10, biometria fora do MVP | CL, AT | Nº de recusas de cadastro; percepção de utilidade em questionário TAM |
| P7 Cultura e idosos | RNF-07, RNF-08, etapa 6 | AT | Percepção de facilidade de uso (TAM) entre porteiros e moradores |
| P8 Custo e complexidade | Escopo enxuto, RNF-11 | AT | Custo mensal total por unidade |
| P9 Regimento insuficiente | Etapa 1, RF-32 | CL | Regimento alterado e aprovado |

---

## 10. Referência de mercado: modelo Guarita

Do Nice/Linear-HCS Guarita, o sistema herda o **modelo de dados**, não o hardware:

- cada dispositivo de acesso (tag, controle, cartão, biometria) é vinculado a uma pessoa, uma unidade e, quando aplicável, um veículo;
- cada dispositivo é liberado para pontos de acesso específicos (portão social, garagem);
- os eventos de acesso são registrados em tempo real, incluindo eventos especiais (pânico, dispositivo clonado).

Diferenças deliberadas em relação a esse modelo:

| Guarita | Esta proposta | Motivo |
| --- | --- | --- |
| Centrado no dispositivo | Centrado na pessoa e no vínculo validado | P2: o problema começa no cadastro, não no portão |
| Foco em moradores com dispositivo | Visitantes, prestadores e encomendas são do mesmo nível | P1, P4, P5 |
| Hardware obrigatório | Software primeiro, hardware opcional | P8, condomínio sem equipamento |

---

## 11. Riscos e limitações

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Autorização via interfone continua dependendo da palavra do porteiro | O registro diz "morador X autorizou", sem prova técnica | Registrar o morador que atendeu; preferir a autorização prévia registrada na administração (RF-14); liberações sem morador ficam no relatório de exceções (RF-31). Risco residual aceito |
| Porteiro deixar de registrar acessos | Lacunas na trilha | Relatório de "pessoas dentro" (RF-20) e conferência na passagem de turno |
| Assembleia não aprovar a alteração do regimento | Cadastro continua facultativo; P6 e P9 persistem | Apresentar casos reais (Q3) e o risco jurídico ao síndico como argumento |
| Morador continua entrando por reconhecimento visual no MVP | Pessoa que se passa por morador não é barrada pelo sistema | Consulta rápida por unidade e foto (RF-34); dispositivos de acesso na fase posterior (RF-10) |
| Prazo de regularização dos legados vence sem comprovante conferido (RN-09) | Indefinição sobre manter ou suspender o acesso | Decisão da assembleia, registrada no regimento |
| Estudo de caso único | Requisitos podem não se generalizar | Limitação declarada no artigo |

---

## 12. Casos de uso

Os diagramas UML ficam em `../diagramas/`. O arquivo `.puml` é a fonte editável; o `.svg` e o `.png` são as imagens para o artigo.

| Figura | Arquivo | Conteúdo |
| --- | --- | --- |
| Diagrama 1 | `../diagramas/uc1_portaria.svg` | Operação da portaria (M2, M3, M4) |
| Diagrama 2 | `../diagramas/uc2_administracao.svg` | Cadastro, vínculo e regras de acesso (M1, M2) |
| Diagrama 3 | `../diagramas/uc3_auditoria.svg` | Auditoria, relatórios e rotinas automáticas (M1, M4) |

Para regerar as imagens: `java -jar plantuml.jar -tsvg -tpng ../diagramas/uc*.puml` (exige Java e Graphviz).

### 12.1 Atores do diagrama

Além dos atores da seção 3, o diagrama usa:

- **Usuário do sistema**: ator abstrato que agrupa porteiro, administração e auditor, para o caso de uso UC01 (autenticação);
- **Síndico** como especialização de **Administração**: faz tudo o que a administração faz, mais UC12 e UC19;
- **Agendador (tempo)**: rotinas automáticas disparadas por data, sem operador humano.

Morador, visitante e prestador não são atores do MVP: não operam o sistema. Interagem com a portaria, e o porteiro registra a interação.

### 12.2 Catálogo

| UC | Nome | Ator principal | Requisitos |
| --- | --- | --- | --- |
| UC01 | Autenticar no sistema | Usuário do sistema | RN-05, RNF-02 |
| UC02 | Registrar entrada de não morador | Porteiro | RF-12, RF-13, RF-36, RN-01, RN-11 |
| UC03 | Consultar restrições da unidade | (incluído por UC02) | RF-15, RF-16 |
| UC04 | Identificar quem autorizou | (incluído por UC02, UC08) | RF-13, RN-01 |
| UC05 | Liberar por exceção | Porteiro (estende UC02) | RF-17 |
| UC06 | Cadastrar visitante ou prestador | Porteiro (estende UC02) | RF-02, RF-18 |
| UC07 | Registrar saída | Porteiro | RF-12 |
| UC08 | Lançar registro retroativo | Porteiro | RF-35, RNF-05 |
| UC09 | Consultar pessoas no condomínio | Porteiro | RF-20 |
| UC10 | Cadastrar autorização prévia | Porteiro, Administração | RF-14, RN-07 |
| UC11 | Cadastrar restrição | Porteiro, Administração | RF-15, RN-06 |
| UC12 | Aprovar restrição para todo o condomínio | Síndico | RN-06 |
| UC13 | Manter unidades, veículos e funcionários | Administração | RF-01, RF-08, RF-09 |
| UC14 | Manter cadastro de pessoas | Administração | RF-02, RN-10 |
| UC15 | Solicitar vínculo com unidade | Administração | RF-03, RF-04 |
| UC16 | Registrar conferência do comprovante | (incluído por UC15) | RF-05 |
| UC17 | Aprovar ou rejeitar vínculo | Administração | RF-06, RN-02, RN-03 |
| UC18 | Importar planilha de moradores | Administração | RF-11, RN-09 |
| UC19 | Gerenciar usuários do sistema | Síndico | RF-33, RN-05 |
| UC20 | Encerrar vínculos vencidos | Agendador | RF-07 |
| UC21 | Registrar recebimento de encomenda | Porteiro | RF-22, RF-24 |
| UC22 | Conferir unidade de destino | (incluído por UC21) | RF-23 |
| UC23 | Registrar retirada de encomenda | Porteiro | RF-25 |
| UC24 | Verificar vínculo com a unidade | (incluído por UC23) | RN-08 |
| UC25 | Registrar ocorrência | Porteiro | RF-27 |
| UC26 | Vincular eventos de acesso | Porteiro (estende UC25) | RF-28 |
| UC27 | Passar turno | Porteiro | RF-29, RF-38 |
| UC28 | Consultar histórico de acessos | Administração, Auditor | RF-19 |
| UC29 | Emitir relatórios | Administração, Auditor | RF-26, RF-30, RF-31 |
| UC30 | Exportar trilha de auditoria | Administração, Auditor | RF-32 |
| UC31 | Verificar integridade da trilha | (incluído por UC30) | RF-37, RNF-01 |
| UC32 | Aplicar política de retenção | Agendador | RNF-09, seção 7 |

### 12.3 Especificação dos casos de uso principais

#### UC02 — Registrar entrada de não morador

| Campo | Conteúdo |
| --- | --- |
| Ator | Porteiro |
| Pré-condição | Porteiro autenticado (UC01) |
| Pós-condição | Evento de entrada gravado na trilha, com autorizador identificado |
| Problemas tratados | P1, P3, P5 |

Fluxo principal:

1. O porteiro busca a pessoa por nome, CPF ou placa (RF-34).
2. O sistema exibe o cadastro encontrado, com foto se houver.
3. O porteiro informa a unidade de destino.
4. O sistema consulta restrições da pessoa para a unidade (UC03) e autorizações prévias válidas.
5. Se houver autorização prévia válida, o sistema a seleciona como autorizador e segue ao passo 8.
6. O porteiro contata a unidade pelo interfone.
7. O porteiro registra o nome do morador que autorizou (UC04).
8. O porteiro confirma a entrada.
9. O sistema grava o evento com data, hora, ponto de acesso, porteiro e autorizador.

Fluxos alternativos:

- **A1 — Pessoa sem cadastro (passo 2):** o porteiro cadastra visitante ou prestador (UC06) e retoma o passo 3. Se a pessoa não tiver CPF, o cadastro é feito como exceção e a entrada só ocorre por liberação com justificativa (UC05, RF-17).
- **A2 — Pessoa em restrição (passo 4):** o sistema exibe alerta bloqueante com o motivo. O porteiro não registra a entrada para aquela unidade, e o sistema grava a negativa na trilha (RN-11). Se houver conflito, abre ocorrência (UC25).
- **A3 — Morador não atende ou situação de urgência (passo 6):** o porteiro libera por exceção (UC05), informando justificativa obrigatória. O evento fica marcado como exceção e entra no relatório RF-31.
- **A4 — Morador recusa a visita (passo 7):** o porteiro registra a recusa, que fica gravada na trilha com o morador que recusou (RN-11). Nenhuma entrada é registrada.

#### UC15 e UC17 — Solicitar e aprovar vínculo com unidade

| Campo | Conteúdo |
| --- | --- |
| Atores | Administração (solicita e aprova); Síndico (por herança) |
| Pré-condição | Pessoa cadastrada (UC14) |
| Pós-condição | Vínculo aprovado libera o acesso como morador; vínculo rejeitado fica no histórico com justificativa |
| Problemas tratados | P2 |

Fluxo principal:

1. A administração seleciona a pessoa e a unidade.
2. Informa o tipo de vínculo (proprietário, inquilino, dependente) e a vigência.
3. Registra a conferência do comprovante apresentado (UC16): tipo de documento e data. O arquivo não é armazenado.
4. O sistema cria o vínculo com status **pendente**. A pessoa ainda não tem acesso de morador.
5. Um usuário com papel de administração ou síndico abre a fila de vínculos pendentes.
6. Confere o cadastro completo (CPF e telefone) e a conferência do comprovante, e aprova.
7. O sistema muda o status para **aprovado** e registra quem aprovou e quando.

Fluxos alternativos:

- **A1 — Comprovante não conferido ou cadastro incompleto (passo 6):** o aprovador rejeita com justificativa. O vínculo fica com status **rejeitado**.
- **A2 — Pessoa apresenta documento na portaria:** o porteiro não cria vínculo (RN-03). Ele orienta a pessoa a procurar a administração e, se a pessoa insistir em entrar, trata como não morador (UC02).
- **A3 — Inquilino com vigência definida:** no fim da vigência, o agendador encerra o vínculo (UC20).

#### UC21 e UC23 — Registrar recebimento e retirada de encomenda

| Campo | Conteúdo |
| --- | --- |
| Ator | Porteiro |
| Pós-condição | Encomenda rastreável do recebimento à retirada |
| Problemas tratados | P4 |

Fluxo principal (recebimento):

1. O porteiro informa unidade, destinatário, transportadora e código de rastreio.
2. O sistema exibe torre e número em destaque e pede confirmação (UC22).
3. O porteiro confirma e o sistema grava a encomenda como **aguardando retirada**.
4. O porteiro avisa a unidade pelo interfone (RF-24).

Fluxo principal (retirada):

1. O porteiro localiza a encomenda pela unidade ou pelo código.
2. Identifica quem está retirando.
3. O sistema verifica se a pessoa tem vínculo aprovado com a unidade ou autorização dela (UC24).
4. O porteiro confirma a entrega e o sistema grava quem retirou, quando e qual porteiro entregou.

Fluxo alternativo:

- **A1 — Pessoa sem vínculo com a unidade (retirada, passo 3):** o sistema bloqueia a entrega e orienta o contato com a unidade de destino.

#### UC08 — Lançar registro retroativo

| Campo | Conteúdo |
| --- | --- |
| Ator | Porteiro |
| Pré-condição | Houve queda de sistema e os acessos foram anotados no formulário de contingência |
| Pós-condição | Evento gravado com a data e hora reais e a marca de retroativo |

Fluxo principal:

1. O porteiro escolhe "lançamento retroativo".
2. Informa a data e a hora reais do acesso, a pessoa, a unidade e o autorizador (UC04).
3. O sistema grava o evento com duas datas, a do acesso e a do lançamento, e a marca de retroativo.

Regra: o lançamento retroativo nunca substitui um evento existente (RN-04) e aparece destacado nos relatórios.

---

## 13. Telas principais

Inventário que orienta o protótipo navegável (ver `03_prompt_prototipo.md`).

| Tela | Perfil | Casos de uso | Requisitos centrais |
| --- | --- | --- | --- |
| T01 Login | Todos | UC01 | RN-05, RNF-02 |
| T02 Painel da portaria | Porteiro | UC27, UC09 | RF-38, RF-20 |
| T03 Registrar entrada | Porteiro | UC02 a UC06 | RF-12 a RF-18, RF-34 |
| T04 Alerta de restrição | Porteiro | UC03 | RF-16 |
| T05 Liberação por exceção | Porteiro | UC05 | RF-17 |
| T06 Pessoas no condomínio e saída | Porteiro | UC07, UC09 | RF-20 |
| T07 Encomendas | Porteiro | UC21 a UC24 | RF-22 a RF-26 |
| T08 Ocorrências | Porteiro | UC25, UC26 | RF-27, RF-28 |
| T09 Unidade (detalhe) | Administração | UC13, UC10, UC11 | RF-01, RF-08, RF-14, RF-15 |
| T10 Fila de vínculos pendentes | Administração | UC15 a UC17 | RF-03 a RF-06 |
| T11 Importar planilha | Administração | UC18 | RF-11 |
| T12 Histórico e auditoria | Administração, Auditor | UC28, UC30, UC31 | RF-19, RF-32, RF-37 |
| T13 Relatórios | Administração, Auditor | UC29 | RF-30, RF-31 |
| T14 Usuários do sistema | Síndico | UC19 | RF-33 |

---

## 14. Histórico de versões

| Versão | Data | Alterações |
| --- | --- | --- |
| 0.2 | 2026-10-09 | Rascunho inicial. |
| 0.3 | 2026-10-17 | Atende aos comentários do orientador sobre resumir os requisitos e definir o MVP. Incluído o critério do MVP (seção 4) e o resumo do MVP (seção 4.5). RF-18 e RF-28 passam de M para S. RNFs ganham as colunas Prioridade e Origem. RNF-10 reescrito como "Preservação dos dados", com justificativa ligada a P3 e P9 e à escolha de backup em vez de sincronização. RNF-10 incluído na linha P3 da matriz (seção 9). Numeração de todos os requisitos mantida. |

**Ajustes de 2026-10-17 (versão 0.3, sem nova versão).** Decisões de produto incorporadas ao texto:

- critério do MVP reescrito, com a regra do C prevalecendo sobre as condições de M; RNF-08 passa a M (obrigação legal); requisitos S marcados na matriz da seção 9;
- RF-21 removido (o ID permanece, sem reaproveitamento): o morador não opera o sistema. RF-14, RF-24, RN-06 e a linha do interfone na seção 11 ajustados;
- cadastro por CPF (RF-02), guardado mascarado e com código de busca HMAC;
- RF-05 passa a registrar a conferência do comprovante, sem armazenar o arquivo; RN-02, RN-09, UC16, UC15/UC17 e a métrica de P2 ajustados;
- RNF-02 sem segundo fator no MVP (TOTP na fase de segurança);
- nova RN-11 (auditoria das decisões de acesso e da trilha de alterações) e UC02 A4 ajustado;
- seção 7 (LGPD) reescrita, com novas linhas de dados e observações sobre direitos do titular, encarregado e aviso de privacidade;
- limpeza de forma: links corrompidos, escapes, tabelas compactas e caminho `../diagramas/`.
