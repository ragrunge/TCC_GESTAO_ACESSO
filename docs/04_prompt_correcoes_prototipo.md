# Prompt de correções — Protótipo no Claude Design

Revisão feita em 2026-10-10 sobre `Portaria.dc.html`, comparando com `01_requisitos.md` v0.2.
Copie o bloco abaixo e cole no chat do mesmo projeto no Claude Design.

---

INÍCIO DO PROMPT

Revisei o protótipo contra o documento de requisitos (anexado como 01_requisitos.md). A base está
boa; mantenha o visual e a estrutura. Aplique só as correções abaixo, sem mudar o resto.

## Regras de negócio

1. **Vínculo de Rodrigo Alves (V1) não pode ter sido solicitado pela portaria.** Pela RN-03, o
   porteiro não cria vínculo. Troque "Solicitado por" para "Paula Nogueira (Administração), a
   partir de documento entregue na administração em 01/10". A ocorrência OC-2026-044 continua
   registrando que ele pediu as chaves na portaria e foi orientado a procurar a administração.
   Ajuste também a linha "RG conferido na portaria por Sérgio Matos" para "RG conferido pela
   administração".
2. **Aprovar vínculo com itens que não conferem.** Hoje o botão Aprovar fica igual ao Rejeitar
   mesmo com 3 itens em vermelho. Quando houver item que não confere: Rejeitar vira a ação
   primária e Aprovar vira secundário e exige justificativa de no mínimo 15 caracteres, que fica
   gravada junto da decisão.
3. **Morador "Legado" com tratamento inconsistente.** Hoje legado não aparece para autorizar
   visitante por interfone, mas pode retirar encomenda. Use a mesma regra nos dois lugares:
   legado conta como vínculo válido dentro do prazo de regularização. Mostre o selo "Legado" ao
   lado do nome na lista de moradores que podem autorizar.
4. **Autorização prévia precisa respeitar validade e janela de horário.** Hoje basta existir.
   Considere a data de validade e a janela (ex.: Dedetizadora Lumen só das 15h às 17h). Fora da
   janela, mostre o cartão em âmbar "Autorização prévia fora do horário (15h–17h)" e exija outro
   meio de autorização. No cadastro de nova autorização prévia, a validade é obrigatória: não
   use 31/12 como padrão.
5. **Novo meio de autorização "Escala".** Para funcionário do condomínio em horário de escala,
   adicione a opção "Escala" em "Quem autorizou?", visível só quando a pessoa for do tipo
   Funcionário.
6. **Diaristas não são funcionários do condomínio.** Juliana Costa e Cláudia Rocha trabalham para
   unidades: mude o tipo delas para "Prestador" (serviço: diarista) em todos os dados simulados.
   Crie um funcionário do condomínio de verdade (ex.: "Válter Souza — zelador") com uma entrada
   via Escala no painel.
7. **Saída não altera o registro de entrada.** O próprio sistema diz que o registro não pode ser
   editado. A saída deve ser um novo evento ligado à entrada, com código próprio
   (EV-2026-00xxxx), e aparecer assim no histórico e na linha do tempo.

## Dados do condomínio

8. **Quantidade de unidades.** O condomínio tem 165 unidades em 9 torres, não 360. Use 5 andares
   com 4 apartamentos (11 a 54) nas torres 1 a 8 (160 unidades) e 5 unidades na torre 9 (11 a 15),
   ou outra distribuição que some 165. Ajuste os dados simulados que usam andares acima do 5º
   (T6-52 e T3-42 podem ficar; T1-73, T3-91, T5-63, T5-81, T8-42, T2-104, T9-21, T9-33 precisam
   mudar para unidades existentes). Mantenha T4-32, T7-11 e um caso equivalente ao de Rodrigo
   Alves em unidade válida.
9. **Nome do sistema.** "Guarita" é nome de produto comercial da Nice. Troque para
   "Portaria Parque" em todas as telas.

## Telas que faltam

10. **Lançamento retroativo (contingência).** No painel da portaria, adicione o botão secundário
    "Lançar registro retroativo". Ele abre o mesmo fluxo de Registrar entrada com dois campos a
    mais: data e hora reais do acesso. Ao confirmar, o evento recebe a etiqueta "Retroativo" com
    a hora real e a hora do lançamento.
11. **Restrição para todo o condomínio (síndico).** No detalhe da unidade, a nova restrição tem a
    opção "Pedir restrição para todo o condomínio". Ela fica pendente até o síndico aprovar. No
    perfil Síndico, mostre essas pendências no painel.

## Teclado

12. Depois de escolher a pessoa, o foco deve ir para a seleção de torre, e as teclas 1 a 9 devem
    escolher a torre. Depois da unidade, o foco vai para "Quem autorizou?".
13. O atalho Enter para confirmar a entrada não funciona quando o foco está num botão (por
    exemplo, logo depois de clicar no nome do morador). Faça o Enter confirmar sempre que o
    registro estiver completo, exceto dentro de um campo de texto longo.

## Pequenos ajustes

14. Remova o arquivo vazio Guarita.dc.html do projeto.
15. Na exportação da trilha, troque "assinatura .sig" por "arquivo de hashes para verificação",
    que é o que a especificação prevê.

Depois de aplicar, percorra de novo os 6 roteiros de demonstração do prompt original e confirme
que todos funcionam.

FIM DO PROMPT
