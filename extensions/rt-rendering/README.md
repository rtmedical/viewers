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

## DSA — Digital Subtraction Angiography (RTV-65)

Subtracts a pre-contrast **mask** frame from every later frame, so what remains is what
changed: the contrast column in the vessels, on a flat grey background.

| Function | Purpose |
| --- | --- |
| `subtractFrame` | Element-wise difference, with gain, offset and inversion |
| `frameStats` / `subtractionWindow` | The window/level the *result* needs |
| `detectMaskFrame` | Picks a pre-contrast frame from the intensity curve |

### Two things that make a naive DSA look broken

**1. The result is signed and centred on zero.** Subtracting two similar images gives
values around 0, mostly negative where contrast darkens the pixel. Keeping the source
window/level renders a uniformly black frame, and the usual reaction is "the subtraction
did not work".

`subtractionWindow` centres on the **background** value, not on the data's midpoint:
after subtraction the vast majority of pixels *are* background, so a naive `(min+max)/2`
centre is dragged around by a handful of extreme pixels and the vessels wash out.

**2. The mask must be a pre-contrast frame.** Subtracting a frame that already contains
contrast erases the vessels instead of revealing them. `detectMaskFrame` reads the
per-frame mean intensity and takes the last frame **before** it drops — contrast is
radio-opaque, so it lowers mean intensity as it fills the field. Not simply frame 0:
runs routinely start a beat or two early, and the opening frames are the noisiest.

The drop has to clear a threshold (2% of baseline by default) to count, so ordinary
frame-to-frame noise is not mistaken for contrast arrival. When nothing clears it, frame
0 is used and the result says `reason: 'firstFrame'` so the panel can tell the reader
the mask was a guess.

### Inverted by default

Contrast *lowers* pixel values in X-ray, so the raw difference is negative in the
vessels. `invert: true` is the default because bright vessels on grey is what
angiographers expect to see.

### Not delivered

The per-frame hook into a Cornerstone3D XA/stack viewport — this is the arithmetic and
the mask logic, applied to plain typed arrays. Nothing here has been run against a real
XA run: the DEV1 PACS has no angiography.

## CPR — Curved Planar Reformation (RTV-14, RTV-61)

Produces the 3D sample positions a renderer reads voxels at, for the three CPR modes
from Kanitsar et al., *Curved Planar Reformation of CT Angiographies* (IEEE Vis 2002).
It does **not** read voxels: keeping the geometry separate from the sampling is what
lets the whole thing be tested without a volume.

| Module | Purpose |
| --- | --- |
| `centerline` | Arc-length resampling and rotation-minimising frames |
| `cpr` | The three modes, and mapping a reformation pixel back to patient space |

### Why not Frenet frames

The textbook answer for "a frame along a curve" is Frenet-Serret. It is the wrong tool
here, and using it is the classic way a CPR ends up looking broken:

- The Frenet normal is defined by the **curvature vector**. Through a straight segment
  curvature goes to zero and the normal is undefined — it spins on noise, and the
  reformation twists like a corkscrew.
- At an **inflection point** the curvature vector flips 180°, so the reformatted image
  mirrors itself mid-vessel.

Vessels are full of near-straight runs and inflections, so both happen constantly.
`rotationMinimisingFrames` uses the double-reflection method (Wang et al., *ACM TOG*
2008): each frame is transported from the previous one with the least possible rotation.
There are tests for both failure modes — no twist along a straight run, no flip through
an S-curve.

### Uniform arc length, not spline parameter

`resampleCenterline` walks the densely-sampled spline at fixed distance. Sampling the
spline in its own parameter instead gives points that bunch on tight curves and spread
on straight runs, and a CPR built on those is stretched and squashed along its length —
so a lesion length measured on it would be wrong.

### The three modes are not cosmetic variants

| Mode | What is true | What is not |
| --- | --- | --- |
| **Straightened** | Cross-sections — measure diameters here | The vessel course is destroyed |
| **Stretched** | Distance along the vessel | Cross-sections are cut obliquely, so diameters read **wide** |
| **Projected** | Spatial context | Foreshortened out of plane; neither diameters nor lengths |

Reading a diameter off a *stretched* CPR is the classic error, which is why
`CPR_MODE_CAVEATS` exists and the panel should show it next to the mode picker.

Mechanically: straightened uses each frame's own normal, so rows are perpendicular to
the vessel. Stretched and projected use a **constant** row direction — that constancy is
exactly what makes distance along the vessel meaningful and cross-sections oblique. The
modes then differ in `rowOffsetsMm`: uniform arc length for stretched, the centerline's
projection onto `up` for projected.

### Measurements can come back

`cprPixelToPatient` maps a reformation pixel to a patient-space position, which is what
an annotation on the CPR needs to be worth anything. Outside the image it returns `null`
rather than extrapolating — a point off the reformation has no defined position, and
inventing one would put an annotation somewhere plausible and wrong.

### Not delivered

The voxel sampling itself, the viewport, and centerline *extraction*. Control points
come from the caller; automatic vessel tracking (Frangi vesselness) is **RTV-62**.
Stenosis analysis along the curve, which RTV-61 also asks for, is not here either.
Nothing has been run against a real angio volume — the DEV1 PACS has no CTA.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-rendering/jest.config.js --ci
```
