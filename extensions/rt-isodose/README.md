# @ohif/extension-rt-isodose

**Isodoses + dose color maps** for OHIF v3 — **RTV-137**. Pure dose-heat
colormaps and isodose levels (as a % of prescription) plus a config panel.
Follows **RTV-114** (extension-first / zero fork).

## Modules

| Module | Purpose |
| --- | --- |
| `isodose` (`colormapColor`, `buildColormap`, `mapDoseToColor`, `buildIsodoseLevels`, `rgbToHex`) | Pure, unit-tested dose colormaps (hot/jet/grayscale/rainbow) + isodose levels |
| `getPanelModule` | Isodoses panel (colormap + gradient + levels); opt in via `@ohif/extension-rt-isodose.panelModule.isodose` |

## Coverage / scope

- ✅ Dose color maps (hot / jet / grayscale / rainbow) with LUT generation.
- ✅ Isodose levels as % of prescription, with absolute Gy when an RTPLAN
  prescription is loaded (read from `rtPlan` of `@ohif/extension-rt-plan`) or
  entered manually; color per level + gradient bar.
- 🟡 **Drawing the isodose lines / dose-wash on the viewport** from the RTDOSE
  grid is a cornerstone-viewport integration follow-up (this is the color/level
  data layer + config panel).

> Verification: pure colormap/level core unit-tested; full app bundle builds
> clean (rspack). Viewport overlay rendering is not part of this slice / not
> E2E-verified.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-isodose/jest.config.js --ci
```
