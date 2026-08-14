# @ohif/extension-rt-mr-quant

MR-quantitative display for OHIF v3 — **RTV-83** (Dixon fat/water) and **RTV-82**
(parametric maps).

Follows the **RTV-114** extension-first / zero-fork policy: it does **not** modify
`@ohif/core`, `@ohif/app`, `@ohif/ui` or `@ohif/extension-cornerstone`. The colour
ramps in particular are handed to Cornerstone3D as colormap *presets* rather than
being appended to `extensions/cornerstone/src/utils/colormaps.js`, which is a
fork-forbidden package.

## Modules

| Module | Purpose |
| --- | --- |
| `dixon` (`classifyDixonSeries`, `detectDixonSet`) | Pure, unit-tested detection of the fat / water / in-phase / out-of-phase reconstructions of a Dixon acquisition |
| `parametricLut` (`lutColor`, `buildLut`, `toColormapPreset`) | Perceptually-uniform colour ramps + the `RGBPoints` preset shape the cornerstone colorbar consumes |
| `parametricRange` (`normalizeValue`, `rangeToWindow`, `mapValueToRgba`) | Display range, the window/level equivalence, transparency threshold and unit-aware formatting |
| `getHangingProtocolModule` | Registers the `rt-mr-dixon-2x2` protocol |
| `getPanelModule` | "Parametric map" right panel; opt in via `@ohif/extension-rt-mr-quant.panelModule.parametricMap` |
| `getCommandsModule` | `rtApplyParametricMap`, `rtDetectDixon` |

## RTV-83 — Dixon fat/water

A Dixon acquisition arrives as up to four reconstructions of the same anatomy.
The reader compares them slice by slice, so they are hung 2×2 — **water and fat
on top** (the separation that carries the diagnosis), **in/out-phase below** (the
source pair) — with `stack` and `voi` sync groups on every viewport, so scrolling
or windowing any one moves all four.

### How detection avoids the two traps

There is no DICOM tag that says "this is the fat image", so the detector reads
ImageType (0008,0008) first and SeriesDescription second, always on **whole
tokens** — never substrings, so `WATERFALL` and `OUTER` cannot match. Two traps
are worth naming, because a naive implementation falls into both:

1. **Fat-saturation is not fat-only — it is the opposite.** `T2 TSE FS`,
   `STIR fatsat`, `SPAIR` and `CHESS` suppress fat; classifying them as the Dixon
   `fat` reconstruction would put a suppressed image where the reader expects a
   fat map. Those tokens veto a fat match, across both fields.
2. **`W` and `F` are usually weighting, not water and fat.** `T2 W` and `T1_W`
   tokenise to a bare `W`. The ambiguous abbreviations (`W`, `F`, `IP`, `OP`,
   `OPP`) only count when the series also names the technique — `DIXON`,
   `mDIXON`, `IDEAL`, `FLEX`, `LAVAFLEX` — which is what real vendor strings do
   (`mDIXON W`, `IDEAL IP`).

The hanging protocol's declarative `containsAnyOf` rules **cannot** express those
guards (a constraint cannot also require a technique marker), so the protocol
deliberately matches only the unambiguous spellings, and gives the fat selector a
negative-weight rule on the suppression tokens. Studies labelled only with
abbreviations will not auto-hang; `detectDixonSet` still finds them for the panel
and a manual layout. That asymmetry is intentional — the alternative is a
protocol that hijacks every T1-weighted MR study.

## RTV-82 — parametric maps

Parametric maps are quantitative: a reader compares colours across patients and
across time, so the ramp has to be perceptually uniform. Rainbow-family ramps are
not — they invent edges at the cyan/yellow bands and hide detail in the green
plateau. Hence the matplotlib perceptual family:

| LUT | |
| --- | --- |
| `viridis` | default |
| `magma`, `inferno`, `plasma` | |
| `grayscale` | for reading the map without colour |

Each ramp is stored as **11 control points sampled from the published colormap**
and linearly interpolated in sRGB — enough for a display LUT, and explicitly not
a byte-exact reproduction of matplotlib's 256-entry tables.

Conventional display windows ship with the map kinds, so opening an "ADC map"
series loads 0–3000 ×10⁻⁶ mm²/s instead of a meaningless 0–1:

| Kind | Unit | Default window |
| --- | --- | --- |
| ADC | ×10⁻⁶ mm²/s | 0 – 3000 |
| CBV | mL/100 g | 0 – 8 |
| CBF | mL/100 g/min | 0 – 80 |
| MTT | s | 0 – 20 |
| TTP | s | 0 – 30 |

These are *display* conventions, not diagnostic thresholds.

`mapValueToRgba` draws values at or below the threshold fully transparent. That is
the detail that makes a map usable *over* anatomy: without it, background voxels
(typically 0) paint the whole slice with the ramp's low end.

### Relationship to `@ohif/extension-rt-isodose`

`rt-isodose` owns the **dose-heat** ramps (`hot`, `jet`, `grayscale`, `rainbow`),
where a banded rainbow is the clinical convention for isodose lines. This
extension owns the **quantitative** ramps. The two sets are deliberately disjoint
and are not shared through an import: the `rt-*` extension cores in this repo are
self-contained and `@ohif/*`-free (see `extensions/rt-plan/README.md`), and
`rt-fusion` sets the same precedent by mirroring the isodose colormap names rather
than importing them.

## Scope / follow-ups

- **Layer compositing is not wired.** `rtApplyParametricMap` goes as far as the
  public viewport API allows: colormap preset + VOI on the active viewport.
  Rendering a *separate* parametric volume as a semi-transparent second actor over
  anatomy — the `opacity` / `lowerThreshold` half of the panel — needs a second
  volume actor and is a cornerstone integration follow-up, the same boundary
  `rt-fusion` and `rt-isodose` draw. The pure colour/alpha function that layer
  will use (`mapValueToRgba`) is already here and unit-tested.
- **ADC is not computed here.** This extension *displays* parametric maps.
  Computing ADC from multi-b DWI is **RTV-81**.
- **Not validated against real data.** The DEV1 PACS has no MR Dixon and no
  parametric-map series (its 11 studies are CT/RTIMAGE/RTPLAN/RTSTRUCT — see
  `docker/README.md`), and the fork's CI is blocked by a GitHub billing lock, so
  the evidence here is the unit tests, not a rendered viewport.

## Registering

`platform/app/pluginConfig.json` lists the extension. To use it in a mode, add
`'@ohif/extension-rt-mr-quant': '^3.0.0'` to the mode's `extensionDependencies`
and the panel id to its `rightPanels`.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-mr-quant/jest.config.js --ci
```
