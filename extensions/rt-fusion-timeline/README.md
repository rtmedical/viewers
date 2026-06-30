# @ohif/extension-rt-fusion-timeline

**Fusion Timeline** for OHIF v3 — **RTV-135**. Registration displacement over the
course as an SVG chart + table. Follows **RTV-114** (extension-first / zero fork).

## Modules

| Module | Purpose |
| --- | --- |
| `fusionTimeline` (`parseRegistrationTranslation`, `translationMagnitude`, `buildFusionTimeline`, `buildFusionChart`) | Pure, unit-tested: matrix→translation, displacement magnitude, timeline + summary, SVG chart geometry |
| `getPanelModule` | Fusion Timeline panel (X/Y/Z/|d| chart + table); opt in via `@ohif/extension-rt-fusion-timeline.panelModule.fusionTimeline` |

## Coverage / scope

- ✅ Displacement model + summary (max/mean |d|) + SVG line chart (X/Y/Z/magnitude)
  in the same style as `@ohif/extension-rt-dvh`'s chart.
- ✅ Points parsed from loaded **Spatial Registration (REG)** objects
  (`RegistrationSequence → MatrixRegistrationSequence → FrameOfReferenceTransformationMatrix`).
- 🟡 The legacy **per-fraction displacement history** (fusion store) is a
  **backend follow-up**; the panel shows a clear empty state when no REG objects
  are loaded.

> Verification: pure model/chart core unit-tested; full app bundle builds clean
> (rspack). Not E2E-verified.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-fusion-timeline/jest.config.js --ci
```
