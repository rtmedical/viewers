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
