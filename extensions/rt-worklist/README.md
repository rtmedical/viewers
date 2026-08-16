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

## Atualização em tempo real: transporte, reconexão e recuperação (RTV-189)

`realtimeSync.ts` — os sockets são adaptadores. O que está aqui é a parte que decide **quando a
lista na tela pode ser confiada**, que é o requisito de produto de verdade: a funcionalidade
existe para que ninguém aperte F5, e uma lista que ninguém atualiza só é segura se estiver ou
atual ou **visivelmente não**.

### Reconectar não é retomar

É a falha que o módulo existe para evitar. Um canal de push que cai por noventa segundos e
volta **não recebe** os estudos que chegaram naqueles noventa segundos — eles foram transmitidos
para ninguém. Retomar o socket e seguir em frente deixa a worklist **permanentemente sem** esses
exames, sem lacuna visível em lugar nenhum: a lista parece normal, ela só está curta. Numa
emergência, é o risco inteiro numa frase.

Toda reconexão marca `resyncRequired` e devolve a janela a reconsultar, e o estado **não volta
para `live`** enquanto a recuperação não for aplicada. A janela alcança antes da queda por uma
folga deliberada: sobrepor é barato e deduplicado, perder um estudo não é.

### Degradado precisa ser visível, ou é pior que nada

Polling a cada trinta segundos é fallback legítimo e significa que a lista pode estar meio
minuto atrasada. Isso é aceitável quando o usuário sabe, e **perigoso quando ele foi informado
de que a lista se atualiza sozinha**. Por isso `degraded` é um estado de primeira classe.

Um canal vivo e calado por muito tempo também deixa de ser confiável: **canal silencioso e canal
morto são indistinguíveis daqui**.

### O mesmo estudo vai chegar duas vezes

Recuperação e push se sobrepõem por construção. Deduplicar não é otimização: **uma linha
duplicada numa worklist de urgência se lê como um segundo paciente**.

### Nada rola sob o leitor

Uma linha aparecendo acima daquela que alguém está prestes a clicar **move o alvo**, e o clique
cai em outro paciente. `autoScroll` é `false` no tipo. O badge diz quantos chegaram; o leitor
decide quando olhar.

## Orthanc local como terceira fonte (RTV-194)

`localDatasource.ts` — o `multiDatasource.ts` (RTV-183) funde PACS e RIS campo a campo. O
desktop acrescenta uma fonte com uma propriedade que nenhuma das outras tem: **o estudo só está
aqui**.

### Um estudo local existe num lugar só

Ele não foi enviado ao PACS, então **não está em backup, nenhum colega o enxerga, e amanhã não
estará no histórico do paciente**. Uma worklist que o desenha igual a um estudo do PACS convida
alguém a emitir laudo sobre imagens que somem junto com o notebook.

Por isso a origem é **estrutural** e não um badge: ela fica na linha, a consequência é dita em
texto, e um filtro pode esconder o chip mas não o fato.

### Um estudo recebido por C-STORE não tem pedido

Ninguém o solicitou no RIS. Não dá para atribuir, priorizar nem faturar, e **um laudo escrito
aqui não tem pedido a que se prender**. É um estado legítimo — é assim que chega um estudo de
CD de outra clínica — e precisa aparecer como estado, não como coluna vazia.

A reconciliação casa por accession **mais** identificador do paciente. Nome sozinho não: estudo
importado de mídia pode estar anonimizado, grafado diferente ou vir de outra instituição. Dois
candidatos e **nenhum é usado** — juntar o par errado produz uma linha com as imagens de um
paciente e o pedido de outro, e nada nela parece errado.

### O mesmo estudo pode estar em dois lugares

Depois de um envio, a cópia local e a remota têm o mesmo StudyInstanceUID. **Duas linhas são
dois pacientes** para um olho cansado às 3 da manhã, então viram uma linha com as duas origens —
e só então apagar a cópia local passa a ser oferecido.

**"Eu enviei" não é o mesmo fato que "está lá".** Apagar a única cópia não é ação que a lista
deva facilitar.

### Credencial nunca chega na página

O Orthanc local tem senha. O descritor carrega um **handle opaco** que o host resolve; não
existe campo para usuário nem senha, então não há onde uma credencial ser posta por acidente — e
uma URL com credencial embutida é recusada.

## Storage Commitment: de quem é a responsabilidade pelas imagens (RTV-101)

`storageCommitment.ts` — a associação DIMSE é um adaptador. O que está aqui é a máquina de
estados, e ela existe para responder **exatamente uma pergunta: a cópia local pode ser
apagada?**

O `localDatasource.ts` (RTV-194) já se recusa a oferecer a exclusão até o PACS ter o estudo.
Este módulo é a parte que estabelece **o que "ter" significa**.

### Um envio bem-sucedido não é um commitment

Um C-STORE que retorna sucesso significa que os bytes foram aceitos pela aplicação receptora.
**Não** significa que foram gravados em armazenamento durável, que sobreviveram à ingestão do
receptor, ou que alguém vai conseguir recuperá-los amanhã. Storage commitment existe
precisamente porque essas são afirmações diferentes, e apagar com base no envio é a rota padrão
para perder um estudo.

### Não responder não é uma resposta

O N-EVENT-REPORT volta numa **associação separada**, possivelmente horas depois. Uma solicitação
sem resposta é `pendente` — não falhou, e definitivamente não está comprometida. Transformar
tempo decorrido em falha faz o estudo ser reenviado para sempre; transformá-lo em sucesso faz a
cópia local ser apagada cedo.

### Uma resposta não é um sim geral

O relatório traz uma lista de sucesso e uma de falha. O estudo está comprometido quando **cada
uma de suas instâncias** está na lista de sucesso. Tratar a chegada da resposta como commitment
do estudo abandona em silêncio o que está na lista de falha — **e é ali que vai parar a
instância que não sobreviveu ao transcode**. Por isso o veredito de exclusão devolve uma lista
parcial em vez de um sim ou não geral.

### O Transaction UID é a única coisa que liga a resposta à pergunta

Relatórios chegam fora de banda. Casar um com "a solicitação pendente mais recente" é um atalho
de aparência plausível que, sob carga, **marca o estudo errado como comprometido** — e parece
robustez.

## Estudos que ainda estão chegando (RTV-20)

`acquisitionProgress.ts` — visualizar uma série durante a aquisição é a funcionalidade. O que
precisa ser escrito é **o que não pode ser feito** com uma série que ainda não está toda lá,
porque a série incompleta é a que parece bem.

### Série chegando parece série terminada

Nada numa pilha de imagens diz quantas deveriam existir. O leitor rola do primeiro ao último
corte e vê um exame inteiro; **a anatomia que não chegou lê-se como anatomia que não foi
imageada**. Essa é a falha, e ela é silenciosa por construção.

### Falha no meio é muito pior que cauda curta

Uma série truncada é visivelmente truncada: o volume acaba num lugar anatomicamente estranho e o
leitor percebe. Um **corte faltando no meio é invisível** — o viewer passa reto, e se a lesão
estava ali nada indica que falta alguma coisa. Por isso a detecção olha as **posições dos
cortes** e não a contagem: a contagem não distingue as duas.

Uma consequência disso é que a lacuna **passa na frente da contagem satisfeita**: se uma
instância foi rejeitada na ingestão e a contagem veio do emissor, os números batem e o buraco
continua lá.

### "Terminou" e "travou" são a mesma coisa vistos daqui

Sem contagem esperada, uma série que parou porque acabou e uma que parou porque o emissor caiu
são indistinguíveis. Mesma forma do canal silencioso do `realtimeSync.ts` (RTV-189), um nível
abaixo: **tempo decorrido não é evidência**.

### Olhar é permitido, medir não

O ponto da funcionalidade é olhar cedo, então visualizar **nunca** é bloqueado. Medir, reformatar,
segmentar e laudar são — porque cada um produz algo que **não carrega marca nenhuma da
incompletude**: um MIP sobre meio pulmão é um MIP perfeitamente normal, e um volume calculado de
uma pilha truncada é um número.

E o artefato derivado **sobrevive ao estado em que foi feito**: um MIP salvo como captura
secundária de um estudo pela metade é um MIP normal para sempre depois disso, e nenhuma regra
sobre o viewport ao vivo alcança ele.
