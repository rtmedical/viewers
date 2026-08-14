# @ohif/extension-rt-bev

Beam's Eye View for OHIF v3 — the MLC/jaw aperture over an RTIMAGE (DRR), the MLC
cine (**RTV-139**), and the millimetre graticule (**RTV-143**).

Follows the **RTV-114** extension-first / zero-fork policy. Every core module is
pure and framework-free; only the overlay renderers touch the DOM.

## Modules

| Module | Purpose |
| --- | --- |
| `rtBevParser` (`parseRtPlanBev`, `parseRtImageBevGeometry`, `referencedBeamNumber`) | RTPLAN → beams/control points, and RTIMAGE instance → geometry |
| `bevGeometry` (`isocenterMmToImagePx`, `rotateAboutDeg`, `buildAffine2D`, `leafApertureRects`) | Isocenter mm → RTIMAGE px (with SID/SAD magnification), rotation about the beam axis, per-leaf aperture rectangles |
| `bevOverlay` (`attachBevOverlay`, `renderBev`, `detachBevOverlay`) | The SVG aperture overlay on a stack viewport |
| `mlcCine` | Control-point cine state (FPS clamp, frame stepping) — RTV-139 |
| `drrGraticule` (`buildDrrGraticule`, `buildGraticuleSvgDocument`, `mountGraticule`) | The graticule — RTV-143 |
| `getCommandsModule` | `showBev`, `hideBev`, `toggleBev`, `setBevControlPoint`, `showMlcCine`, `toggleDrrGraticule`, `setDrrGraticuleSpacing`, `refreshDrrGraticule` |
| `getPanelModule` | BEV panel; opt in via `@ohif/extension-rt-bev.panelModule.bev` |

## The graticule (RTV-143)

The reticle a physicist reads a DRR against: a crosshair on the beam axis plus tick
marks every N millimetres **at the isocenter plane**, so distances on the DRR are
judged directly in patient millimetres.

It is built on what this package already had — `isocenterMmToImagePx` (including the
SID/SAD magnification that matters on detector-plane RTIMAGEs) and `rotateAboutDeg`.
Nothing about the projection was reimplemented.

### It rotates with the collimator, not the gantry

The graticule is fixed to the **beam-limiting device**, so
`BeamLimitingDeviceAngle` (300A,0120) rotates it. Gantry angle does not: a DRR is
already rendered along the beam axis, so changing the gantry changes *which*
projection you are looking at, not the reticle's orientation within it. The gantry
angle is still reported in the toast, because it tells the reader which beam they
are on.

Following the note in `rotateAboutDeg`, rotation happens in **mm space, before**
projecting. That stays correct for non-square `ImagePlanePixelSpacing`, where
rotation and anisotropic scaling do not commute.

### It refuses to guess

`buildDrrGraticule` returns `null` when the RTIMAGE has no usable geometry, and the
toggle reports that instead of drawing. A reticle on guessed geometry would put
confident millimetre labels on the wrong pixels — worse than no reticle. The toggle
also leaves itself **off** when it could not draw, so the next click tries to turn on
again rather than "turning off" something that never appeared.

### Verified against a real DRR

`drrGraticule.test.ts` runs against the Eclipse fixture (512×512,
`RTImagePosition [-249.51171875, 249.51171875]`, spacing 0.9765625 mm,
SID = SAD = 1000). That geometry puts the beam axis at pixel (255.5, 255.5) — dead
centre — and makes 10 mm exactly 10.24 px, so the assertions are checkable by hand.

## A note on `graticuleCommands.test.ts`

Those tests exist because of a real bug. The first version of the graticule wiring
used `parseRtImageBevGeometry` **without importing it**. All 31 geometry tests
passed, because none of them executed the render path — the `ReferenceError` would
have surfaced only in the browser, on the first click. The command tests drive
`toggleDrrGraticule` end to end against a fake viewport, so a missing binding fails
in CI instead. Removing the import again makes them fail with
`ReferenceError: parseRtImageBevGeometry is not defined` — that was checked, not
assumed.

## Scope / follow-ups

- **`refreshDrrGraticule` is not subscribed to anything.** Scrolling to a different
  RTIMAGE or changing the control point should redraw; the command is idempotent and
  cheap, but the cornerstone event subscriptions are not registered here.
- **Editing the aperture is not implemented.** RTV-143 also asks for shape editing on
  `DrawBlockAndMlcTool`. This package *displays* the aperture from the RTPLAN;
  editing it means writing back to the plan, which is a different (and much larger)
  piece of work.
- **The graticule is not validated in a browser.** The DEV1 box has no memory
  headroom to build and serve the viewer (see `docker/README.md`). The evidence is
  the unit tests against the real fixture geometry — not how the reticle looks over a
  rendered DRR.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-bev/jest.config.js --ci
```
