# @ohif/extension-rt-dvh

Client-side **DVH (Dose Volume Histogram) viewer** for OHIF v3 — **RTV-131**.

Renders dose×volume curves per structure from an RTDOSE's embedded DVH, with a
per-structure legend (Dmean/Dmax) and CSV/SVG export. Follows **RTV-114**
(extension-first / zero fork of `@ohif/core`, `@ohif/app`, `@ohif/ui`).

## Architecture note (important)

DICOM has **no separate "DVH SOP class"** — the DVH is stored inside the
**RTDOSE** object (`1.2.840.10008.5.1.4.1.1.481.2`) under `DVHSequence`. So this
extension **does not** register a SopClassHandler (that would duplicate the
dose-grid display set the cornerstone extension already creates). Instead the
panel reads existing RTDOSE display sets and parses their embedded DVH; structure
names are resolved from a loaded RTSTRUCT (`StructureSetROISequence`).

## Modules

| Module | Purpose |
| --- | --- |
| `dvhParser` (`parseDvhFromInstance`, `buildRoiNameMap`, `buildDvhCsv`, `volumePercentAtDose`, `doseAtVolumePercent`) | Pure, unit-tested DVH extraction + Dx/Vx metrics + CSV |
| `dvhChart` (`buildDvhChart`) | Pure SVG chart geometry (no chart lib) |
| `getPanelModule` | DVH chart panel; opt in via `@ohif/extension-rt-dvh.panelModule.dvh` |

## Acceptance coverage

- ✅ DVH loaded from RTDOSE; one curve per structure (named via RTSTRUCT).
- ✅ Dose axis in Gy; volume axis in % (cumulative).
- ✅ Export CSV; export SVG (vector). Raster **PNG** export is a follow-up
  (serialize SVG → canvas).
- ✅ `volumePercentAtDose` / `doseAtVolumePercent` for V_x / D_x metrics; legend
  shows Dmean/Dmax. Interactive hover tooltips are a UI follow-up.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-dvh/jest.config.js --ci
```
