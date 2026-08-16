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

## Revisão por pares (RTV-108)

O ticket é explícito: **A escreve, B revisa, *depois* assina.** Então `awaitingReview` fica
entre rascunho e assinado e **não tem transição de assinatura nenhuma** — assinar por baixo de
uma revisão pendente é precisamente o que o estado existe para impedir. Editar também é
recusado enquanto ela está aberta: o revisor está lendo aquele texto, e ele não pode mudar
debaixo dele.

Duas regras carregam o peso:

- **O revisor não pode ser o autor.** Auto-revisão anula o propósito inteiro e é o atalho mais
  provável numa implementação. Recusa, não aviso.
- **Qualquer edição limpa a aprovação.** O revisor aprovou *outro* texto; carregar a aprovação
  adiante deixaria qualquer alteração passar por baixo da revisão.

Rejeição exige motivo — o autor precisa saber o que mudar, e uma rejeição sem texto é uma
marca no painel e nada mais. Toda transição fica no histórico.

### O KPI é uma medição, e amostra enviesada não é uma

"Taxa de discordância significativa" é o número que um programa de revisão reporta para cima,
e ele vale quase nada a menos que os casos revisados tenham sido **escolhidos sem referência ao
conteúdo**. Programa em que o revisor escolhe casos interessantes, ou em que o radiologista
submete aqueles de que tem dúvida, **mede a seleção e não a leitura**.

`discrepancyRate` recebe o método de amostragem como campo obrigatório e **se recusa a
reportar taxa** para amostra selecionada — devolve as contagens, que continuam úteis para
ensino, sem o denominador que as faria parecer métrica de qualidade. É a decisão deste módulo
que vai ser discutida, e é a razão de ele existir.

**Denominadores pequenos.** 3% em 30 casos tem intervalo de confiança de ~0,6% a 15%. Reportar
o ponto ao lado dos 6% em 400 casos de outro radiologista convida a uma conclusão que o dado
não sustenta. O intervalo é de Wilson (o normal desce abaixo de zero em 1/30, que é o tipo de
saída que faz um comitê parar de confiar no relatório inteiro), e `compareRates` **recusa**
chamar duas taxas de diferentes quando os intervalos se sobrepõem. A pessoa comparada é um
colega.

**Concordância é escala, não booleano.** Separar "eu teria dito o mesmo" de "discordo e isso
muda a conduta" é a única distinção que o programa existe para encontrar: discordância que não
mudaria a conduta é ponto de ensino; a que mudaria é incidente.

Falta: o painel lado a lado, a notificação do revisor e a persistência no Connect.

## Controle de prazo do laudo (RTV-109)

`turnaround.ts` — o worklist já tem SLA por estudo (RTV-188). Esta é a outra metade: o relógio
do **laudo**, que é sobre o que o prazo de fato trata, e que se comporta diferente em três
pontos.

**O endpoint clinicamente significativo é o primeiro laudo acionável, não a assinatura.** Uma
leitura preliminar aos 20 minutos e um laudo assinado às quatro horas é um protocolo de AVC
funcionando *corretamente*. Medir só até a assinatura chama isso de quatro horas de
turnaround e esconde justamente o que importou. Os dois tempos são acompanhados, e o prazo é
conferido contra o primeiro.

**O relógio precisa parar enquanto o radiologista não pode agir.** Tempo aguardando revisão
por pares é do revisor. Tempo esperando um exame prévio chegar é do sistema. Cobrar qualquer
um dos dois do radiologista torna a métrica mentirosa — e pior, **faz as pessoas evitarem
pedir revisão**, que é o oposto do que o programa de revisão existe para conseguir. Então o
tempo ativo sai de uma lista de pausas removidas, não de `agora − criado`. Pausas que se
sobrepõem são **mescladas** e não somadas: dois motivos ao mesmo tempo são um período de não
poder agir, e somar creditaria o radiologista duas vezes pela mesma espera.

**Escalonamento acontece antes do estouro, não depois.** Notificação no prazo é notificação de
que o prazo foi perdido. O limiar de aviso é uma **fração** do tempo permitido, e é fração de
propósito: 15 minutos de antecedência é generoso num laudo de rotina de 24 h e inútil num
emergente de 60 min.

Nas estatísticas, mediana e p90 em vez de média — distribuições de turnaround têm cauda longa,
e a média fica entre o caso típico e a cauda descrevendo nenhum dos dois. E **laudos em aberto
são excluídos dos percentis** e contados à parte: incluí-los no tempo decorrido atual faz uma
fila represada parecer serviço rápido, porque os mais demorados ainda não terminaram.

## Export FHIR DiagnosticReport (RTV-219)

`fhirExport.ts` — mapear o laudo interno para `DiagnosticReport` + `Observation`. A maior
parte é cópia de campo. Quatro coisas sustentam o resto.

**O mapeamento de status não é um-para-um, e a ponta errada dele é insegura.** O FHIR tem
`registered | partial | preliminary | final | amended | corrected | entered-in-error`; o
workflow interno (RTV-107/108) tem rascunho, aguardando revisão, preliminar, assinado,
adendado. Eles quase se alinham — e os quase são os perigosos:

- `awaitingReview` é **`partial`**, não `preliminary`. Não foi comunicado a ninguém; chamar de
  preliminar diz a um sistema receptor que um clínico pode agir sobre ele.
- `draft` é **`registered`**, não `partial`. Nada foi escrito que alguém deva ver.
- **Nada que não esteja assinado mapeia para `final`.** Um receptor trata `final` como
  clinicamente acionável e para de re-buscar.

`toFhirStatus` é total sobre a união, **sem arm default** — um estado interno novo vira erro de
compilação em vez de virar um `final` silencioso.

**`effectiveDateTime` é quando a imagem foi feita; `issued` é quando o laudo foi liberado.**
São rotineiramente trocados, e o resultado é uma linha do tempo em que o laudo precede o
exame. São argumentos separados e os dois são exigidos.

**Referência que ninguém consegue resolver não é interoperabilidade.** `Patient/42` serve
dentro de um banco e é inútil fora dele. Identificador sem `system` é recusado, e um assunto
irresolvível derruba o export inteiro — export irresolvível **parece bem-sucedido e falha do
outro lado, dias depois**.

**Achado estruturado não mora no HTML.** A nota de arquitetura da família RTV-103 é explícita.
Achado com código vira `Observation` referenciado de `DiagnosticReport.result`; o narrativo é
`conclusion` e `presentedForm`. Achado **sem** código é reportado como tal, com aviso de que
contraria a decisão CDE-first — em vez de ser achatado em prosa em silêncio. Evidência DICOM
vai como `derivedFrom` com o UID no namespace `urn:dicom:uid`.

## Modelo canônico versionado do laudo (RTV-216)

`canonicalReport.ts` — o contrato persistido. Tudo o mais na família lê ou escreve isto: o
editor (RTV-104), os campos CDE (RTV-217), os packs RADS (RTV-220), as evidências (RTV-221),
o adaptador FHIR (RTV-219) e o artefato PDF/A.

**O valor estruturado não é derivado do texto.** O desenho tentador é um corpo rich-text mais
um parser. Ele falha no instante em que alguém edita a prosa: "nódulo de 8 mm" vira "nódulo de
6 mm" e o campo estruturado continua dizendo 8 — ou o parser relê e **muda em silêncio um
valor que ninguém remediu**. Aqui a observação estruturada *é* o registro e o narrativo é
renderizado ao lado. A validação avisa quando há medida na prosa que nenhuma observação
sustenta: prosa não é proibida, mas **número no texto que não está no dado não pode ser
exportado, comparado nem confiado** depois que alguém edita a frase em volta.

**Versões seladas são imutáveis e endereçadas por conteúdo.** Mesma regra do
`reportWorkflow`, imposta também na camada de armazenamento — duas camadas que ambas acham
que são donas da imutabilidade é como uma delas para de impor. Cada versão selada carrega um
hash de conteúdo, então "o que eu tenho é o mesmo que o seu?" se responde sem comparar campo
a campo. O hash é FNV-1a e **não é criptográfico de propósito**: ele responde
"é o mesmo?", não "alguém adulterou?" — a segunda pergunta é da assinatura PAdES, e fingir
que um hash faz as duas é ficar sem nenhuma. Reordenar observações não muda o hash; mudar um
valor muda.

**Toda afirmação clínica carrega procedência.** Uma observação registra quem afirmou e se um
humano confirmou. Isso importa hoje para revisão por pares e importa muito mais no instante
em que um assistente de IA (RTV-224) propuser achados: **afirmação de máquina não confirmada
que parece idêntica à de um radiologista é a falha que desacredita a feature inteira.** Por
isso ela é *erro* de validação, não aviso.

## Catálogo CDE e validação (RTV-217)

`cdeCatalog.ts` — um CDE diz o que um achado estruturado pode ser: tipo de valor, valores
permitidos, unidade, quantas vezes pode aparecer. Validar a observação contra o elemento é a
diferença entre um laudo estruturado e um blob de JSON com códigos dentro.

**A divergência de unidade é a silenciosa.** Elemento definido em milímetros recebendo um
valor medido em centímetros está errado por um fator de dez — e **os dois são números, os
dois são tamanhos plausíveis de nódulo, e nada no registro parece quebrado**. É o jeito mais
provável de um valor estruturado dar errado, porque a unidade mora na definição e o número
mora na observação e ninguém olha os dois. Então é **erro**, não conversão automática. Quem
*quer* a conversão pede explicitamente e recebe o fator de volta, para poder mostrar —
conversão silenciosa é a mesma falha chegando pelo outro lado. E a tabela de conversões é
deliberadamente pequena: conversor genérico convida a converter entre grandezas que nem são a
mesma coisa física, e a falha sai como um número plausível.

**Value set tem versão, e código aposentado passa na versão errada.** Códigos são
aposentados. Um valor válido no release de 2023 pode não existir em 2025, e validar contra
qualquer versão que estiver carregada aceita algo que vai ser rejeitado lá na frente, meses
depois, por um sistema que tem o release atual. A versão do elemento faz parte da identidade,
e a validação avisa quando a observação foi gravada contra outra.

**Cardinalidade não é formalidade.** Elemento de valor único com duas observações é erro de
dado que aparece como *"a última vence"* em algum lugar imprevisível — no export FHIR, no PDF,
numa consulta a jusante. Pego aqui, ainda dá para atribuir à edição que causou.

E o catálogo é validado antes de ser usado: elemento de quantidade sem unidade ou elemento
codificado sem valores permitidos **falha aberto** — toda observação contra ele passa. Isso é
pior que elemento faltando, que pelo menos falha alto.

## Evidência de imagem para achados (RTV-221)

`imageEvidence.ts` — um achado estruturado que diz "8 mm" sem dizer *onde* é um número que
alguém tem que aceitar na fé e ninguém consegue reconferir. Este é o link de volta aos pixels,
na forma que o DICOM SR já define, para poder ser exportado em vez de reinventado.

**Coordenada 2D não sobrevive a uma reconstrução; 3D sobrevive.** O DICOM tem dois tipos
espaciais e eles não são intercambiáveis:

- **SCOORD** é em coordenada de pixel e pertence a *um* SOP Instance. Se a série for
  reconstruída com outra espessura de corte — o que acontece, e é invisível para o laudo — os
  SOP Instances são novos e as coordenadas não apontam para nada. **Pior: podem apontar para
  alguma coisa, no lugar errado.**
- **SCOORD3D** é no frame of reference e sobrevive, porque um ponto em coordenada de paciente
  continua sendo aquele ponto depois de qualquer reconstrução da mesma aquisição.

O tipo é **registrado, nunca inferido**, e `assessDurability` diz que tipo de link o achado
tem. Um laudo cuja evidência inteira fica pendurada depois de uma reconstrução parece bem
até alguém clicar — tipicamente meses depois, num seguimento, quando importa.

**Frames começam em 1.** O DICOM conta de 1, todo array conta de 0. O off-by-one põe a seta no
corte errado, e num objeto de 200 frames ninguém percebe para que lado. É validado aqui em vez
de ser uma convenção que as pessoas lembram.

**A evidência tem que pertencer ao estudo do laudo.** Referência a SOP Instance de outro estudo
é ou clique errado ou contaminação cruzada entre laudos de dois pacientes. Vale falhar nas
duas.

A serialização usa os content items do DICOM SR: achado exportado como SR é legível por
qualquer PACS, blob JSON próprio é legível por este viewer. Anotação 2D fica **aninhada** sob
o item IMAGE, porque as coordenadas só significam algo relativas àquele instance; 3D fica ao
lado, com o frame of reference, porque não.

## Packs ACR RADS (RTV-220)

`radsPacks.ts` — TI-RADS, PI-RADS, BI-RADS e LI-RADS. Parecem iguais de fora e não são: dois
são **computados** de características, um tem regra sobre *quando* uma categoria pode ser
usada, e um muda **qual sequência decide** dependendo de onde a lesão está.

**Uma categoria sem o tamanho não é acionável.** É o que faz valer a pena implementar em vez
de listar. No TI-RADS, um nódulo nível 4 com 8 mm é seguimento e o mesmo nível 4 com 18 mm é
punção. **Mesma categoria, conduta diferente.** Um viewer que renderiza "TI-RADS 4" e para
imprimiu a metade menos útil — então o tamanho é obrigatório e a recomendação vem junto.

**BI-RADS 3 só existe em baseline.** "Provavelmente benigno, seguimento curto" significa *é a
primeira vez que vejo isso e espero que fique estável*. Em seguimento que já mostrou
estabilidade o achado é benigno (2); em seguimento que mostrou mudança é suspeito (4).
**Repetir 3 a cada visita é um jeito de acompanhar um câncer por três anos.** Categoria 3 sem
baseline é recusada.

**PI-RADS muda a sequência dominante conforme a zona.** Periférica pontua no DWI, transição no
T2 — pontuar a errada erra nas duas direções dependendo da lesão. E DCE positivo eleva um 3
para 4 **só na zona periférica**: é o único lugar em que o DCE muda alguma coisa, e é a razão
de ele ser adquirido. Na zona de transição o DCE é ignorado, e o módulo diz isso em vez de
aceitar em silêncio.

**LR-5 é um diagnóstico, não uma suspeita.** Significa CHC definitivo e, no contexto certo,
justifica tratamento **sem biópsia**. A combinação que chega lá é tabela e não julgamento, e a
dependência de tamanho é fácil de inverter: com 10–19 mm e hiperrealce arterial são precisas
**duas** características adicionais, com ≥ 20 mm basta **uma**.

## Rede de proteção de seguimento (RTV-229)

`safetyNet.ts` — o RTV-202 trata do achado que precisa chegar a alguém nos próximos dez
minutos. Este trata da outra falha, mais silenciosa e muito mais comum:

> "Recomenda-se TC de controle em 6 meses."

Escrito no laudo, assinado, distribuído — e nunca feito. **Ninguém percebe, porque nada no
sistema está olhando.** O nódulo que tinha 6 mm tem 19 mm quando o paciente volta por outro
motivo, dois anos depois.

**Recomendação que ninguém acompanha é uma frase, não um plano.** O valor inteiro está em ela
virar um objeto com prazo e estado de encerramento, em vez de uma expressão dentro de um PDF.

**Encerrar exige evidência, não a passagem do tempo.** A implementação tentadora expira a
recomendação quando a janela passa. Isso transforma a rede de proteção numa fila que se
esvazia sozinha, o que é **pior que fila nenhuma** — os números ficam saudáveis exatamente
porque as recomendações em que ninguém agiu sumiram. Não existe motivo `expired`, e encerrar
por "seguimento realizado" **exige o estudo que o realizou**: afirmação sem o estudo é
afirmação, não registro.

**Casamento automático fecha alças que não foram fechadas.** Uma TC de tórax posterior
*provavelmente* satisfaz "repetir TC de tórax em 6 meses". Provavelmente. Pode ser uma
angiotomografia para outra pergunta, reconstruída diferente, lida por quem não sabia o que
procurar. Fechar automaticamente por modalidade-e-região produz uma taxa de fechamento que
mede **agendamento e não cuidado**. Então o módulo **propõe e nunca fecha**, e devolve tanto as
razões quanto as ressalvas — inclusive uma que aparece sempre, porque é sempre verdadeira.

**A taxa de fechamento precisa de denominador honesto.** Recomendações ainda dentro do prazo
não são sucesso nem fracasso; contá-las de qualquer um dos dois lados é errado. Elas ficam
fora da conta e são reportadas à parte.

Os limiares de escalonamento contam **do fim da tolerância**, não da data prevista. Contar da
data prevista deixa a tolerância sem sentido para a urgência cuja tolerância coincide com o
primeiro limiar — em `routine` as duas eram 30 dias, e o estado `overdue` simples ficava
inalcançável. Os testes acharam exatamente isso.
