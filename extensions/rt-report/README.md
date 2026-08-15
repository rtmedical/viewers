# @ohif/extension-rt-report

O núcleo de estado do laudo. Hoje: **ciclo de vida** (RTV-107).

## Laudo assinado é imutável. Ponto.

É a regra que sustenta o resto. Depois de assinado, o laudo é documento legal: foi
distribuído, alguém agiu sobre ele, e na arquitetura alvo tem assinatura PAdES/ICP-Brasil
sobre um PDF/A cujos bytes não podem mudar. Uma máquina de estados que permite
`assinado → rascunho` não "deixa o radiologista corrigir um typo": ela invalida uma
assinatura em silêncio e faz o arquivado divergir do vivo.

Não existe caminho de edição saindo de `signed`. O jeito de mudar um laudo assinado é
**escrever um adendo** — documento novo que referencia o que complementa e passa pelo
próprio ciclo rascunho → assinado. Toda outra tentativa é recusada **com motivo**, e o
motivo diz o que fazer: *"Laudo assinado não pode ser editado. Escreva um adendo."*

## Preliminar não é "assinado, porém menos"

Laudo preliminar é a leitura do residente ou do plantão emitida antes de o titular
assinar. É comunicação clínica de verdade — alguém vai agir sobre ela — e é *também*
explicitamente não final. Modelar como um `signed` mais fraco perde exatamente a
propriedade que importa: toda renderização tem que dizer. `requiresPreliminaryBanner`
existe para nenhum caminho de distribuição esquecer.

Texto preliminar **é** editável, ao contrário do assinado. Essa é a diferença entre os
dois, e é por isso que não podem ser o mesmo estado com uma flag.

## Versões são monotônicas e nunca reutilizadas

Toda assinatura cunha uma versão. Um adendo não modifica a versão 1: cria a versão 2, que
é a versão 1 mais o adendo. Quem recebeu a versão 1 precisa conseguir perguntar "o que eu
tenho está atual?" e obter resposta verdadeira — impossível se números forem reciclados ou
se adendo editar no lugar. `renderFullReport` anexa e rotula os adendos em vez de fundi-los
ao texto original: fundir reescreve a história no único documento onde isso é menos
aceitável.

## Retratação não apaga o que foi enviado

Retratar exige motivo, volta o texto para o editor e **mantém** as versões assinadas. Laudo
que foi distribuído não pode ser des-distribuído, e o arquivo tem que guardar o que foi
enviado.

## Quem pode assinar é outra pergunta

Residente emite preliminar e não assina final. O workflow pergunta ao host por um
`AuthorityCheck` injetado, em vez de importar um módulo de permissão — mesma costura do
RTV-190. Sem checker, falha fechado.

## Falta

O editor rich text (RTV-104), templates (RTV-105), macros (RTV-106), peer review (RTV-108),
distribuição (RTV-110), o modelo canônico CDE-first (RTV-216) e a persistência no Connect.
Nada aqui é renderizado ainda.

## Macros / frases prontas (RTV-106)

`macros.ts` — atalho dispara frase, com campos a preencher. Ganho grande de produtividade e
superfície grande de segurança, pelo mesmo mecanismo.

**Campo não preenchido não pode chegar num laudo assinado.** É a falha em torno da qual o
módulo foi construído. Uma macro `Nódulo em [LOBO] medindo [N] mm` expande na hora, o
radiologista continua digitando *no fim dela*, e o laudo sai dizendo "Nódulo em [LOBO]
medindo [N] mm" — ou pior, com um default que por acaso está errado para este paciente.
Então: `expandMacro` reporta onde cada campo caiu, **o cursor vai para o primeiro campo e
não para o fim da inserção**, e `guardBeforeSigning` **recusa** a assinatura nomeando os
campos que sobraram. Recusa, não avisa: aviso em diálogo de assinatura é dispensado por
memória muscular, e o custo de errar aqui cai no paciente.

**A expansão tem que ser visível.** `expandMacro` devolve o intervalo inserido, não só o
texto novo. Macro que despeja um parágrafo de afirmações clínicas sem deixar rastro visual é
texto que o radiologista assina sem ter lido — o editor seleciona o intervalo (ou o primeiro
campo) para ele ser olhado uma vez.

**Gatilho: token inteiro, nunca dentro de palavra.** Com `;n` e `;nod` registrados, digitar
`;nod` não pode disparar `;n` e deixar `od` sobrando. E registro **rejeita atalho
duplicado** em vez de deixar o último sombrear o primeiro: duas macros no mesmo atalho
significa que uma nunca dispara, e quem a escreveu só descobre quando um laudo sai errado.
Atalho com espaço também é rejeitado — nunca dispararia.

Campos são `[MAIÚSCULAS]` só, para prosa entre colchetes (`[ver figura 3]`) não virar campo.

## Achados críticos (RTV-202)

`criticalFindings.ts` — CFM 1.974/2011 e o ACR Practice Parameter dizem a mesma coisa: achado
que põe o paciente em risco imediato tem que chegar ao médico assistente **agora**, e a
comunicação tem que ficar registrada. Este módulo é o registro e o relógio.

**O registro é append-only, porque é prova.** "Registro imutável, não editável após envio" é
critério de aceite, e é o ponto inteiro. Um log de achados críticos editável não prova nada —
o caso em que ele importa é aquele em que um paciente foi lesado e alguém está estabelecendo
o que se sabia, quando, e quem foi avisado. Corrigir a descrição não reescreve: **anexa uma
emenda, e os dois textos sobrevivem.**

**Ligação sem atestação não é notificação.** O canal preferido da norma é contato verbal
direto. Telefonema não deixa rastro de máquina, então o único registro é o radiologista
afirmar que ligou — que é exatamente por que `dispatch` **recusa** um envio por telefone sem
`verballyConfirmed`. Registrar "notificado por telefone às 14:32" sem nada por trás produz um
log que *parece* completo.

**Escalonamento é derivado do relógio, nunca armazenado.** Dez minutos sem confirmação
significa que o radiologista tem que ligar. Esse estado é calculado de `sentAt` e do agora a
cada pergunta, em vez de ser gravado por um timer. Flag armazenada vale o que vale o timer
que a grava: aba fechada, worker morto, notebook suspenso — e o modo de falha é um achado
crítico que **para de incomodar em silêncio.**

**O achado não enviado é o perigoso.** Digitado e nunca despachado — rede caiu, aba fechou —
é pior que achado nenhum, porque o radiologista acredita que comunicou. `pendingDispatch`
existe para a UI não deixar isso passar, e envio que falhou é registrado tão alto quanto
envio que deu certo.

**Sobre o template da mensagem:** o especificado no ticket leva nome do paciente e MRN por
WhatsApp — PHI em canal de terceiros. `buildMessage` implementa o que foi pedido, mas recebe
`includePatientName` como argumento explícito em vez de assumir, para a decisão ficar visível
no ponto de chamada e poder ser desligada por instituição sem tocar neste arquivo. O link
carrega a identidade que o destinatário se autentica para ver; a mensagem não precisa.

O relatório de gestão mantém linha para achado **nunca enviado**: relatório que só lista
notificações bem-sucedidas é relatório que esconde as falhas.
