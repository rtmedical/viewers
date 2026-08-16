# @ohif/extension-rt-plan

Client-side **RT Plan (RTPLAN) viewer** for OHIF v3 — **RTV-132**.

Parses the RTPLAN IOD in the browser and renders a "Ficha" right panel
(plan identity, prescriptions, fraction groups, beams with MU/energy/geometry),
plus CSV export and print-to-PDF. Follows the **RTV-114** extension-first /
zero-fork policy — it does **not** modify `@ohif/core`, `@ohif/app` or `@ohif/ui`.

## Modules

| Module | Purpose |
| --- | --- |
| `rtPlanParser` (`parseRtPlan`, `buildRtPlanCsv`) | Pure, unit-tested RTPLAN IOD parser → render-ready model + CSV |
| `getSopClassHandlerModule` | Display set per RTPLAN (SOP Class `1.2.840.10008.5.1.4.1.1.481.5`), `rtPlan` parsed onto it |
| `getPanelModule` | "Ficha" right panel (tables + CSV/print); opt in via `@ohif/extension-rt-plan.panelModule.rtPlan` |

## What the parser extracts

- **Plan:** label, name, date, approval status, machine, manufacturer.
- **Prescriptions:** Dose Reference Sequence → type / structure type / description / target dose (Gy).
- **Beams:** Beam Sequence → number, name, type, radiation type, machine, nominal
  energy (labelled `6 MV` / `12 MeV`), gantry / collimator / couch angles,
  control-point / wedge / block counts; **MU (BeamMeterset)** and per-fraction
  **BeamDose** joined from the Fraction Group Sequence.
- **Totals:** Σ MU, and Σ(fractions × fraction dose) Gy.

## Scope / follow-ups

- The legacy connectviewer "Ficha" rendered a **server-computed manual MU
  recalculation** QA sheet (Sc/Sp factors, TMR/PDP, `UMcalculada`,
  `DiffUMcalculada`, acceptance criteria). That physics recompute is
  **backend-dependent** (Connect Laravel) and is **not** part of this extension.
- "Click beam → highlight beam in the 3D viewport" needs a loaded RT viewport and
  is an integration follow-up (the panel already lists beams).

## Notes

- Framework-free core; the SopClassHandler intentionally avoids importing
  `@ohif/core` (the extension's nested `@ohif/core` peer build fails to bundle
  under Cornerstone3D 5.x) and generates the display-set UID locally.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-plan/jest.config.js --ci
```

## Linhas de feixe em coordenadas do paciente (RTV-11)

`beamGeometry.ts` — o `rt-bev` trabalha **dentro** do referencial do feixe, olhando pelo eixo.
Esta é a direção oposta: onde o eixo central e as bordas do campo caem na TC do paciente, para
que um feixe possa ser desenhado num corte axial.

### Três rotações e uma troca de sistema de coordenadas, cada uma uma chance de inverter um sinal

A direção de um feixe vem do ângulo de gantry, do ângulo de mesa e da orientação do paciente,
compostos nessa estrutura e depois mapeados de IEC 61217 (sala) para coordenadas DICOM do
paciente. Cada passo é um lugar onde transpor uma matriz ou negar o eixo errado.

O que faz isso importar mais aqui que em geometria comum é **qual vista o erro sobrevive**. Com
a ordem de composição errada, um feixe anterior continua parecendo anterior no corte axial: o
erro só aparece em gantry oblíquo ou com mesa girada, **e o feixe AP é o primeiro que um revisor
confere.** Um viewer que desenha feixes convincentemente para o plano comum e errado para o
oblíquo é pior que um que não desenha nada.

### Orientação do paciente não é cosmética

Head-first e feet-first trocam a esquerda do paciente pela esquerda da sala. A orientação é
**entrada obrigatória**, não default, porque a falha que ela evita é esquerda-por-direita — a
classe de erro que chega no paciente.

### O ângulo de mesa é o caminho pouco exercitado

A maioria dos planos tem mesa zero, então o código que trata mesa diferente de zero roda numa
minoria pequena e um bug nele vai para produção. O invariante que vale testar é que **girar a
mesa não move um feixe de gantry zero** — uma rotação em torno do eixo vertical não pode mudar
um feixe vertical.

### As bordas do campo divergem

Mandíbulas são definidas no plano do isocentro. Desenhar o mesmo retângulo num corte a dez
centímetros do isocentro, com DFE de um metro, erra por dez por cento — e erra de um jeito que
**parece um campo um pouco generoso, não um bug**.

### Paralelo não é "no isocentro"

Um feixe lateral corre paralelo ao corte axial e não o atravessa. Devolver o isocentro ali
desenharia um ponto que não significa nada, então o módulo distingue "cruza aqui" de "corre ao
longo deste plano".
