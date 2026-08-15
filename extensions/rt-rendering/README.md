# @ohif/extension-rt-rendering

Advanced rendering for OHIF v3. First feature: **SSD — Surface Shaded Display**
(**RTV-17**).

Follows the **RTV-114** extension-first / zero-fork policy.

## What this does *not* contain

Marching cubes and an STL writer. vtk.js ships **`vtkImageMarchingCubes`** and
**`STLWriter`**, both already bundled — writing either again would be strictly worse.

What was missing, and what lives here:

| Module | Purpose |
| --- | --- |
| `ssdPresets` | The clinical part: which threshold, in what colour |
| `ssdBudget` | The pre-flight that keeps a routine CT from locking the tab |
| `getCommandsModule` | `rtSsdApplyPreset`, `rtSsdSetThreshold`, `rtSsdSetColor`, `rtSsdSetOpacity`, `rtSsdPlan`, `rtSsdExtract`, `rtSsdExportStl`, `rtSsdClear` |

## The threshold is the clinical decision

Not the rendering. 300 HU gives cortical bone; 100 HU pulls in trabecular bone and
calcified plaque; −300 HU sits in the fat/air gap that makes a clean skin envelope;
−700 HU is inside lung parenchyma.

| Preset | HU | |
| --- | --- | --- |
| Cortical bone | 300 | the cleanest skeletal surface |
| Trabecular bone | 100 | includes calcified plaque; noisier |
| Skin surface | −300 | patient outline, for setup checks |
| Lung | −700 | semi-transparent, so vessels stay visible |
| Contrast vessels | 150 | depends on the injection protocol |

These are conventional starting points, not tuned numbers — the slider stays. Dragging
it onto a preset value **snaps the picker back to that preset**, so it does not keep
saying "custom" at exactly 300 HU.

## The pre-flight is the real engineering

The acceptance criterion is "SSD de CT skull renderiza em <10s". Marching cubes is
O(voxels), and 512 × 512 × 400 is **105 million voxels**. Unthrottled that does not
take ten seconds — it locks the tab long enough that the reader reloads the page.

`planSsdExtraction` answers, before anything runs:

- **How many voxels**, and what integer stride brings that under budget. Striding by
  `s` divides the count by `s³`, so stride 2 is already an 8× cut. Capped at 4 —
  past that the surface is blocky enough to mislead, and refusing beats rendering a lie.
- **Roughly how many triangles** come out (~N^⅔ × a shape factor). Deliberately rough:
  the point is distinguishing "a moment" from "a hang", not predicting milliseconds.
- **Whether the volume makes sense to threshold at all.** A Hounsfield threshold is
  only defined on CT. Applying 300 HU to an MR volume is not a worse surface, it is a
  **meaningless** one — the numbers are arbitrary signal intensities — so that is
  called out rather than silently rendered.
- **Whether the slices are anisotropic.** A 5 mm slice CT makes a visibly stepped
  surface, and readers blame the renderer rather than the acquisition.

Errors block; warnings inform. `rtSsdPlan` is cheap, so a panel can call it on every
threshold change to keep the estimate live.

## Scope / follow-ups

- **The viewport actor path is duck-typed and unverified.** `addSurfaceToViewport`
  goes through `viewport.createActorFromPolyData` / `addActor` without importing
  `@cornerstonejs/core`, and returns `false` when the viewport cannot take an actor —
  in which case the command reports that instead of pretending the surface is on
  screen. Whether Cornerstone3D's volume viewport exposes exactly that pair on this
  version has **not** been confirmed against a running viewer.
- **RTV-16 (VIP)** belongs in this package and is not implemented.
- **Not validated in a browser.** The DEV1 box has no memory headroom to build and
  serve the viewer (see `docker/README.md`). The evidence is the unit tests: presets,
  colour parsing, budget arithmetic and the pre-flight rules.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-rendering/jest.config.js --ci
```
