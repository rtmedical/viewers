# @ohif/extension-rt-fusion

Image-**fusion UI** for OHIF v3 — **RTV-197**. A fusion config model (fixed/moving
layers, opacity, blend mode, colormap, inversion) + a config panel with a live
CSS-blended preview. Follows **RTV-114** (extension-first / zero fork).

## Modules

| Module | Purpose |
| --- | --- |
| `fusionConfig` (`defaultFusionConfig`, `normalizeFusionConfig`, `buildLayerStyle`, `isFusable`, `BLEND_MODES`, `FUSION_COLORMAPS`) | Pure, unit-tested fusion config + normalization + CSS-style mapping |
| `getPanelModule` | Fusion panel (layers / opacity / blend / colormap / invert + blended preview); opt in via `@ohif/extension-rt-fusion.panelModule.fusion` |

## Coverage / scope

- ✅ Fusion config UI: pick fixed/moving image layers, **opacity** slider,
  **blend mode** (normal/multiply/screen/overlay), **colormap** + invert, with a
  live CSS-blended preview and an "is fusable" guard.
- 🟡 **Compositing the moving layer onto the fixed layer in the cornerstone
  viewport** (applying opacity/blend + the colormap LUT from
  `@ohif/extension-rt-isodose`) is a viewport integration follow-up.

> Colormap names mirror `@ohif/extension-rt-isodose` (the LUT generator lives
> there); duplicated as a small constant to avoid a cross-extension import.

> Verification: pure config core unit-tested; full app bundle builds clean
> (rspack). Viewport compositing is not part of this slice (not E2E-verified).

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-fusion/jest.config.js --ci
```
