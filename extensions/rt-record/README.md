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
