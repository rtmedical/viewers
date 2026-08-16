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
