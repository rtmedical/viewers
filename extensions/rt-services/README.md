# @ohif/extension-rt-services

Shared RT Medical services/commands for OHIF v3 — **RTV-160** (local-file
drag-drop support). Follows **RTV-114** (extension-first / zero fork).

## Scope (important — avoids duplicating native v3)

OHIF v3 **already** ingests local files natively:
`platform/app/src/routes/Local/filesToStudies.js` + `DicomLocalDataSource` +
`pdfFileLoader.js` handle **DICOM and PDF**, **multi-file batches**,
**SOP-class detection** and **progress** (the `/local` route). Re-porting the
legacy connectviewer `filesToStudies` would duplicate that, so this extension
**does not**.

What the native route does **not** expose is a reusable way to *classify /
validate* a dropped file set before ingestion — needed for drag-drop in arbitrary
modes and especially the **RTVW desktop**. This extension adds exactly that.

## Modules

| Module | Purpose |
| --- | --- |
| `localFileClassifier` (`classifyFile`, `partitionLocalFiles`) | Pure, unit-tested file classification (dicom / pdf / image / unknown) + partition with an `ingestible` summary |
| `getCommandsModule` | `classifyLocalFiles` and `summarizeLocalFileDrop` commands (framework-free) |

## Acceptance coverage

- **DICOM local parser / PDF encapsulated / multi-file / progress / SOP-class
  detection** — provided by **native OHIF v3** (verified); reuse, not re-port.
- **This extension adds**: reusable classification/validation of a drop set
  (DICOM vs PDF vs image vs unknown, ingestibility), with a human-readable
  summary command for drag-drop UIs.

## Follow-up

- Wiring an in-session drag-drop overlay that calls the native ingest
  (`filesToStudies` / `DicomMetadataStore`) is an app/RTVW integration step
  (it requires `@ohif/core` and the running data source) tracked separately.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-services/jest.config.js --ci
```

## Sessão OIDC, RBAC e encerramento (`oidcSession.ts`) — RTV-155

Quando renovar, se uma sessão pode ser usada, o que o usuário pode fazer, e o que um logout é
obrigado a limpar. Sem `@ohif/*`, sem React, sem biblioteca OIDC, sem relógio, sem `throw`.

### O token expirado que parece válido

Renovação é decidida contra uma **margem de antecedência**, e há um segundo limiar — o *orçamento
de requisição* — abaixo do qual o token não é mais anexado a pedidos novos, mas o usuário
**continua autenticado**. Essa distinção existe porque colapsá-la faz a UI limpar a tela de alguém
que está apenas a dez segundos de uma renovação.

Na direção oposta, um token **emitido no futuro** além da tolerância de skew é **recusa**, não algo
a absorver: se o relógio da estação discorda do IdP mais do que as margens comportam, todo cálculo
de vida restante abaixo é ficção, e um viewer que renova em momentos arbitrários desloga gente no
meio do ditado. O conserto é um técnico, não um login — e a mensagem diz isso.

E `now` não finito é **recusa**, não um caminho tolerado: toda comparação contra `NaN` é falsa,
então uma cadeia if/else sobre as margens cai no último ramo — e o último ramo de uma checagem de
sessão é "usável". Seria uma checagem de token que diz sim para um token morto.

### 🚨 A renovação que falha e vira uma worklist vazia

O modo de falha que mais importa: a renovação falha, a busca da worklist devolve 401 com zero
linhas, e o painel desenha "nenhum estudo encontrado". O radiologista acredita que não há trabalho,
fecha o viewer, e os estudos ficam sem laudo.

`oidcPresentWorklist` tem quatro saídas — `studies`, `empty`, `loading`, `sessionEnded` — e o
estado da sessão **domina** a flag de carregamento, porque um `loaded` obsoleto de antes da sessão
morrer deixaria um zero passar como `empty`. Um `studyCount` **não numérico** também é recusa: em
`results?.length` com `results` indefinido o resultado é `undefined`, e `undefined === 0` é falso —
uma implementação ingênua reporta "studies" e desenha uma tabela vazia sem explicação, a mesma tela
errada chegando pelo outro lado.

### RBAC que falha fechado, e a assinatura que não se delega

Papéis ausentes, array vazio, papel que ninguém configurou: todos dão **conjunto vazio** de
permissões. Ação não registrada na tabela é **negada** — ação nova é exatamente a que não deve
default para permitido. E autenticado **não é** autorizado: são códigos de recusa distintos porque a
UI reage diferente a cada um.

O ponto mais afiado: `report.sign`, `report.retract` e `study.delete` são **não delegáveis**. Um
administrador de TI com `user.admin` não é radiologista, e um sistema que deixa a conta de
administrador assinar produz **um laudo legalmente assinado atribuído a quem nunca viu as imagens**.
O consumidor a jusante (RTV-154) trata `admin` e `'*'` como "pode tudo", então a proteção tem de
morar deste lado — e nada aqui emite o curinga.

Instituição nunca tem default: este viewer serve vários hospitais, e escolher *alguma* instituição
significa mostrar pacientes de um hospital para a equipe de outro. Payload ambíguo é recusado para a
UI ter de perguntar — um clique extra é mais barato que um incidente de confidencialidade. E a conta
listar duas instituições **não** confere acesso cruzado; isso é uma permissão.

### O logout que deixa dados na estação compartilhada

A lista de itens a limpar é uma **lista**, não um corpo de função, porque o modo de falha é
*omissão*: um logout escrito como sequência de comandos está a uma linha esquecida de deixar um
cache de estudo, e quem revisa não sabe qual linha falta. Uma lista pode ser diferenciada contra o
que a camada de cola confirmou.

Os últimos itens são os que implementações reais esquecem: o OHIF guarda pixel em **IndexedDB e
atrás de um service worker**, e um logout que limpa `localStorage` e navega deixa uma cópia completa
das imagens do paciente anterior numa máquina compartilhada. Filtros e buscas recentes também —
carregam nome e prontuário digitados pelo usuário anterior.

**Silêncio conta como não limpo.** Uma cola que acrescenta um cache e esquece de reportá-lo recebe
"incompleto", não atestado de limpeza; e um erro de digitação no nome do item cai em `missing` em vez
de casar com nada e passar. Silêncio é a forma normal de um bug aqui, então não pode significar
sucesso.

E o IdP inalcançável **não** impede a limpeza local: um logout com tudo apagado localmente e o
redirect falhado é **completo**, com `serverSideRevocationPending` para o chamador tentar depois.

### Laudo em rascunho quando a sessão termina

Logout iniciado pelo usuário com conteúdo clínico não salvo é **bloqueado** até uma resposta; logout
involuntário (inatividade, renovação esgotada) prossegue, mas relata o que foi destruído sem ter
sido salvo. Perder um ditado é dano real mesmo não sendo uma medida errada.

116 testes.

## Google Cloud DICOM Store (`gcpDicomStore.ts`) — RTV-158

A álgebra de caminhos, a máquina de estados do picker hierárquico, e a política de lotes, progresso
e retentativa do upload. Sem HTTP, sem SDK do Google, sem relógio, sem `throw`.

### 🚨 Subir um paciente para o store da instituição errada

A hierarquia é `projects/{p}/locations/{l}/datasets/{d}/dicomStores/{s}` — quatro IDs opacos. Um
picker que mantém a seleção filha quando o pai muda constrói `projectA/.../storeDoProjectB`: o
caminho é **sintaticamente perfeito**, a API resolve cada ID independentemente, e o upload pousa no
store de outro tenant **respondendo 200**.

Então `gcpSelectLevel` invalida **todo descendente**, e construir caminho de hierarquia parcial é
**recusa**, não uma string com buraco. IDs com `/` também são recusados — uma barra dentro do ID
reparenta o recurso silenciosamente.

Detalhe que evita o dano pelo outro lado: reselecionar o **mesmo** ID é no-op e **mantém** os
descendentes. Um picker que apaga as escolhas de baixo a cada refresh de listagem força o operador
a re-escolher o store sob pressão de tempo, que é como o store errado é escolhido em primeiro lugar.

### "Upload completo" quando não estava

Um estudo faltando instâncias **abre e renderiza**, e o radiologista não tem como notar as fatias
que faltam. Então:

- toda instância enviada tem de aparecer no corpo da resposta, senão **recusa** — um 200 de nível de
  lote que simplesmente omite uma instância é a forma exata de "completo" sobre um estudo furado;
- **2xx sobre um corpo com rejeições não é sucesso**;
- resposta sobre instância que não enviamos é recusa — significa que respostas casaram com o pedido
  errado, e contá-la infla o total aceito;
- instância já aceita reportada como rejeitada é recusa: os dois relatos descrevem bytes diferentes
  sob um UID, e escolher qualquer um perde uma instância silenciosamente.

`safeToOpenInViewer` é a linha de fundo clínica, e é **falsa** enquanto uma única instância planejada
estiver sem resposta.

### Retentativa que retoma em vez de duplicar

Reenvio é idempotente por SOP Instance UID, e uma reaceitação é contada como **duplicata**, nunca
como segunda aceitação — um total inflado faz um upload incompleto parecer completo.

E as três classes de falha são distintas de propósito: **`retryable`** (tente depois),
**`permanent`** (conserte ou exclua o arquivo) e **`reauthRequired`** (autentique de novo). Colapsar
as duas últimas é o que faz uma instância malformada retentar para sempre atrás de uma barra de
progresso que nunca completa.

### O escopo verificado antes do primeiro byte

Um token válido para **ler** usado num **upload** falha só no momento do upload, depois da espera. O
escopo é checado antes, e a assimetria é explícita: `cloud-platform` cobre `healthcare`, e o
read-only **não cobre nada** — um token de leitura nunca é aceito para upload só porque lista stores
bem.

E há a pergunta que evita o estrago: *este upload termina antes do token morrer?* — feita **antes**
do primeiro byte. Sem ela, um upload de 40 min começa com token de 3 min, falha na instância 900 de
1200, e deixa um estudo parcial na nuvem que abre e renderiza.

Nota de segurança que o rascunho trouxe e vale registrar: o tipo do token carrega **só escopos e
expiração**, nunca a string do bearer — este núcleo é logado e fotografado em teste, e um bearer que
chega a um snapshot ou a um relatório de bug é **credencial viva de um store de dados de paciente**.

### De-identificação não é implícita

Enviar imagens identificáveis para nuvem é divulgação regulada sob a LGPD, e o modo de falha é que
**ninguém nunca decide**: a flag default é permissiva, o upload passa, e a instituição descobre a
divulgação numa auditoria sem registro de quem autorizou. A decisão tem de ser **explícita,
atribuível e recente** (1 h) — um reconhecimento velho não é reaproveitado para o próximo paciente.

### 🐛 Dois defeitos corrigidos no rascunho

1. **A atribuição em branco passava.** O guarda comparava `acknowledgedBy.length === 0`, então
   `'   '` — presente, comprimento não-zero, e não uma atribuição — passava e era gravado
   verbatim. A auditoria que pergunta *quem autorizou divulgar imagens identificáveis* responderia
   com um espaço em branco. O código de recusa existia exatamente para esse caso e não disparava.
2. **403 estava classificado como `permanent`.** Um grant sem o escopo `healthcare` responde upload
   com **403 `insufficient_scope`** — que é a forma exata do modo de falha que esta seção descreve.
   Como `permanent`, toda instância do lote é marcada rejeitada e o operador é informado de que
   **seus arquivos foram recusados**, quando os arquivos estão bons e o grant está errado.

102 testes.
