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
