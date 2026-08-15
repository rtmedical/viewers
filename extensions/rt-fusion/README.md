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

## The seven fusion tools (RTV-136)

Migration of the connectviewer `FusionTools`. They fall into two families, and the split
is what makes them testable:

| Family | Tools | What they decide |
| --- | --- | --- |
| **Reveal** | Split window, Chess window, Moving window | *Where* the moving image shows through the fixed one — pure geometry, rectangles out |
| **Transform** | Pan, Zoom, Window/level, Region window/level | *How* the moving layer is drawn — pure arithmetic on a small state object |

The renderer turns the rectangles into a clip path (`regionsToClipPath`); nothing in this
module knows about canvases.

### Every tool touches the moving layer only

Panning the *fixed* image would silently destroy the registration the reader is
checking. That is the one thing a fusion tool must never do, and it is why the transform
state is explicitly named `MovingLayerTransform`.

### Details that decide whether they feel right

**The split position is a fraction, not pixels.** The divider survives a resize;
storing pixels means the split jumps whenever the panel layout changes.

**Zoom anchors on the cursor, not the viewport centre.** Anchoring at the centre makes
the reader chase the anatomy with pan after every wheel click.

**The lens is clamped inside the viewport.** Half a lens hanging over the border reads
as a rendering bug, and the reader loses the reference frame that makes the comparison
work.

**Region window/level leaves the display alone for a flat region.** Dragging over
background should not blank the image, and a flat region would otherwise produce a
zero-width window.

**A degenerate reveal region is dropped, not emitted.** Some clip implementations render
a zero-size rect as "everything", which would flip the fusion inside out at the end of
the divider's travel.

**Window width is floored at 1.** Zero width divides by zero in every renderer
downstream.

### Not delivered

The Cornerstone3D tool classes that turn pointer events into these calls, and the actual
compositing of the moving layer under a clip path. This is the geometry and the
arithmetic; the viewport integration is the follow-up the package README already flags
for the colormap LUT. Nothing here has been seen in a browser.
