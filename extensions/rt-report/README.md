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

### O painel (`getPanelModule/CriticalFindingsPanel.tsx`)

**🚨 O painel não grava `sent` por um envio que ainda não aconteceu.** Esta distinção
estruturou o componente, e a primeira versão dele errava. Chamar `dispatch` no clique escreve
`sentAt` e inicia o relógio; para **telefone** isso está certo, porque a ligação já aconteceu e o
que se faz é registrá-la. Para **WhatsApp e e-mail**, não: no clique o transporte ainda não rodou,
e gravar `sent` ali produz exatamente a falha que o núcleo descreve — o radiologista acreditando
que comunicou. Então há dois caminhos: telefone chama `dispatch` (que exige a atestação); canal de
máquina entrega intenção e mensagem ao hospedeiro por `onRequestSend` e **não escreve nada**, com o
achado seguindo em `pendingDispatch`, sob o bloqueio, até o hospedeiro registrar o resultado real.
O rótulo do botão diz qual dos dois é — *"Registrar a ligação feita"* contra *"Solicitar envio ao
sistema"*.

**🚨 O relógio não pode ser capturado.** `escalationState` é derivado de `now` a cada chamada, e o
núcleo explica por quê: flag guardada vale o que vale o timer que a escreve. Se o painel
congelasse `now` na montagem, reproduziria a mesma falha uma camada acima — o crachá ficaria em
"aguardando" para sempre. Isto é o **oposto** da regra do painel da fila de laudos, que congela
`now` de propósito; lá o risco é reordenar linhas sob o cursor, aqui é um cronômetro parado. Há
teste que avança `nowMs` sem remontar e exige `awaiting` → `callNow` → `supervisor`.

**O radiologista não confirma o recebimento.** `acknowledge` é o ato do **destinatário**. Um botão
no painel de quem enviou produziria a prova de que alguém foi avisado a partir do clique de quem
avisou — e o caso em que esse registro importa é justamente o caso em que se está estabelecendo o
que se sabia, quando, e quem foi informado. O controle não existe aqui, e um teste varre botões e
inputs. A atestação de telefone não substitui: é declaração do remetente, não confirmação do
destinatário.

**A descrição não se edita, se complementa.** Nenhum campo é ligado a `description`; há campo de
complemento, e um teste percorre todos os `input`/`textarea` exigindo que nenhum carregue o texto
original como valor. Depois do complemento, a descrição original continua na tela e o log aparece
inteiro, na ordem em que cresceu.

**O não comunicado não se dispensa.** O bloqueio some quando o envio acontece, nunca por clique:
não há "depois", "dispensar" nem "entendi", e um teste varre os controles por essa afordância. Um
envio que **falhou** mantém o bloqueio e deixa o evento `sendFailed` na lista.

**O nome do paciente não vai por padrão**, a decisão é por mensagem, e a prévia do texto aparece
antes do envio — quem envia lê exatamente o que sai da instituição, e um teste compara o texto
entregue ao hospedeiro com o nó renderizado na prévia. Quando a instituição não permite, o controle
não é nem oferecido.

**O limite de 200 caracteres não trunca em silêncio.** Sem `maxLength` no campo: o atributo faria a
digitação simplesmente parar no 201º caractere, e um resumo clínico cortado no meio de uma palavra
pode não ser notado por quem digitou. O contador mostra o excesso e o núcleo recusa com a razão
dele. Há teste exigindo que o atributo esteja ausente.

43 testes de painel.

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

## Importador RadReport/MRRT e o modelo canônico de template (RTV-218)

`reportTemplate.ts` (modelo) + `mrrtImport.ts` (parser). O RadReport publica templates como
HTML MRRT. **Esse HTML é transporte, não armazenamento** — no momento em que os dois existem,
uma edição no modelo canônico e uma edição no HTML divergem, e ninguém consegue dizer de qual
delas um laudo assinado foi escrito. A reexportação é regerada a partir do modelo.

### Um template editado não é o template de onde veio

É a regra de identidade que o módulo impõe, e é questão de conformidade, não preferência de
modelagem. Se uma cópia editada localmente mantém `RPT144` como identificador, então **dois
documentos diferentes afirmam ser o RadReport RPT144 versão 3**, e um laudo assinado afirma ter
seguido um template publicado que não seguiu.

O identificador de origem vira **procedência** — de onde isto foi derivado — e o template ganha
identificador próprio. `forkTemplate` é o único caminho para uma cópia editável, e
`assertEditable` recusa o resto. O fork exige motivo registrado: quem revisar o template daqui
a um ano precisa saber por que ele diverge do publicado.

**Tradução conta como edição.** Os códigos sobrevivem — um conceito RadLex não depende de
idioma — mas o identificador não, porque o texto que o radiologista assina não é mais o texto
publicado.

### Códigos são lidos, nunca inferidos

Uma opção sem código na origem permanece sem código. Casar "Presente" com um CDE porque a
string parece certa atribui significado estruturado que o autor do template nunca declarou, e
produz um laudo **legível por máquina e errado** — o que é pior que não ser legível por máquina.
`linkCodes` recebe um resolvedor injetado e só lhe pergunta sobre códigos explícitos.

### O que não consegue interpretar, ele reporta

Campo descartado em silêncio é a falha característica de todo importador de HTML: o template
abre, parece completo, e está faltando justamente o controle que o autor se importava. As
construções não reconhecidas voltam em `unsupported`.

### Scripts são removidos

Um template é um documento. Um que traz script executável é um que **roda código dentro do
workspace de laudo** — só o bloco `text/xml` de atributos sobrevive, e a remoção é reportada.

O parser não usa DOM: é um scanner de tags sobre o subconjunto que o MRRT de fato usa, então
roda igual num worker, no Node e num teste.

## Biblioteca de templates por modalidade (RTV-105)

`templateLibrary.ts` — 37 templates prontos em pt-BR sobre o modelo canônico do RTV-218, então
um template da casa e um importado do RadReport são o mesmo tipo de objeto e o editor só aprende
um. Cobertura: **CT** (crânio, AVC, tórax, angio-TC de artérias pulmonares, abdome total, abdome
agudo, seios da face, coluna lombar, pescoço, uro-TC), **MR** (crânio, coluna lombar, joelho,
ombro, abdome superior, próstata multiparamétrica, pelve feminina, mamas), **MG** (rastreamento,
diagnóstica), **US** (abdome total, tireoide, mamas, obstétrico 1º e 2º/3º trimestres, rins e
vias urinárias, pélvico transvaginal, doppler de carótidas, doppler venoso de MMII), **RX**
(tórax, tórax pediátrico, abdome agudo, coluna lombar, joelho, punho e mão, tornozelo e pé,
seios da face).

### Um texto de normalidade pré-preenchido é a coisa mais perigosa de um sistema de laudo

É a razão de o módulo ser escrito assim. "TC de crânio normal" carregado como texto significa
que o laudo **começa** como um exame inteiramente negativo. Toda seção que o radiologista não
sobrescrever passa a ser uma **afirmação negativa que ninguém fez** — assinada, no prontuário,
indistinguível de um achado que foi de fato procurado e excluído. Copy-forward e auto-texto
estão entre as fontes mais comuns de erro em laudos justamente porque o texto errado é fluente,
plausível e já está lá.

Por isso a prosa negativa é marcada como `assertive`, e `unconfirmedAssertions` lista todo campo
assertivo que o leitor nunca tocou. **O laudo não está completo enquanto essa lista não estiver
vazia.** O objetivo não é tornar o template menos útil — é tornar *não lê-lo* impossível de
fazer em silêncio. A técnica também é assertiva: afirmar uma técnica que não foi executada
descreve errado o exame.

### Sugerir não é aplicar

`suggestTemplates` devolve uma lista ranqueada e **nunca** uma decisão — `autoApply` é
literalmente `false` no tipo. Aplicar automaticamente por modalidade e parte do corpo faz um
estudo mal codificado carregar em silêncio um template cuja prosa é sobre outro órgão, e o
radiologista edita os achados sem notar que o parágrafo de técnica descreve um exame que não foi
realizado.

`BodyPartExamined` não ganha confiança aqui: é texto livre, frequentemente ausente, e as
convenções dos fabricantes divergem. Ele contribui **um ponto**; o sinal útil costuma estar na
descrição do estudo. A confiança devolvida diz quais sinais de fato dispararam, e um casamento
só por modalidade é rotulado como fraco.

## Distribuição multi-canal (RTV-110)

`distribution.ts` — decide **o que pode viajar por qual canal**, **se uma entrega de fato
fechou o ciclo**, e **quem está segurando um laudo superado**. Os transportes em si (SMTP, a
API do WhatsApp Business, o portal, a fila de impressão) são adaptadores e não estão aqui.

### Canal que não autentica o destinatário não pode levar o laudo

É a regra que o módulo existe para impor. Laudo é dado de saúde, que a LGPD trata como dado
pessoal sensível, e os canais **diferem em natureza, não em conveniência**: o portal sabe quem
fez login; um e-mail e um telefone são strings digitadas no balcão, frequentemente
compartilhadas com um familiar e frequentemente desatualizadas.

Então canal não autenticado pode levar **notificação** — "seu laudo está pronto, entre no
portal" — e nunca o conteúdo. `planDistribution` **recusa a combinação em vez de rebaixá-la em
silêncio**, porque o rebaixamento silencioso é exatamente como um laudo acaba num grupo de
WhatsApp — e porque esconderia de quem enviou que o destinatário não vai receber o que lhe foi
prometido.

### Enviado não é entregue, entregue não é lido

Um relay SMTP aceitar a mensagem significa que a mensagem saiu do prédio. Um sistema de
distribuição que trata isso como "o médico solicitante tem o resultado" é o mecanismo pelo qual
**um achado crítico deixa de ser tratado enquanto o log de auditoria diz que foi comunicado**.
Só uma leitura confirmada — ou um aceite fora de banda que alguém registrou — fecha o ciclo, e
`closesCommunicationLoop` é o único lugar que diz isso; o `safetyNet.ts` (RTV-229) depende
dessa resposta.

Cinco e-mails enviados e nenhuma leitura **não são cinco quintos de uma comunicação.**

### Reenvio não pode virar uma segunda divulgação

O reenvio perigoso é o que acontece depois de um timeout ambíguo, quando a primeira mensagem
pode muito bem ter chegado. Não é idempotente como uma chamada de API que falhou: uma segunda
cópia do laudo num telefone compartilhado é **uma segunda divulgação** para quem mais lê aquele
aparelho. Toda tentativa carrega uma chave derivada de laudo, versão, canal, tipo de conteúdo e
destinatário, e `isDuplicate` responde **antes** de o adaptador ser chamado. Versão nova não é
duplicata: distribuir um laudo retificado a quem recebeu o original é uma divulgação nova.

### Uma retificação torna errado todo destinatário anterior

Quem recebeu a versão 1 está agindo sobre um laudo que mudou desde então. Produzir essa lista
não é refinamento de relatório — é o único jeito de a retificação alcançar as pessoas que o
original alcançou.

## Reconhecimento de voz pluggable (RTV-112)

`speechAdapter.ts` — a captura é Web Audio (RTV-111) e os provedores são serviços de rede. O
que pertence aqui é o **contrato** que um provedor precisa satisfazer e a parte que decide
**quais trechos de um laudo ditado um humano tem que olhar antes de assinar**.

### Confiança de reconhecimento é calibrada em som, não em consequência

É a observação em torno da qual o módulo foi construído, e é por isso que **um limiar de
confiança não é mecanismo de segurança**. Um motor que ouve "esquerda" com clareza e transcreve
"esquerda" reporta confiança alta — e se o radiologista disse "direita", o número não diz nada.
Os erros que importam num laudo **não são os murmurados; são os nítidos, confiantes e errados.**

Quatro classes de token exigem olhar humano **independentemente do escore do provedor**:

| classe | por quê |
|---|---|
| **negação** | um "não" perdido inverte o achado — "não há sinais de pneumotórax" e "há sinais de pneumotórax" diferem por uma sílaba curta e átona |
| **lateralidade** | lado errado, e o ditado é uma das portas de entrada dele no prontuário |
| **medida** | "1,5 cm" e "15 cm" são os mesmos dígitos; uma vírgula perdida transforma um intervalo de seguimento numa biópsia |
| **dose** | a mesma falha, com uma droga junto |

`acceptDictation` recusa enquanto qualquer marcação estiver sem revisão — **por marcação, não
por ditado**, para o leitor confirmar a lateralidade que de fato disse, e não um checkbox que
cobre um parágrafo inteiro.

### Comando não reconhecido vira texto, nunca nada

"Ponto final" é um comando; também é uma frase que um radiologista pode dizer. Um parser que
descarta em silêncio o que não casa **apaga conteúdo ditado**, que é o pior desfecho possível:
uma ausência é o único tipo de erro que o leitor não consegue perceber lendo. Candidatos não
casados são inseridos literalmente e reportados.

### Provedor: idioma é rejeição, não aviso

Um motor de pt-PT transcrevendo ditado pt-BR não falha alto — produz **português plausível com
as palavras erradas dentro**. Provedor em nuvem é recusado quando o áudio não pode sair: ditado
é dado do paciente. Provedor sem confiança por token é aceito com aviso, porque a varredura de
risco nunca dependeu da confiança.

## Reporting Hub: a fila, o SLA e a ordem (RTV-222)

`hubQueue.ts` — o view-model da lista de exames aguardando laudo. Não é React: é a parte que
decide **a ordem, os baldes e as recusas**.

### A ordem é o produto, e ordenar por atraso é a ordem errada

Se a lista ordena por "mais atrasado primeiro", uma RM de joelho ambulatorial esperando três dias
fica **acima** de uma TC de crânio de emergência que chegou há quatro minutos. As duas linhas
parecem perfeitamente razoáveis isoladas: a de cima realmente é a mais atrasada, e a TC realmente
tem quatro minutos. **Nada na tela está errado**, e o radiologista que abre a lista de cima para
baixo lê o exame errado primeiro.

Urgência clínica domina; o SLA ordena **dentro** da faixa. Há um teste que calcula a ordem naïve
"mais atrasado primeiro" e afirma que ela é o **inverso exato** da ordem correta — para ninguém
regredir o comparador de volta.

### Achado crítico não comunicado promove a linha

A prioridade do pedido reflete o que o solicitante suspeitava **antes de as imagens existirem**; o
achado crítico é o que foi de fato visto. Uma linha de rotina com achado crítico não comunicado é
falha de comunicação, não trabalho de rotina.

### Uma linha pode estar em vários baldes, e forçar um esconde trabalho

Um exame pode estar aguardando assinatura **e** com achado crítico não comunicado **e** sem o
prior, ao mesmo tempo. Uma coluna de status única tem de escolher, e o que ela não escolher
desaparece das contagens — sem ninguém notar, porque o número exibido está correto.

Status é um **conjunto** de marcadores, e as contagens por marcador **deliberadamente não somam**
o total de linhas. A ressalva viaja no dado, não num comentário.

### O relógio do SLA tem de ser escolhido

Tempo desde o pedido, desde a chegada das imagens e desde a atribuição são **três números
diferentes**, e divergem mais justamente nos exames que importam: um pedido urgente cujas imagens
levaram uma hora para chegar lê 4 min em vez de 64 min e nunca aparece como violado. A referência
é obrigatória; sem ela o módulo recusa calcular.

### Urgente sem responsável é o pior estado e o mais fácil de perder

Porque não aparece na fila pessoal de ninguém. Uma fila por usuário **estruturalmente** não
encontra — e o módulo diz isso junto com a lista.

### Contagem com filtro não é contagem do departamento

"12 atrasados" com um filtro de modalidade aplicado significa 12 **naquele recorte**. O resumo
recusa emitir contagem sem o contexto do filtro.

## Blocos de achado estruturado no laudo (RTV-226)

`findingBlock.ts` — o laudo é texto rico, e dentro dele ficam blocos de achado ligados a CDEs
(RadElement/ACR-RSNA): uma lesão com tamanho, lateralidade, categoria. O radiologista pode editar
**a prosa** ou **o campo estruturado**. Este módulo é o modelo do bloco, a ligação entre os dois, e
as recusas.

### A prosa e a estrutura podem discordar, e o laudo mostra só a prosa

Se o radiologista edita "nódulo de 8 mm" para "nódulo de 18 mm" no texto mas o CDE ligado continua
com 8, **o laudo assinado diz 18** e todo consumidor a jusante — registro, regra de seguimento,
exportação FHIR — **recebe 8**. Nada parece errado em nenhum dos dois lugares.

O módulo renderiza a estrutura de volta para prosa, compara com a frase editada, e **recusa a
assinatura** enquanto discordarem — dizendo qual dos dois cada público vai receber.

Igualdade entre unidades é acordo de verdade (1,8 cm == 18 mm), então o aviso não vira ruído.
Mesmos dígitos com unidade diferente (8 mm vs 8 cm) e número sem unidade são **estados separados**.

### Um CDE tem valores permitidos e a prosa não

Texto livre pode dizer "moderadamente aumentado"; um CDE com conjunto enumerado não pode. Forçar a
prosa no valor mais parecido **inventa uma afirmação que o radiologista não fez**. O módulo recusa,
lista os valores permitidos, e mantém o bloco como texto livre com o **CDE vazio** — nada
codificado é exportado, e o laudo continua assinável.

### Unidade

"1,5" é 1,5 mm ou 1,5 cm dependendo de nada. A unidade é obrigatória no lado estruturado, e ligação
numérica sem unidade é recusada — a diferença é de dez vezes e muda a conduta.

### Apagar a frase não pode deixar a estrutura órfã

Se a frase é apagada mas o bloco sobrevive, o laudo exporta um achado estruturado que **não aparece
em nenhum texto legível**: o prontuário fica com um achado legível por máquina que **nenhum humano
escreveu**. A detecção não confia só na âncora — âncoras morrem em silêncio num colar ou num
desfazer — e também varre o texto do documento.

### Proposto por software não é afirmado por radiologista

Um valor proposto que ninguém confirmou não pode ser exportado como afirmação. E "confirmar" não
pode lavar um chute: confirmar é recusado enquanto a proposta contradiz a prosa.

## Assinatura, retificação e distribuição (`signOff.ts`) — RTV-228

O núcleo puro do fecho do laudo: prontidão, autorização do assinante, assinatura, retificação
versionada, registro de envio e auditoria dos artefatos derivados. Sem `@ohif/*`, sem relógio,
sem hash — o digest e o horário entram como parâmetro.

### "Laudo normal por omissão" é bloqueio, não aviso

Um parágrafo de normalidade pré-preenchido que o radiologista não tocou é o modo de falha mais
perigoso deste fluxo: ele produz uma afirmação clínica positiva — "sem alterações" — que ninguém
fez. `signEvaluateReadiness` classifica cada campo assertivo não confirmado como item
**bloqueante**, nunca como faixa de aviso, porque **faixas são lidas depois que a assinatura
irreversível já existe**.

E o mesmo portão roda **dentro de** `signCreateSignature`, não só na tela: um botão habilitado não
é uma permissão, e o assinador em lote e a API compartilham esse caminho.

### Divergência estruturado/prosa, e artefato derivado velho

A camada de DICOM SR/FHIR e a prosa são cada uma internamente consistente, então **nenhum leitor
isolado vê a contradição** — o clínico lê a prosa, o registro de câncer lê o SR, e os dois saem com
conclusões diferentes sem nenhum erro aparecer. Já um PDF/A ou SR gerado na v1 e mantido depois da
v2 é uma resposta errada com aparência de confiança.

As duas coisas são tratadas com pesos diferentes de propósito: artefato **velho bloqueia** a
distribuição; artefato **ausente é apenas informativo** — um artefato que falta é visivelmente
falta, um artefato desatualizado se parece com a verdade.

### Assinar, enviar e ter direito de assinar são três fatos distintos

- `dispatch-before-signature` é recusado, e uma falha de canal **nunca desassina** o laudo;
- "assinado" nunca é renderizado como "entregue" — `signSummarizeDelivery` mantém os dois separados;
- residente em laudo final, delegação expirada, fora de escopo ou autoconcedida, e CRM ausente são
  recusados **antes de qualquer assinatura existir**.

66 testes.

## Comparação entre versões do laudo (`versionDiff.ts`) — RTV-227

Diff por seção entre duas versões, classificado por **risco clínico** em vez de tamanho, com
aprovação de escopo limitado. Sem `@ohif/*`, sem relógio, sem `throw`.

### O decimal engolido

`1,5 cm` para `15 cm` é **um caractere** e um nódulo que virou massa. Num diff de texto comum a
vírgula é um token de pontuação, e `1,5` e `15` passam a diferir só por ruído descartável — a
mudança some no painel.

`diffTokenize` trata sequências numéricas como **um token inteiro, com o separador dentro**, e as
compara byte a byte; o dobramento de caixa e acento se aplica **só a palavras**. A regra fina é que
o separador só entra no número quando **um dígito o segue** — assim `1,5` fica inteiro e o ponto
final da frase não é absorvido. O resultado é um span `measurement` de risco alto cuja mensagem
soletra *"aumento de cerca de 10x"*.

### Risco não é tamanho

Um `não` apagado ou `direito` virando `esquerdo` é uma mudança de três letras que **supera** um
parágrafo reescrito. `diffClassifySpan` ordena por classe de risco — negação, lateralidade,
categoria (BI-RADS e afins), medida — nunca por número de tokens. E uma reformulação genuinamente
equivalente permanece `low`, que é o que mantém o selo confiável: um indicador que grita em toda
versão deixa de ser lido.

### `identical` é um veredicto, não um painel vazio

Quando as versões são iguais, a resposta diz que o painel está vazio *"porque as versões são iguais,
e não porque a comparação falhou"*. Seção grande demais e versão carregada vazia são **recusadas**
em vez de renderizadas em branco — um diff vazio por falha de carregamento é indistinguível de um
diff vazio por igualdade.

### v1 contra v3 relata o que ficou escondido

Comparação não adjacente informa `adjacency.skipped` e lista as seções que **existiram só nas
versões intermediárias** — um adendo acrescentado na v2 e removido na v3 não aparece em nenhum dos
dois lados do diff, e sem esse aviso o revisor concluiria que ele nunca existiu.

### Aprovar a comparação não é aprovar o laudo

`diffApproveComparison` grava `scope: 'comparison-only'` com a frase de escopo explícita, e recusa
`stale-review` (o alvo revisado já não é a versão corrente), `self-review` e
`missing-rejection-note`.

45 testes.

## Captura de áudio do ditado (`audioCapture.ts`) — RTV-111

Ciclo de vida da gravação, verificação de sinal, destino de armazenamento e retenção. Sem
`@ohif/*`, sem relógio, sem `throw`. O `MediaRecorder` e o botão ficam na camada de UI; aqui está
tudo que é fácil errar.

### Uma gravação que não captou nada é idêntica a uma que captou tudo

Este é o modo de falha central, e ele não tem laço de realimentação: o radiologista fala quatro
minutos, vê o ponto vermelho todo o tempo, e o microfone estava mudo. Descobre-se na transcrição —
possivelmente dias depois, possivelmente depois de o laudo já ter sido assinado de memória.

Então `audioFinishSession` exige um resumo de sinal observado, e `audioAttachToReport` **recusa**
anexar uma captura silenciosa sem confirmação explícita de alguém. O piso é de **pico**, não de
média: a média de um ditado real, com as pausas entre frases, cai até onde fica o ruído da sala.

E `unknown` não é dobrado em `silent`: uma captura cujo nível nunca foi medido não é prova de
silêncio nem de voz.

### Permissão negada e ausência de dispositivo têm remédios diferentes

Apresentam-se igual — sem áudio — e o conserto é um clique na barra de endereço num caso e um
headset a conectar no outro. Colapsar os dois em "não foi possível gravar" manda o usuário ao lugar
errado. São estados e mensagens separados. Um terceiro caso, o microfone **presente e silenciado
pelo sistema**, é recusado dizendo o que aconteceria: um arquivo com a duração correta e sem voz.

### O ditado que cai no laudo errado

A sessão fixa paciente, estudo e laudo no **início**. Radiologistas trocam de estudo
constantemente, e um ditado de quatro minutos que termina com outro laudo aberto não pode se anexar
ao que está em foco — isso é um ditado sobre o paciente A arquivado no laudo do B, e lá ele lê como
achado real da pessoa errada. A comparação é **campo por campo**, não por id de laudo: um id
reaproveitado ou um estudo recarregado sob o mesmo id derrotam a checagem de id único.

Essa é a primeira verificação de `audioAttachToReport`, antes de durabilidade e antes dos defeitos,
porque paciente errado supera qualquer outro problema.

### "Gravado" e "gravado onde"

Web salva no Connect; o desktop cifra local e sincroniza depois. Não é o mesmo fato.
`local-only` **não é durável**, mesmo sendo o caminho projetado do RTVW: é durável para aquela
máquina, e o laudo não é. Um laudo assinado com base em áudio que só existe num disco perde a
evidência no dia em que a estação é reinstalada. `audioIsDurable` é o único predicado que a UI pode
usar para dizer que o áudio está a salvo.

### Truncamento

Aba suspensa, teto de memória ou troca de dispositivo param um gravador sem erro. A duração gravada
passa a discordar do span da sessão, e o que falta é o **fim** — que num ditado é a impressão.

### Retenção é decisão, não padrão

A voz de um médico discutindo um paciente nomeado é dado pessoal dos dois. Laudo assinado não
mantém áudio sem decisão de retenção registrada, porque o padrão que valeria é "guardar para
sempre, porque ninguém escolheu". `keep` sem prazo é recusado com essa frase.

95 testes.

## Modelo do documento e round-trip com o Connect (`reportDocument.ts`) — RTV-104

O editor é TipTap; o Connect guarda HTML do CKEditor. Todo load e todo save cruzam uma fronteira
de formato, e é nessa fronteira que um laudo perde uma frase sem ninguém notar. Este módulo é a
fronteira, mais a política de auto-save. Sem DOM, de propósito: o mesmo código roda no Jest, no
navegador e no build desktop.

### O round-trip que come uma frase

Uma conversão que encontra um elemento que não modela tem três opções honestas: manter,
normalizar, ou descartar. Só a terceira é perigosa, e só quando o descartado **carregava texto**.
Perder um `<span>` de estilo não custa nada; perder um `<td>` custa a medida que estava dentro — e
o laudo continua lendo como um laudo completo, que é o que o torna perigoso em vez de apenas
quebrado.

Por isso a comparação é de **texto normalizado**, não de HTML. Comparar HTML acusaria toda
normalização inofensiva (ordem de atributo, `<b>` virando `<strong>`) e **ainda passaria** uma perda
real sempre que ela deixasse a marcação bem-formada — ou seja, é ao mesmo tempo ruidoso e cego.

### Formatação em laudo radiológico não é sempre cosmética

Negrito na impressão é frequentemente como o achado crítico é marcado. Numeração de lista é como
achados são referenciados depois ("achado 3"), então renumerar muda o que uma frase posterior
aponta. Sobrescrito carrega o expoente em `cm3`.

### 🐛 O defeito que este módulo encontrou em si mesmo

As pilhas de marcas aberta e desejada eram comparadas como **strings concatenadas**. `s` é prefixo
de `strong`, `sub` e `sup` — então riscado seguido de negrito lia como "a pilha aberta ainda é
prefixo do que quero", e o serializador **nem fechava `<s>` nem abria `<strong>`**:

```
<s>ris</s><strong>neg</strong>   ->   <s>risneg</s>
```

O negrito silenciosamente perdido, e o riscado silenciosamente estendido sobre texto que nunca foi
riscado. Exatamente a classe de perda que o módulo existe para detectar, chegando pelo seu próprio
serializador. A comparação agora é elemento por elemento, e há um teste que percorre **todos os 42
pares ordenados** de marcas.

### O auto-save que grava vazio sobre um laudo real

O pior deste módulo, e inteiramente banal: o load falha, o editor renderiza vazio, e trinta
segundos depois o auto-save grava esse vazio sobre o laudo. Nada dá erro. O laudo acabou e a UI
parece saudável.

`docPlanAutosave` recusa salvar documento que não foi confirmado carregado, e recusa um save que
esvazia um documento substancial sem intenção explícita de apagar. É a mesma distinção entre
**vazio** e **não carregado** que o resto do código faz. E é a **primeira** checagem, antes da de
revisão, porque é a única que destrói conteúdo já escrito e aceito — um documento vazio é HTML
perfeitamente válido, sem conflito e sem tag descartada, e nenhuma checagem posterior o pegaria.

### O auto-save que sobrescreve um colega

Auto-save com last-write-wins é uma máquina de perder dados assim que duas abas estão abertas — e
duas abas estão abertas constantemente. Todo save carrega a revisão em que se baseou, e uma revisão
que andou no servidor é **recusa de conflito** nomeando as duas, nunca um merge e nunca um
overwrite.

`saved` sem revisão nova também é recusado: é o estado que pinta o "salvo" verde, e sem revisão a
próxima checagem de conflito não checa nada.

91 testes.

## Copiloto de IA: procedência, portão de aceite, QA e auditoria (`aiCopilot.ts`) — RTV-224

O enunciado do ticket é o requisito: *"a IA deve ser copiloto, não autora final"*. Fácil de concordar
e difícil de garantir, porque a falha não é o modelo dizer algo errado — modelos dizem coisas erradas
e o radiologista pega. A falha é **uma frase escrita por máquina virar uma afirmação humana assinada
sem ninguém ter decidido que deveria**.

### Texto sugerido e texto aceito são substâncias diferentes

Uma sugestão no editor parece exatamente uma frase que o radiologista digitou. Depois de estar no
documento não há como distinguir, e **a assinatura cobre as duas**. Então a procedência viaja no
**trecho**, não no documento: `human`, `ai-suggested`, `ai-accepted`, `ai-edited`.
`aiAssertSignable` recusa qualquer documento com um trecho ainda em `ai-suggested`, e essa recusa é
o ticket inteiro numa função.

`ai-accepted` e `ai-edited` são estados separados de propósito: ambos são atos humanos, mas
respondem perguntas diferentes numa auditoria. Aceito significa que alguém leu e concordou; editado
significa que alguém leu e mudou, que é evidência **mais forte** de atenção — e vale poder contar
separadamente ao avaliar se o modelo ajuda.

### Silêncio não é consentimento, e nem uma faixa

O portão é **por sugestão**. Um único "revisei as sugestões da IA" não é uma decisão sobre as catorze
frases que ele cobre — é uma decisão sobre a caixa de seleção. Por isso **não existe aceite em lote
neste módulo**, e a ausência é decisão de desenho, não lacuna: aceite em lote é exatamente a
affordance que transforma o copiloto em autor.

### A impressão é a parte que não pode ser gerada sem leitura

Um parágrafo de achados levemente errado é um parágrafo que o leitor confere contra as imagens. Uma
**impressão** levemente errada é a parte em que o solicitante age, frequentemente sem ler o resto.
Então a impressão tem regra mais estrita: pode ser rascunhada, mas **impressão gerada e aceita sem
edição** é uma pendência de QA própria.

### QA que bloqueia, e QA configurada para bloquear

As checagens são pouco interessantes. O que importa é a resolução de severidade: uma checagem que a
instituição **não configurou** é **bloqueante**. Defaultar para informativa significa que uma
checagem acrescentada num release não faz nada até alguém ligá-la — e o dia em que ela não faz nada é
o dia em que era necessária. Relaxar tem de ser ato deliberado, gravado na política.

Tudo falha fechado: lista de perfis vazia concede **nada**, não tudo — uma allow-list vazia lida como
"todos" é como um recurso chega a um hospital que decidiu contra ele.

### Uma auditoria que responde "qual modelo escreveu esta frase"

Meses depois a pergunta é sobre **uma frase de um laudo**: o que a produziu, de que contexto, qual
versão, quem aceitou. Um log que registra "IA usada" não responde nada disso, e em particular **não
sustenta a retirada de uma coorte de laudos** quando uma versão de modelo se mostra sistematicamente
errada. Daí `modelVersion` não ser opcional, e o registro recusar-se a existir incompleto, listando
as lacunas por nome.

O contexto é guardado por **referência**. Manter o prompt inline poria identificadores de paciente
numa tabela de auditoria com regra de retenção diferente da do estudo — uma divulgação criada pelo
próprio log.

### Aceitação e utilidade são números diferentes

Um modelo cujas sugestões são sempre editadas tem aceitação ruim e **ainda economiza digitação**. Um
modelo cujas sugestões são sempre aceitas sem alteração pode ser bom — ou pode ser sinal de que
ninguém está lendo, que é por isso que a QA sinaliza impressão gerada e não editada
**independentemente** do que essa taxa diga. Ambos quebrados por versão de modelo, que é a unidade
que muda.

74 testes.

## Workspace de laudo: geometria, abas, medida e evidência (`workspaceLayout.ts`) — RTV-223

O objetivo declarado do ticket é *"manter os olhos do radiologista na imagem e reduzir troca de
contexto"*. Todas as regras aqui saem disso, e as úteis são os lugares onde a implementação óbvia
trabalha silenciosamente **contra** ele.

### 🚨 Viewer apertado é pior que layout recusado

O painel é especificado em 440-560 px. Numa tela de 1920 px sobra. Num laptop de 1366 px — que é o
que um residente de plantão realmente tem — 440 px de painel mais o chrome deixam **830 px de
viewer**, e para uma mamografia adquirida em 4096 × 3328 essa é uma escala de exibição em que um
agrupamento de microcalcificações fica **sub-pixel**.

Então a restrição não é expressa como largura de painel. É expressa como **largura mínima de viewer,
por modalidade**, e quando o viewport não comporta as duas coisas o núcleo **recusa o lado a lado** e
manda desacoplar. Encolher o viewer em silêncio é o único desfecho que não pode acontecer, porque
**nada na tela diz ao radiologista que ele passou a ler numa escala que esconde achados**.

Os mínimos vêm da matriz de aquisição, que é o único dado que o núcleo tem: corte transversal é
512², então 768 px é 1,5× e confortável; radiografia de projeção é 2048+; mamografia é a estrita.

**Achado sobre o ticket, não sobre o código:** em 1366 px, com 1270 px úteis, o painel mais estreito
permitido deixa 830 px de viewer — **corte transversal cabe, mamografia não cabe de jeito nenhum** e
nenhuma largura de painel faz caber. Esse é o desfecho correto, não uma limitação a contornar: um
laptop de 1366 px não é tela para ler mamografia ao lado de um painel de laudo.

### Perder o cursor é chato; perder uma medida meio digitada é clínico

Estado por aba, com scroll e seleção, porque o critério pede. Mas a parte que importa mais é a
**edição não confirmada**: um campo com "1,5" digitado e não comitado, abandonado por uma troca de
aba, **reverte em silêncio** — e o radiologista viu a si mesmo digitar, então não tem motivo para
conferir. `wsSwitchTab` recusa até o chamador resolver.

### Uma medida inserida como achado tem de chegar inteira

*"Sem reeditar manualmente"* é o critério, e a falha que ele convida é um achado que carrega o número
e **perde a unidade** — a família que este código encontra em todo módulo, onde um valor plausível na
unidade errada não parece errado para ninguém. Recusa em vez de assumir milímetro. E recusa sem
referência de imagem completa, porque achado cuja evidência não pode ser reaberta não é rastreável
(RTV-226).

Também recusa medida que **mudou ou foi apagada** no viewport desde o pedido: o viewer é a autoridade
sobre o que está na imagem, e um achado afirmando um número que a imagem não carrega mais é uma
resposta errada com aparência de confiança.

### Clicar num achado tem de cair na imagem certa, ou não cair em lugar nenhum

Contexto parcial resolve para *uma* imagem, não *a* imagem — e o radiologista então confere outra
fatia e **confirma um achado que não olhou**, que é pior que o clique não fazer nada. Exige estudo,
série, instância e quadro juntos.

Série indisponível também recusa, em vez de navegar para um viewport vazio: **viewport vazio é lido
como "nada aqui", que é uma afirmação sobre o paciente e não sobre o carregamento.**

### Duas janelas divergem

Não é exótico: é o que acontece quando alguém abre o próximo caso na janela principal enquanto o
editor ainda tem o laudo anterior. O viewer mostra o estudo A, o editor edita o laudo do B, e uma
medida passada de um para o outro **cai no paciente errado**.

67 testes.

## Fala para estrutura (`voiceStructure.ts`) — RTV-225

A intuição do ticket está certa: *"a melhor experiência não é transcrever tudo em texto livre; é
transformar fala em texto + estrutura"*. O perigo está na segunda metade.

Texto livre é lido por um humano antes de ser assinado. **Dado estruturado não é lido por
ninguém** — vai para o registro de câncer, para a categoria RADS, para a fila de seguimento, e o
único contato do radiologista com ele foi o momento em que um chip apareceu na tela enquanto ele
olhava a imagem.

Então tudo que é extraído aqui é **candidato**: chips com confiança e estado de confirmação, e
commit em campo CDE/RADS **recusado** sem confirmação explícita. Mesma regra do portão de procedência
do copiloto (RTV-224), pelo mesmo motivo e com a mesma forma.

### As três coisas que o ditado em português erra

**Negação.** O reconhecedor engole palavras curtas e não acentuadas, e **"não" é a palavra
clinicamente decisiva mais curta do idioma**. "não há nódulo" virando "há nódulo" inverte um laudo.
Então polaridade nunca é inferida da ausência: frase sem marcador explícito volta `unknown`, e isso é
recusa no commit.

**Lateralidade.** "direito" e "esquerdo" são acusticamente distantes e raramente confundidos. A forma
perigosa é a abreviação: **"D" e "E" ditos como nomes de letra são um fonema cada**, o reconhecedor os
troca, e "lobo superior D" é exatamente como radiologista dita. A forma abreviada é marcada como
confiança baixa e **nunca é auto-comitada** — nem com uma confirmação, porque confirmar um valor que o
reconhecedor adivinhou de um fonema é confirmar o palpite, não o lado.

**O separador decimal.** Um motor configurado para en-US emite "1.5" onde o falante disse "um vírgula
cinco", e um parser a jusante lendo "1.5" com expectativa pt-BR pode transformar em 15. É a falha que
o diff de versões existe para pegar (RTV-227) chegando pelo microfone. Os dois separadores são
aceitos, e um número com **os dois** ou com forma de milhar ambígua é **recusado** em vez de
adivinhado.

Medida sem unidade é recusada, não defaultada: *"um vírgula cinco" é 1,5 cm para um radiologista de
tórax e 1,5 mm para um neurorradiologista medindo um aneurisma*, e o módulo não sabe qual dos dois
está falando.

### Conteúdo não pode executar

"assinar" é comando. É também palavra que aparece em conteúdo ditado: *"o paciente assinou o termo de
consentimento"*. Um parser que varre toda fala procurando palavras de comando **eventualmente assina
um laudo porque alguém descreveu um termo de consentimento**.

Comando só é reconhecido em modo de comando, no qual o chamador entra deliberadamente, e em modo de
ditado o núcleo **nunca** devolve comando — devolve texto. Comandos destrutivos (assinar, apagar
achado, marcar achado crítico) exigem confirmação mesmo dentro do modo de comando.

### Ditado cai onde o cursor estava, ou não cai

Uma fala de quatro segundos sobrevive ao foco em que começou. Texto que chega depois de o radiologista
tabular para a impressão, inserido "no cursor atual", cai na seção errada — e **uma frase de achados
na impressão é lida como a conclusão**.

### Retenção e residência

A transcrição é registro verbatim de um médico discutindo um paciente nomeado, e frequentemente contém
**mais** que o laudo: o aparte que não foi ditado no documento, a correção falada em voz alta. Manter
precisa de prazo e motivo; e mandar para um reconhecedor em nuvem precisa do provedor nomeado, porque
*"onde isso foi processado"* é a primeira pergunta de uma auditoria.

87 testes.

### O painel (`getPanelModule/VoiceStructurePanel.tsx`)

O núcleo decide; o painel é onde a decisão pode ser desfeita. Quatro regras, cada uma fechando
uma rota:

**Nenhum chip se comita sozinho.** Um chip que aparece e "some" para dentro do campo estruturado
depois de um instante parece fluido e é a pior coisa que este painel poderia fazer. Não há
temporizador, não há "confirmar todos", e um teste varre os controles exigindo que cada botão de
confirmar carregue `data-single-chip`.

**O campo de correção aparece exatamente onde o núcleo recusaria.** A condição não é reescrita na
UI: o painel chama `voiceCommitChip` com o chip e pergunta. O teste percorre sete falas e todos os
chips de cada uma, exigindo que *"ofereceu correção"* e *"o núcleo recusa sem correção"* sejam o
**mesmo conjunto** — é o que impede a regra de divergir numa mudança futura.

**O rótulo do valor sai dos mapas do núcleo.** `chip.value` de polaridade é `present` e de
lateralidade é `right`: valores de máquina. Duas telas traduzindo `unknown` por conta própria viram
"desconhecido" numa e "ausente" na outra, e a segunda é uma afirmação clínica. Por isso
`VOICE_POLARITY_LABELS` e `VOICE_LATERALITY_LABELS`, com teste de igualdade exata em cinco falas.

**🚨 A confirmação de comando destrutivo fica presa à fala.** A primeira versão guardava um
booleano: confirmar *"apagar achado"*, não executar, e em seguida dizer *"assinar laudo"* encontrava
a confirmação ainda de pé — um laudo assinado com a confirmação dada para apagar um achado. Agora o
estado guarda **qual fala** foi confirmada e só vale para ela, e vale **uma vez**. Prender ao texto
é mais estrito que prender ao comando: falas diferentes podem cair no mesmo comando, mas a mesma
fala nunca cai em comandos diferentes.

Duas coisas que o painel deliberadamente **não** faz. Não usa `voiceDescribeChip` como
`aria-label`: ela devolve `laterality - right - confianca baixa`, linha de log, e daria ao leitor de
tela o valor de máquina enquanto a tela mostra "direito" — o texto visível e o texto acessível são o
mesmo. E não imprime `interpretation.value.message` no ditado: a frase do núcleo está no passado
("texto ditado inserido em achados") porque descreve um resultado, e ali nada foi inserido ainda — o
campo vem do núcleo, a conjugação é da tela.

O modo vem do hospedeiro, com padrão **ditado**: em ditado nada executa, então um hospedeiro que
esqueceu de informar o modo perde uma conveniência; o padrão inverso assinaria um laudo porque
alguém descreveu um termo de consentimento. Sem `actorId` o painel não monta — um formulário
completo cujo único desfecho possível é recusa por falta de responsável é pior que dizer isso.

A retenção da transcrição fica aqui, e não em outro painel, porque é a transcrição desta tela: sem
destino pré-selecionado (o padrão "manter" seria a instalação decidindo guardar a gravação de um
médico discutindo um paciente nomeado porque ninguém mexeu no campo), prazo só onde "manter" foi
escolhido, provedor exigido quando a transcrição sai da instituição.

51 testes de painel.

## Laudo inline no painel direito (`inlineReporting.ts`) — RTV-121

Este ticket reusa a extensão de laudo num container menor, e **todo o risco de um reuso assim é que
"menor" seja implementado como "menos"**. Um editor de tela cheia e um painel lateral têm de produzir
**o mesmo documento com as mesmas obrigações**; só a apresentação pode diferir.

### Um template de RT oferecido para uma leitura de radiologia

A biblioteca tem templates de radiologia e de radioterapia, e os campos de um template de RT são
sobre um plano de tratamento: dose prescrita, fracionamento, volumes-alvo. Oferecer um para a leitura
de uma CT de tórax não é apenas desarrumado — **seus padrões pré-preenchidos são afirmações clínicas
sobre um tratamento que não existe**, e RTV-228 então bloqueia a assinatura por campos que o
radiologista não consegue interpretar.

Então a elegibilidade é decidida por um `domain` **explícito**, nunca inferido do título: *"Tórax"
está no nome de um template diagnóstico de tórax e de um template de plano de RT de tórax*, e um
casamento por título mais cedo ou mais tarde escolhe o errado.

### 🚨 Menor não pode significar menos campos

O painel é estreito, então a implementação óbvia recolhe seções ou descarta as que não caibam. Duas
coisas dão errado, e a segunda é séria:

1. uma pendência bloqueante dentro de uma seção recolhida deixa o radiologista **sem ver por que** a
   assinatura é recusada, e ele conclui que o botão está quebrado;
2. uma implementação que valida **só o que renderiza** deixa o laudo ser assinado com um campo
   afirmativo não confirmado — que é exatamente o "laudo normal por omissão" que RTV-228 existe para
   impedir, **reintroduzido pelo layout**.

Então `validatedFieldIds` é sempre a lista completa, nos dois modos; seções podem ser recolhidas; e
**qualquer seção contendo uma pendência bloqueante é forçada aberta**.

`inlineAssertSameObligations` é a asserção de que o conjunto de campos do modo inline é igual ao da
tela cheia — escrita como asserção e não deixada para revisão, porque uma divergência aqui é
invisível: **os dois painéis renderizam, os dois salvam**, e a diferença só aparece como um laudo sem
uma seção que o template exigia.

### Esconder o chrome de RT é o objetivo; esconder o dado de RT não é

Uma CT de tórax lida diagnosticamente num paciente que também tem RTSTRUCT e RTPLAN no estudo
significa que **o paciente está sob tratamento**, e isso é contexto clínico com o qual o laudo devia
ser escrito. Suprimir o fato junto com a barra de ferramentas é laudar o estudo sem ele.

### O painel direito desmonta

Troca de hanging protocol, troca de layout e recolher a barra lateral todos desmontam o painel — e
acontecem no meio de uma frase, porque o radiologista troca o layout para olhar um comparativo
enquanto dita. Desmontar descartando o rascunho perde texto que ele **viu a si mesmo produzir**.

`study-closed` é tratado igual, não como exceção: fechar o estudo é o momento em que o rascunho tem
mais chance de ser esquecido.

58 testes.
