# @ohif/extension-rt-timeline

**RT Summary / Course Timeline** for OHIF v3 — epic **RTV-162**. Delivers the
CourseTimelinePanel (**RTV-164**) hosting the **prescription** (**RTV-165**) and
**treatment** (**RTV-166**) sub-timelines. Follows **RTV-114** (extension-first /
zero fork).

## Design (panel-only, no cross-extension imports)

The panel reads the **already-parsed** models that the sibling extensions attach
to their display sets:
- `rtPlan` from `@ohif/extension-rt-plan` (RTV-132) → prescription timeline.
- `rtRecord` from `@ohif/extension-rt-record` (RTV-163) → treatment timeline.

These are consumed via **duck-typed** interfaces (`RtPlanLike` / `RtRecordLike`),
so there is **no cross-extension import** — the timeline transform is pure and
unit-tested in isolation.

## Modules

| Module | Purpose |
| --- | --- |
| `courseTimeline` (`buildPrescriptionTimeline`, `buildTreatmentTimeline`, `buildCourseTimeline`) | Pure, unit-tested timeline transforms + course summary |
| `getPanelModule` | CourseTimelinePanel; opt in via `@ohif/extension-rt-timeline.panelModule.courseTimeline` |

## Coverage

- ✅ **RTV-165** prescription timeline: per plan fraction group — fractions,
  dose/fraction, total dose, dominant energy + technique (BeamType).
- ✅ **RTV-166** treatment timeline: per record, chronological — date, fraction,
  beams, delivered MU; course summary (Σ MU, date span).
- 🟡 **RTV-164** CourseTimelinePanel: the host panel + these two sub-timelines are
  in place. The remaining sub-timelines — imaging (RTV-167), overrides (RTV-168),
  trends (RTV-169) — and the detail panels / controls (RTV-170…180) are
  follow-ups, several of which need data not present in the standard RT objects
  (e.g. per-image stats, patient weight trends) → backend/extra-object dependent.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-timeline/jest.config.js --ci
```

## Tendências do curso: peso e DFS (RTV-169)

`trendsTimeline.ts` — o `courseTimeline.ts` põe os eventos de um curso num eixo. Esta é a
outra espécie de linha do tempo: dois números medidos repetidamente, cujo **formato** é o
achado.

### Isto é um gatilho de replanejamento, não um gráfico de bem-estar

Um paciente de cabeça e pescoço perdendo peso ao longo da quimiorradiação não é uma nota
nutricional à margem do registro. O contorno externo muda, a distância foco-superfície muda
junto, a região de build-up se desloca, e **a distribuição sendo entregue deixa de ser a que foi
planejada e aprovada**. Perto de 5% de perda em relação ao peso de planejamento é o ponto
convencional em que essa pergunta precisa ser feita em voz alta.

A projeção para o fim do curso vale mais que a perda atual: o momento útil de levantar o
replanejamento é **antes** de o limiar ser cruzado, não na fração em que ele é.

### DFS é a evidência mais direta, e é mais ruidosa

Peso é um proxy de corpo inteiro. Um paciente pode perder dez por cento com DFS inalterada
sobre o volume tratado, ou perder dois por cento e mostrar grande variação de DFS conforme um
edema se resolve. A DFS é medida por feixe na posição de tratamento, então fala da geometria
que de fato importa — e carrega variação diária de setup por cima, o que significa que **uma
leitura isolada não diz quase nada.**

A separação é a mesma que o `setupStatistics.ts` (RTV-208) faz para correções de mesa, e pelo
mesmo motivo: **desvio sustentado é mudança anatômica, dispersão é setup.** Reportar um desvio
padrão sobre os dois é o erro — um paciente com 8 mm de dispersão e nenhuma deriva e outro com
8 mm de deriva e nenhuma dispersão produzem números parecidos, e só um deles precisa de plano
novo.

A deriva sai **do ajuste**, não da última amostra: a amostra carrega o erro de setup daquele
dia e o ajuste não.

### Um intervalo sem medida não é uma linha plana

A falha específica de um gráfico de tendência. Se ninguém pesou o paciente por três semanas, a
linha entre os dois pontos é desenhada assim mesmo, e se lê como três semanas de estabilidade —
que é exatamente o período em que a perda aconteceu.

### A linha de base é o valor de planejamento

Não o primeiro registrado. Se o primeiro peso no sistema é de uma semana depois do início, a
perda medida a partir dele é **a perda que aconteceu depois que a perda começou**.

## Linha do tempo de imagem: os sete tipos (RTV-167)

`imagingTimeline.ts` — um curso gera imagens de verificação de naturezas muito diferentes, e o
registro as mostra lado a lado. Errar o tipo não é cosmético: muda **o que a imagem significa,
o que pode ser medido nela, e se a dose dela pertence ao tratamento ou à carga de imagem do
paciente**.

### Classificar por atributos, nunca pela descrição da série

`SeriesDescription` é digitada por quem montou o protocolo. Um serviço que chama seu protocolo
de feixe cônico de "CBCT Pelve" e outro que chama de "Volume View" produzem as mesmas imagens, e
um classificador que olha a string acha um e perde o outro. Pior: um par kV descrito como "CBCT
setup" é arquivado como feixe cônico, e a linha do tempo passa a reportar **uma aquisição
volumétrica que não houve**.

A descrição é usada só para exibir. Quando os atributos não decidem, a resposta é `unknown` — e
**`unknown` é uma resposta legítima**: encaixar uma série não classificável no balde mais comum
a esconde num lugar plausível, onde ninguém vai procurá-la de novo.

### kV e MV não são dois ajustes da mesma coisa

Uma imagem portal MV é feita **com o feixe de tratamento**: energia terapêutica, no eixo do
feixe, dentro do alvo — é parte do tratamento, e em alguns protocolos é contabilizada no plano.
Uma imagem kV é dose de imagem, de um tubo separado, em outro ângulo, e pertence à carga de
imagem. Somar as duas produz um número que não descreve nenhuma.

### Imagem de dose portal é um mapa dosimétrico, não uma figura

Ela carrega unidades de dose. Janelá-la como imagem anatômica e ler anatomia dela é erro de
categoria — e o resultado **parece apenas uma imagem portal mal janelada**.

### Um par ortogonal é um evento

Duas imagens ortogonais adquiridas com segundos de diferença são uma única verificação de setup.
Listá-las separadamente dobra a frequência aparente de imagem e corrompe em silêncio toda
estatística por fração construída sobre a linha do tempo.

### Imagem de simulação não faz parte do curso

Pertence ao planejamento. Colocada no eixo de tratamento na data em que foi adquirida, faz o
curso **parecer ter começado semanas antes da primeira fração**, e toda duração lida do gráfico
fica errada.

## Estatísticas da sessão e sub-timeline (RTV-171)

`sessionStats.ts` — a sub-timeline sob uma sessão de tratamento: todos os eventos de imagem e
entrega daquela sessão, em ordem, com a contagem que fica acima dela.

### "Passou", "revisado" e "aprovado" são três afirmações diferentes

São rotineiramente somadas num número só, e o número então não responde nada. Um teste de
tolerância passando é **o software dizendo** que o desvio foi pequeno. Revisado é **uma pessoa
ter olhado**. Aprovado é **uma pessoa ter autorizado**. Um painel marcando "8 pass" numa sessão
em que ninguém abriu uma única imagem é tecnicamente correto e completamente enganoso — e é o
que sai naturalmente de uma contagem de `status === 'ok'`.

`STATUS_KIND` separa o que a máquina afirmou do que uma pessoa afirmou, e as duas contagens
saem lado a lado, nunca somadas. Quando não houve nenhuma verificação humana, o resumo diz isso:
**o que passou, passou no software.**

### Exceção sem nome não é exceção

Aceitar algo fora da tolerância é ato clínico legítimo, e a única coisa que o torna prestável é
**quem**. Uma linha de override com atribuição vazia é uma exceção que ninguém assume — que é
justamente o estado que um programa de QA existe para evitar. É recusada.

### Sessão é um intervalo de tempo, não uma data

Agrupar por dia do calendário erra os dois casos comuns: hiperfracionamento duas vezes ao dia
vira uma sessão que **parece ter durado oito horas**, e uma sessão noturna cruzando a meia-noite
vira duas, a segunda das quais **parece um tratamento sem imagem de setup**.

### Empate de horário: imagem primeiro

Registros de tratamento costumam ter precisão de minuto, então a imagem de setup e o feixe que
veio depois caem no mesmo instante. Ordenar só por tempo às vezes põe o feixe primeiro, e uma
sub-timeline mostrando o feixe antes da imagem que o autorizou **diz que o terapeuta tratou e
depois imageou**. Ninguém lê isso como artefato de renderização.

### Contagens, não porcentagens

Uma sessão tem um punhado de eventos, e uma taxa sobre três deles é um número com intervalo de
confiança mais largo que ele mesmo. Taxas pertencem ao curso, não à sessão.

## Detalhes da imagem e troca para Revisão Offline (`imageDetails.ts`) — RTV-172

Quais linhas de metadado mostrar e como apresentá-las, navegação entre eventos de imagem, e as
precondições da troca para o workspace de Revisão Offline. Sem `@ohif/*`, sem Cornerstone, sem
relógio, sem `throw`.

### A imagem atribuída à fração errada

O trabalho deste painel é deixar um físico olhar *a imagem de uma sessão específica*. Se a
associação a uma fração é ambígua, `imgResolveSession` **recusa** em vez de escolher: referência que
não existe, referência que casa com duas sessões, referência que **contradiz o horário de
aquisição**, horário entre duas sessões, horário dentro de duas sessões sobrepostas, aquisição sem
horário, sessão de outro paciente.

O dano nomeado: um físico revisando o que o painel rotula "fração 12" enquanto olha a imagem da
fração 11, vendo posicionamento correto, e aprovando um curso em que a fração 12 teve um erro de
setup não corrigido.

Detalhe que merece atenção: a **tolerância em torno da janela da sessão é zero por padrão**. Imagem
de setup normalmente acontece minutos antes do beam-on, então instalações cujas janelas não cobrem o
setup precisam passar tolerância explícita. Não foi defaultada para "alguns minutos" de propósito —
uma tolerância silenciosa é exatamente como uma imagem feita pouco antes da sessão N+1 é atribuída à
sessão N.

### Ausente, zero e não aplicável são três estados, e nenhum é um traço

Um kV/mAs/SID faltante renderizado como `0`, `-` ou célula vazia lê como *medido e zero* ou *não se
aplica*. **Um traço numa coluna de dose é lido como "não aplicável" por metade dos leitores e como
"zero" pela outra metade.** Cada linha carrega seu estado, e há três strings que não se confundem
entre si nem com uma medida.

### A ideia mais afiada do módulo: o valor numérico só existe se a unidade foi declarada

`numericValue` é populado **apenas** quando `unitState === 'declared'` e `state === 'present'`. Então
qualquer coisa que leia esse campo — tendência entre frações, comparação, exportação — **não tem como
pegar um número de escala desconhecida**. "Temos 100 e ninguém disse se é mm ou cm" não é valor
presente nem ausente: é um valor que nunca deve ser comparado com o de outra fração.

O estado da unidade tem cinco valores: declarada, não declarada, não reconhecida, **incompatível**
(dimensão errada) e não aplicável.

### Navegação que não pula e não dá a volta

As setas navegam a lista **filtrada**, e o escopo é dito em palavras ao lado delas — sem isso um
físico que deixou um filtro de modalidade ligado acredita que "próxima imagem" percorre o curso
inteiro e relata ter revisado imagens que nunca apareceram. Nas pontas, **recusa em vez de dar a
volta**: dar a volta da última para a primeira, com o usuário olhando a imagem e não o contador, faz
ele re-revisar o começo acreditando que é o fim.

### Prévia e metadados têm de ser do mesmo instante

Prévia de cache ao lado de números de uma aquisição mais nova é uma resposta errada com aparência de
confiança — o físico confere a imagem contra o kV/mAs e a geometria mostrados ao lado e aprova um par
que **nunca existiu junto**. O emparelhamento exige mesmo UID e mesma revisão, e há recusa para
prévia velha, metadado velho, prévia além da idade máxima e prévia renderizada no futuro.

### A troca de workspace carrega o que está sendo revisado

Os quatro campos de identidade são obrigatórios; não existe caminho "o workspace descobre". Contexto
incompleto, paciente do contexto diferente do paciente do evento, sessão que não é a resolvida, sessão
**nunca resolvida**, e prévia nunca emparelhada são recusas.

E uma fração **inferida por horário** exige reconhecimento humano explícito antes da troca.

Revisão pendente não é recusa nem descarte silencioso: volta como status próprio com
`committed: false`, que a UI tem de resolver — senão uma nota de aprovação meio escrita para uma
fração com erro de setup desaparece numa troca de tela.

99 testes.
