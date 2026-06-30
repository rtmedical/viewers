# @ohif/extension-measurements

**Advanced measurement calculators** for OHIF v3 — epic **RTV-27**. Pure,
unit-tested formulas exposed as commands + a status panel. Follows **RTV-114**
(extension-first / zero fork).

| Ticket | Calculator | Function |
| --- | --- | --- |
| **RTV-28** | HU statistics (CT ROI) | `huStats(values)` → min/max/mean/SD |
| **RTV-29** | PET SUVbw | `parseRadiopharmaceutical`, `suvBwFactor` (decay-corrected), `convertToSuvBw`, `suvStats` |
| **RTV-30** | Cobb angle | `cobbAngle(line1, line2)` → acute angle 0–90° |
| **RTV-46** | Agatston calcium score | `agatstonWeight(maxHu)`, `agatstonScore(lesions)` → Σ(area × weight) |

## Modules

- `measurements` — the pure calculators (above).
- `getCommandsModule` — `computeHuStats` / `computeCobbAngle` / `computeAgatston` / `computeSuvBw`.
- `getPanelModule` — Advanced Measurements status panel; opt in via
  `@ohif/extension-measurements.panelModule.measurements`.

## Scope

- ✅ Pure formulas + commands + panel (fully unit-tested).
- 🟡 **Capturing the ROI pixels / line annotations / lesion masks from the
  cornerstone viewport** to feed the calculators is an integration follow-up — the
  formulas are the layer the viewport would call.

> Verification: pure calculators fully unit-tested; full app bundle builds clean
> (rspack). Viewport ROI capture not part of this slice (not E2E-verified).

## Tests

```bash
node node_modules/.bin/jest --config extensions/measurements/jest.config.js --ci
```
