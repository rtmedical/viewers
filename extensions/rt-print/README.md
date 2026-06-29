# @ohif/extension-rt-print

**RT Print** panel for OHIF v3 — **RTV-140**. Configurable print layout
(A3/A4/A5 × portrait/landscape × 1×1 / 2×2 / 3×3 grid, padding/gap), live
preview, and print (Save-as-PDF for PDF export). Follows **RTV-114**
(extension-first / zero fork).

## Modules

| Module | Purpose |
| --- | --- |
| `printLayout` (`computePrintLayout`, `zoneCount`, `PAPER_SIZES_MM`, `GRID_PRESETS`) | Pure, unit-tested layout geometry (paper dims + grid-zone rectangles in mm) |
| `getCommandsModule` | `computeRtPrintLayout`, `rtPrint` (framework-free) |
| `getPanelModule` | RtPrintPanel — config + scaled preview + print; opt in via `@ohif/extension-rt-print.panelModule.rtPrint` |

## Coverage

- ✅ Panel with full config (paper / orientation / grid / padding / gap).
- ✅ Preview before print (scaled zone layout).
- ✅ Grid zones 1×1 / 2×2 / 3×3.
- ✅ Export as PDF via the browser print dialog (Save as PDF).
- 🟡 **Populating zones with live viewport screenshots / embedded DVH / RTPlan**
  is a cornerstone-viewport integration follow-up (needs screenshot capture from
  the viewports) — the layout/preview/print scaffolding is in place.

> Verification: the pure layout core + commands are unit-tested; the full app
> bundle builds clean (rspack). Interactive panel behaviour (print rendering) is
> not E2E-verified here — it follows the same proven panel pattern as the other
> `@rt/extension-*`.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-print/jest.config.js --ci
```
