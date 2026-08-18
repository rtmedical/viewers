# @ohif/extension-rt-record

**RT Treatment Record** support for OHIF v3 — **RTV-163**, the foundation of the
RT Summary / Course Timeline (epic RTV-162). Follows **RTV-114** (extension-first
/ zero fork).

Registers a **SopClassHandler for the 4 RT Treatment Record SOP classes** and
renders a delivery-summary panel (per-session beams, delivered vs specified MU,
fraction, date, machine) with CSV export.

| SOP | Class UID |
| --- | --- |
| RT Beams Treatment Record | `1.2.840.10008.5.1.4.1.1.481.4` |
| RT Brachy Treatment Record | `1.2.840.10008.5.1.4.1.1.481.6` |
| RT Treatment Summary Record | `1.2.840.10008.5.1.4.1.1.481.7` |
| RT Ion Beams Treatment Record | `1.2.840.10008.5.1.4.1.1.481.9` |

No native OHIF handler claims these SOPs, so registering one here is **not** a
duplicate.

## Modules

| Module | Purpose |
| --- | --- |
| `rtRecordParser` (`parseRtRecord`, `recordTypeFromSopClass`, `buildRtRecordCsv`) | Pure, unit-tested record parser (Beams + Ion Beams sessions, delivered/specified MU, fraction, machine) + CSV |
| `getSopClassHandlerModule` | Display set per record (4 SOPs), `rtRecord` parsed onto it (framework-free; local guid) |
| `getPanelModule` | Treatment-records summary panel; opt in via `@ohif/extension-rt-record.panelModule.rtRecord` |

## Scope / follow-ups (epic RTV-162)

This is the **SopClassHandler + summary** slice (RTV-163). The rich Course
Timeline sub-panels — prescription/treatment/imaging/overrides/trends timelines
(RTV-164…180) — build on this parser and are separate tickets. Brachy and Summary
records are recognised (type + identity); their detailed session models are a
follow-up.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-record/jest.config.js --ci
```

## Registros de tratamento digitados à mão (RTV-177)

`manualTreatment.ts` — um curso às vezes tem frações que o sistema nunca recebeu: o acelerador
falhou ao exportar, o paciente foi tratado em outro serviço, a braquiterapia foi entregue em
equipamento que não fala DICOM. **A dose foi entregue de qualquer jeito**, e um resumo de curso
que a omite está errado na direção perigosa.

### Um registro manual nunca pode ser indistinguível de um entregue

É a regra que todo o resto serve. Uma vez inserido, o registro manual flui para a mesma dose
acumulada, a mesma contagem de frações e o mesmo resumo de curso que um registro de máquina — e
esses números são usados para decidir se o paciente já recebeu sua prescrição.

> Um registro de máquina é **evidência** de que a entrega aconteceu como descrita. Um registro
> manual é **a lembrança de alguém**, digitada depois.

Os dois valem a pena e **não são a mesma afirmação**, então a marcação de procedência não é
opcional e o resumo reporta os dois separadamente em vez de somá-los num total só.

### Por que está faltando muda o que significa

"Tratado em outro serviço" e "nosso sistema perdeu o registro" produzem a mesma fração faltante
e pedem providências completamente diferentes: uma é transferência de dado a cobrar, a outra é
falha de equipamento que provavelmente continua acontecendo. Por isso o motivo é uma **lista
fechada** — texto livre aqui vira "n/a" em um mês.

### Feixe externo e braquiterapia não têm o mesmo formato

Braquiterapia não tem feixes, unidades monitor nem gantry; tem fontes, posições e tempos de
permanência, e sua "fração" é uma inserção. Forçar as duas num registro só com `doseGy` e
`fractionNumber` produz campos vazios para metade dos casos e, pior, campos **preenchidos com o
tipo errado de número** na outra metade. São formatos separados aqui, com funções de validação
separadas.

Para braquiterapia, a intensidade da fonte é pedida porque conferir dose contra tempo de
permanência e decaimento é **a única checagem independente disponível num registro digitado**.

### Contar duas vezes

O erro provável é digitar uma fração que depois chega pela máquina. O curso conta as duas e a
dose acumulada **passa da prescrição sem nada parecer errado**.

## Edição e baixa de registros, e o log que sobrevive a elas (RTV-178)

`treatmentAudit.ts` — a contraparte do `manualTreatment.ts` (RTV-177): o que pode ser mudado
depois que um registro existe, e o que precisa continuar visível.

### Apagar nunca é apagar

Um registro de tratamento é documento clínico-legal. Removê-lo torna a dose entregue menor do
que foi, e faz isso **retroativamente e em silêncio**: o resumo do curso simplesmente mostra um
número menor, sem nada na tela indicando que já mostrou um maior. Quem agiu sobre o número
anterior — um físico aprovando um boost, um médico decidindo que a prescrição estava completa —
agiu sobre um total que não existe mais em lugar nenhum.

`retireRecord` escreve uma **lápide**. O registro fica, marcado como baixado com quem, quando e
por quê; os totais o excluem e `summariseWithAudit` **diz isso em voz alta** — excluir em
silêncio no relatório reintroduziria exatamente a falha que a lápide existe para evitar.

### Só registro manual pode ser baixado

Um registro de máquina é evidência de que o acelerador entregou algo. **Ninguém torna isso falso
apagando a linha.** Se ele está errado, é falha de equipamento ou de transferência de dado, e a
conversa começa na máquina, não no registro.

### "Editado" não é uma entrada de auditoria

Um log dizendo que o campo de dose foi editado não responde nada. A pergunta que uma auditoria
faz é **o que ele dizia antes**, porque as edições interessantes são as que mudaram um número
sobre o qual alguém já agiu. Toda alteração carrega o valor antigo e o novo lado a lado.

Alteração não pode mudar identificador nem curso — e a recusa é explícita, não silenciosa:
"lançado no curso errado" se resolve **baixando o registro e inserindo no curso certo**, para que
os dois cursos guardem o que aconteceu.

### O resumo precisa ser reconstruível num momento passado

"Quanto a dose acumulada marcava quando o boost foi aprovado?" é a pergunta, e uma tabela de
estado atual não a responde. `stateAt` reexecuta o log.

## Seleção de curso, recarga e correções de dose (RTV-180)

`courseContext.ts` — três controles de cabeçalho que parecem não ter relação e compartilham um
perigo: **cada um deles muda sobre o que os números na tela são, sem mudar como eles parecem.**

### Trocar de curso tem que limpar tudo que foi derivado do anterior

Dose acumulada, contagem de frações, DVH: calculados para o curso A e deixados na tela sob o
curso B, cada um é **um número correto sobre outro tratamento**. Nada neles parece velho — 50 Gy
de dose acumulada é plausível para qualquer um dos dois cursos.

O único desenho seguro é tratar estado derivado como pertencente **ao curso** e não à sessão. O
descarte é incondicional, porque não existe valor que possa ser inspecionado e mantido. E como o
descarte só alcança o que o contexto conhece, há uma checagem para o caso em que **um painel
guardou o próprio número** — que é exatamente onde essa falha sobrevive.

### Um paciente pode ter mais de um curso aberto ao mesmo tempo

Tratamento bilateral, ou um paliativo correndo ao lado de um curativo. "O curso ativo" não é uma
coisa só, então uma tela que escolhe o mais recente **escolhe arbitrariamente** — e arbitrário é
pior que ausente, porque parece decidido. O módulo se recusa a escolher e devolve os candidatos
com sítio e intenção, para que dê para distingui-los.

### Uma correção de dose é uma escrita manual na dose entregue

Não é uma edição de um registro entregue — aquele registro é o que a máquina reportou e fica como
está (`treatmentAudit.ts`, RTV-178). Uma correção é uma entrada **separada e atribuível** que diz
que a contabilidade estava errada, e ela muda o número que um médico usa para decidir se a
prescrição está completa.

Por isso exige: ponto de referência, valor, motivo de lista fechada, quem lançou, **quem
autorizou — e não a mesma pessoa** — e mostra o que fez ao total.

Correção sem ponto de referência é um número somado a nada em particular: **dose no ponto de
prescrição e dose num ponto de órgão de risco são grandezas diferentes**, e somar "à dose" escolhe
uma em silêncio.

No total, a correção fica **visível ao lado** do valor entregue: dobrá-la dentro dele produz um
número que ninguém consegue reconciliar contra os registros de tratamento — mesma razão pela qual
o `manualTreatment.ts` (RTV-177) reporta dose de máquina e dose digitada separadas.

### Recarregar não pode descartar trabalho em silêncio

Um descarte que **parece bem-sucedido** é como a mesma anotação acaba escrita duas vezes,
diferente.

## Planos em cache externo e limpeza do cache (`cachedPlans.ts`) — RTV-179

Inventário do cache, o que um plano bloqueado pode exibir, e a decisão de limpar com suas recusas e
seu registro de auditoria. Sem `@ohif/*`, sem relógio, sem `Date`, sem `throw` — datas são
formatadas por aritmética sobre o epoch recebido.

### Tratar cópia em cache como plano vigente

O risco central. Um plano vindo de um sistema externo é um **instantâneo**, e o plano autoritativo
pode ter sido revisado desde então. Entregar contra o instantâneo velho é entregar a distribuição de
dose errada a um paciente real, e **nada no resultado entregue pareceria errado**.

A classificação é de três vias — `verifiable-current`, `snapshot-unverified`, `known-stale` — e
falha fechada em cada degrau: sem identificação de revisão, sem verificação contra a origem,
verificação **expirada** (24 h, porque revisão de plano num ciclo de replanejamento é evento do mesmo
dia), verificação sem revisão vigente registrada, situação diferente de `APPROVED`, e relógios
divergentes (data de cache no futuro) todos resultam em não-vigente.

E o selo na tela é necessário e não suficiente: a via de entrega chama
`planCacheGuardPlanForDelivery`, que **recusa**, em vez de ler o veredicto e decidir por si.

### "Ninguém está usando" e "não consegui descobrir" são fatos diferentes

Só o primeiro permite limpar. Estado de uso desconhecido **recusa**, com código próprio. Curso em
andamento recusa. E o item que não é cópia externa recusa — com a ausência da flag lendo como *não
é cache*, porque um chamador que esqueceu a flag não ganha direito de remoção por omissão.

Quando vários bloqueios se aplicam, a recusa nomeia o **pior**.

### A confirmação está amarrada ao que foi mostrado

Confirmar um diálogo que listava 3 planos não pode limpar um 4º acrescentado entre a abertura e o
clique. A impressão digital cobre chave, paciente, curso, origem, revisão, UID, situação de
aprovação, bloqueio, último tratamento e a flag de cache — e é **ordenada**, para que um repaint que
reordene a lista não invalide a confirmação, enquanto acrescentar, remover ou revisar qualquer linha
invalide. Mesma lógica do digest de conteúdo numa assinatura.

A confirmação também expira em 5 min: longo o bastante para ler uma lista de 20 planos, curto o
bastante para que uma confirmação capturada antes de uma troca de turno não seja reexecutada pelo
operador seguinte.

### `success` nunca pode exagerar

`success` exige **todo** plano autorizado confirmado removido; um plano **não contabilizado** degrada
para `partial`; `failed` é reservado para todos confirmadamente retidos. O dano evitado: o físico lê
"cache limpo", reimporta, e trabalha com uma mistura de planos frescos e instantâneos sobreviventes
sem nada distinguindo os dois.

Detalhe fino que vale registrar: o aviso de reimportação pende de `stalePlansMayRemain`, não de
`verdict !== success` — assim um plano **não contabilizado** avisa tão alto quanto um que falhou.

### A auditoria é parte da decisão

Estruturalmente: `PlanCacheClearDecision` carrega o registro, então **não existe caminho de código —
recusa incluída — que produza uma decisão sem auditoria**. Fatos faltantes viram lacunas nomeadas em
vez de um registro ausente.

### Data ausente nunca lê como "nunca tratado"

Três estados distintos, e `never-treated` exige quem atestou; uma alegação não atestada degrada para
`unknown`. Um leitor que conclui que o curso não começou pode recomeçá-lo da primeira fração e
**dobrar a dose entregue**.

85 testes.
