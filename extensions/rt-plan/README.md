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
