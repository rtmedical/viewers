# @ohif/extension-rt-worklist

RIS-style study list for OHIF v3 (RTV-161).

## Composite filters, chips and saved views — RTV-185, RTV-186, RTV-187

| Module | Purpose |
| --- | --- |
| `worklistFilters` | Composite AND/OR criteria, local evaluation, and URL round-tripping |
| `worklistViews` | Saved views and pinned chips over a pluggable store |

### Filters (RTV-185)

Criteria combine with an **explicit** AND/OR, because "CT or MR" and "CT and MR" are
both things a reader means and only one can be the default.

`matchesStudy` runs the same predicate a server would, so a filter behaves identically
whether the rows came from QIDO-RS or a RIS API. Dates normalise from both `20260814`
and `2026-08-14` for the same reason.

Three behaviours are deliberate and tested:

- **An empty group matches everything.** Clearing the last chip shows the full
  worklist, not an empty one — even though the mathematical convention for an empty OR
  is the opposite.
- **An empty needle matches everything.** A half-typed search box must not blank the
  list before the reader finishes the word.
- **An undated study never satisfies a date filter.** Treating it as a match would
  quietly pad every date-filtered list.

### URL state, and a separator bug worth remembering

Filters serialise to one compact query value:

```
?filter=modality:anyOf:ct,mr;reportStatus:equals:none
```

Compact so it survives being pasted into a chat window, which a JSON blob does not.

The separators **must** be characters that `encodeURIComponent` escapes. The first
version used a tilde as the criterion separator, which is wrong: `encodeURIComponent`
leaves the unreserved marks (hyphen, underscore, period, exclamation, tilde, asterisk,
apostrophe, parentheses) untouched, so a patient name containing a tilde would inject a
criterion boundary and split the filter. A unit test with a hostile value caught it;
the semicolon, colon and comma all encode (%3B %3A %2C).

Unknown fields and operators are **dropped, not rejected** — the URL may come from a
colleague on an older build.

### Views and chips (RTV-187, RTV-186)

A view is a named snapshot of *filters + columns + sort*; a chip is the same thing
pinned above the list. They are **one type**, not two: "Urgentes" as a chip and as a
saved view are the same intention, and splitting them would mean two editors, two
storage shapes and two ways to disagree.

System views (Sem laudo, Urgentes, CT, MR) are read-only and **never persisted**, so an
admin changing the list changes it for everyone instead of fighting stale copies in
every browser. A stored view claiming `scope: 'system'` is demoted to `user` —
otherwise a hand-edited localStorage entry would be undeletable.

### Persistence seam

Everything goes through a `ViewStore` adapter with two methods. The default is
localStorage, which makes the feature work **today**; swapping in the Connect endpoints
(`/api/worklist-views`) later is one implementation of the same interface, with no
change to any logic. RTV-187 is blocked on backend only for *sharing*, not for working.

### Not delivered

No UI. These are the model and the rules; the filter panel, the chip bar and the views
dropdown are components on top. Nothing here has been seen in a browser.

## Operações em lote (RTV-191)

`worklistSelection.ts` + `worklistBatch.ts` + `worklistExport.ts` — cores puros, sem React
e sem `@ohif/*`, para o supervisor que chega de manhã e distribui 80 exames entre cinco
radiologistas.

**Seleção é por id, nunca por índice de linha.** A lista é virtual-scrolled e re-ordenável;
índice 4 é outro paciente depois de um sort. Guardar ids é o que faz a seleção sobreviver
ao scroll (critério de aceite) e é a única forma de a ação em lote ter certeza de que age
sobre os estudos que o usuário clicou.

**A âncora se move no clique simples, nunca no shift+click.** Se `extendTo` movesse a
âncora, um segundo shift+click mais abaixo começaria um intervalo novo em vez de estender o
original — estender a seleção derrubaria a cabeça dela. Toda tabela que erra isso parece
sutilmente quebrada e ninguém sabe dizer por quê.

**"Selecionar todos" não pode ser uma lista de ids.** Ctrl+A sobre uma worklist filtrada
significa "os 3.200 estudos que casam", e o cliente só buscou a página atual. Mandar os 100
ids que ele tem como se fossem todos é pior que impossível: é errado e silencioso. Por isso
o estado tem dois modos — `explicit` (ids concretos) e `matching` ("tudo que a query casa,
menos estas exclusões") — e `resolveTargets` devolve a *query*, não ids, no segundo caso.
`canResolveAsIds` diz na cara se o endpoint só aceita ids, para a UI desabilitar a ação em
vez de aplicá-la pela metade. Mudança de filtro descarta uma seleção `matching` e preserva
uma `explicit`: "todos que casam" passou a denotar outro conjunto.

**Sucesso parcial é o caso normal.** De 23 estudos, 18 atribuem e 5 voltam 409 porque outro
supervisor pegou. O toast "23 estudos atribuídos" é o desfecho perigoso: o supervisor segue
achando que o plantão está distribuído e cinco exames ficam sem dono com SLA correndo.
`describeReport` se recusa a redigir execução parcial como sucesso.

**Undo é escrita compensatória e precisa do valor ANTERIOR por estudo.** O servidor já
mudou; "Desfazer" tem que reescrever o valor antigo, e ele é *diferente para cada estudo* —
alguns estavam sem radiologista, outros com outro. Um undo que grava um valor só em todos
não restaura o estado anterior: inventa um novo, errado, sob um botão escrito "Desfazer".
`createUndoEntry` exige valor prévio de todo id e devolve `null` se faltar algum — nenhum
botão é melhor que um que corrompe.

**CSV: célula que começa com `=`, `+`, `-` ou `@` é fórmula.** Excel avalia na abertura.
É CSV injection, e é um caminho real de "campo de nome no RIS" até "código roda no notebook
do supervisor". Aspas sozinhas não resolvem — `"=1+1"` ainda avalia; o prefixo de escape
tem que ficar *dentro* do campo aspado.

Backend: `POST /api/studies/batch-assign`, `PATCH /api/studies/batch-priority`. Não existem
ainda; o runner recebe o applier por parâmetro, então o dia em que existirem é uma função
de transporte, não uma mudança aqui. **Nada disso está ligado na `RtWorklistPage` ainda** —
checkbox de linha, toolbar de lote e toast são o passo de UI que falta.

## Ações por estudo: hover, overflow e menu de contexto (RTV-190)

`worklistActions.ts` — resolver puro para o que aparece na linha, no `⋯` e no clique
direito. Fica num resolver e não em condicional de JSX porque *qual ação é oferecida,
onde, e se está oculta ou desabilitada* é a substância do ticket.

**Oculto e desabilitado são respostas diferentes.** Oculto = este usuário nunca pode
fazer isso; "Cancelar estudo" para não-admin não é botão cinza, não existe — controle
permanentemente proibido não ensina nada e gera chamado perguntando por que não funciona.
Desabilitado = normalmente disponível, impossível *agora*; C-MOVE sem peer configurado
fica cinza e **diz por quê**, porque esconder faria o supervisor caçar uma funcionalidade
que ele sabe que existe. Todo item desabilitado carrega `disabledReason` — controle cinza
sem explicação é o pior dos três estados, e há teste que varre e falha se algum aparecer
sem motivo.

**Ação destrutiva nunca entra no hover.** Botão de hover fica sob um ponteiro em
movimento, numa tabela densa, em linhas que se deslocam quando a lista atualiza.
"Cancelar estudo" a um pixel de "Abrir no viewer" é mis-click esperando acontecer — e a
consequência é exame cancelado, que o supervisor depois tem que explicar. Destrutivas só
pelo overflow e pelo menu de contexto, ambos exigindo um segundo clique deliberado, e
declaram `confirm: true`. No menu de contexto o grupo de perigo é o último e sozinho, para
o ponteiro nunca passar por cima dele a caminho de algo benigno.

**Permissão entra por predicado, não por import.** As regras de acesso são do
`@ohif/extension-rt-governance` (RTV-193); importar aqui seria dependência
cross-extension, que as regras da casa proíbem e que tornaria este pacote inutilizável sem
aquele. O chamador passa um `CapabilityCheck`; os *nomes* das capabilities são o contrato
e estão exportados em `ACTION_CAPABILITIES` para a costura poder ser testada. Sem checker,
falha fechado.

**Copiar Patient ID é PHI saindo da tela** (`isAuditableCopy`), e o que vai para a área de
transferência é o valor **cru**, nunca o texto truncado da célula: `12345…` colado na
busca do RIS não acha nada e o leitor culpa o RIS. Campo vazio devolve `null` em vez de
string vazia — não se sobrescreve a área de transferência do usuário com nada.

**Rebaixar prioridade pede justificativa; escalar não.** Baixar um estudo escalado é
decisão clínica que alguém tem que assumir.

Backend: `PUT /api/studies/{id}/assign`, `PATCH /api/studies/{id}/priority`,
`POST /api/dicom/send`, presença por WebSocket e peers do RTVW-16 — nada disso existe
ainda. **Não está ligado na `RtWorklistPage`**: os botões de hover, o menu de contexto e os
toasts são o passo de UI que falta.

## Adaptador multi-datasource: QIDO-RS + RIS (RTV-183)

`multiDatasource.ts` — o QIDO sabe que imagens existem; o RIS sabe o que foi pedido, quão
urgente é, para quem está atribuído e se já foi laudado. **Nenhum dos dois é autoridade sobre a
metade do outro**, e a worklist precisa das duas.

**A propriedade é por campo, não por registro.** A fusão óbvia — pegar o registro que chegou
por último — **troca o responsável a cada refresh**, porque a linha do PACS não tem responsável
e sobrescreve com nada. Ou perde a contagem de séries, porque a linha do RIS não tem uma.
`FIELD_OWNER` é o desenho inteiro: `numSeries` vem do PACS diga o RIS o que disser, `priority`
vem do RIS diga o PACS o que disser, e um campo só cai para a outra fonte quando o dono está
calado.

**Fonte fora do ar não é fonte dizendo "vazio".** Se o QIDO dá timeout e a fusão trata o
resultado vazio como verdade, todo estudo perde a imagem e metade some da lista. O radiologista
vê uma worklist mais curta e conclui que a manhã está tranquila. É a falha clássica de sistema
distribuído, e vale explicitar porque **o sintoma — lista com menos linhas — parece operação
normal**. A função recebe um *resultado* por fonte, não uma lista: fonte que falhou não
contribui e marca as linhas que não pôde confirmar.

**Casar entre as fontes, e recusar chutar.** StudyInstanceUID quando o RIS o tem; accession +
paciente quando não. Quando dois candidatos casam com uma linha, **nenhum é usado**: um par
fundido de estudos *diferentes* produz uma linha com as imagens de um paciente e o status de
laudo de outro, e nada nela parece errado.

`fieldProvenance` existe para uma conversa de suporte sobre "a prioridade está errada" ser
respondida apontando a fonte, em vez de adivinhando qual sistema culpar.
