/**
 * Perceptually-uniform colour LUTs for parametric maps — pure core (RTV-82).
 *
 * Parametric maps (ADC, CBV, CBF, MTT, TTP) are *quantitative*: a reader
 * compares colours across patients and across time, so the ramp has to be
 * perceptually uniform. Rainbow-family ramps are not — they create false edges
 * at the cyan/yellow bands and hide detail in the green plateau, which is why
 * the maps here are the matplotlib perceptual family rather than jet.
 *
 * ## Relationship to `@ohif/extension-rt-isodose`
 *
 * `rt-isodose` owns the **dose-heat** ramps (`hot`, `jet`, `grayscale`,
 * `rainbow`) used by the isodose panel, where a banded rainbow is the clinical
 * convention. This module owns the **quantitative** ramps. The two sets are
 * deliberately disjoint and are not shared through an import: the `rt-*`
 * extension cores in this repo are self-contained and `@ohif/*`-free (see
 * extensions/rt-plan/README.md), and `rt-fusion` sets the same precedent by
 * mirroring the isodose colormap names instead of importing them.
 *
 * ## Fidelity
 *
 * Each ramp is stored as **11 control points sampled from the published
 * colormap** and linearly interpolated in sRGB, not as the full 256-entry
 * table. That is enough for a display LUT and keeps the module small; it is
 * *not* a byte-exact reproduction of matplotlib's tables.
 *
 * Framework-free. Zero-fork per RTV-114.
 */

export type RGB = [number, number, number];

/**
 * Quantitative ramps available to parametric maps.
 * `grayscale` is included because readers often want the map without colour.
 */
export type ParametricLutName = 'viridis' | 'magma' | 'inferno' | 'plasma' | 'grayscale';

export const PARAMETRIC_LUT_NAMES: ParametricLutName[] = [
  'viridis',
  'magma',
  'inferno',
  'plasma',
  'grayscale',
];

export const PARAMETRIC_LUT_LABELS: Record<ParametricLutName, string> = {
  viridis: 'Viridis',
  magma: 'Magma',
  inferno: 'Inferno',
  plasma: 'Plasma',
  grayscale: 'Grayscale',
};

/**
 * 11 control points per ramp, at t = 0.0, 0.1, ... 1.0, in normalised sRGB.
 * Sampled from the matplotlib colormaps of the same name.
 */
const CONTROL_POINTS: Record<Exclude<ParametricLutName, 'grayscale'>, RGB[]> = {
  viridis: [
    [0.267004, 0.004874, 0.329415],
    [0.282623, 0.140926, 0.457517],
    [0.253935, 0.265254, 0.529983],
    [0.206756, 0.371758, 0.553117],
    [0.163625, 0.471133, 0.558148],
    [0.127568, 0.566949, 0.550556],
    [0.134692, 0.658636, 0.517649],
    [0.266941, 0.748751, 0.440573],
    [0.477504, 0.821444, 0.318195],
    [0.741388, 0.873449, 0.149561],
    [0.993248, 0.906157, 0.143936],
  ],
  magma: [
    [0.001462, 0.000466, 0.013866],
    [0.078815, 0.054184, 0.211667],
    [0.232077, 0.059889, 0.437695],
    [0.390384, 0.100379, 0.501864],
    [0.550287, 0.161158, 0.505719],
    [0.716387, 0.214982, 0.47529],
    [0.868793, 0.287728, 0.409303],
    [0.967671, 0.439703, 0.35981],
    [0.99568, 0.624861, 0.427397],
    [0.996096, 0.812706, 0.581391],
    [0.987053, 0.991438, 0.749504],
  ],
  inferno: [
    [0.001462, 0.000466, 0.013866],
    [0.087411, 0.044556, 0.224813],
    [0.258234, 0.038571, 0.406485],
    [0.416331, 0.090203, 0.432943],
    [0.578304, 0.148039, 0.404411],
    [0.735683, 0.215906, 0.330245],
    [0.865006, 0.316822, 0.226055],
    [0.954506, 0.468744, 0.099874],
    [0.987622, 0.64532, 0.039886],
    [0.964394, 0.843848, 0.273391],
    [0.988362, 0.998364, 0.644924],
  ],
  plasma: [
    [0.050383, 0.029803, 0.527975],
    [0.254627, 0.013882, 0.615419],
    [0.417642, 0.000564, 0.65839],
    [0.562738, 0.051545, 0.641509],
    [0.69284, 0.165141, 0.564522],
    [0.798216, 0.280197, 0.469538],
    [0.881443, 0.392529, 0.383229],
    [0.949217, 0.517763, 0.295662],
    [0.98826, 0.652325, 0.211364],
    [0.988648, 0.809579, 0.145357],
    [0.940015, 0.975158, 0.131326],
  ],
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const to255 = (v: number) => Math.round(clamp01(v) * 255);

/**
 * Colour at normalised position `t` in [0,1].
 *
 * `t` is clamped, and a non-finite `t` resolves to the low end of the ramp so a
 * NaN voxel can never produce `NaN` channels.
 */
export function lutColor(name: ParametricLutName, t: number): RGB {
  const x = Number.isFinite(t) ? clamp01(t) : 0;

  if (name === 'grayscale') {
    const v = to255(x);
    return [v, v, v];
  }

  const points = CONTROL_POINTS[name] ?? CONTROL_POINTS.viridis;
  const lastIndex = points.length - 1;
  const scaled = x * lastIndex;
  const lower = Math.min(Math.floor(scaled), lastIndex - 1);
  const frac = scaled - lower;

  const a = points[lower];
  const b = points[lower + 1];
  return [
    to255(a[0] + (b[0] - a[0]) * frac),
    to255(a[1] + (b[1] - a[1]) * frac),
    to255(a[2] + (b[2] - a[2]) * frac),
  ];
}

/** Builds an N-entry LUT. */
export function buildLut(name: ParametricLutName, steps = 256): RGB[] {
  const n = Math.max(2, Math.floor(steps));
  const lut: RGB[] = [];
  for (let i = 0; i < n; i++) {
    lut.push(lutColor(name, i / (n - 1)));
  }
  return lut;
}

/** `rgb(r, g, b)` for a normalised position — handy for inline styles. */
export function lutCssColor(name: ParametricLutName, t: number): string {
  const [r, g, b] = lutColor(name, t);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * A `linear-gradient(...)` for the colour-bar legend.
 *
 * @param stops How many stops to emit. Few stops keep the CSS short; the
 *   browser interpolates between them just as `lutColor` does.
 */
export function lutCssGradient(name: ParametricLutName, stops = 11, angle = 'to right'): string {
  const n = Math.max(2, Math.floor(stops));
  const pieces: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pieces.push(`${lutCssColor(name, t)} ${Math.round(t * 100)}%`);
  }
  return `linear-gradient(${angle}, ${pieces.join(', ')})`;
}

/**
 * The LUT in the shape `@ohif/extension-cornerstone`'s colorbar and the
 * Cornerstone3D colormap registry consume — `RGBPoints` is a flat
 * `[position, r, g, b, ...]` array with channels in [0,1].
 *
 * Emitting this (rather than editing `extensions/cornerstone/src/utils/colormaps.js`)
 * is what keeps RTV-114 satisfied: `@ohif/extension-cornerstone` is a
 * fork-forbidden package, so the ramps are handed over as data.
 */
export function toColormapPreset(name: ParametricLutName, steps = 32) {
  const n = Math.max(2, Math.floor(steps));
  const rgbPoints: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const [r, g, b] = lutColor(name, t);
    rgbPoints.push(t, r / 255, g / 255, b / 255);
  }
  return {
    ColorSpace: 'RGB',
    Name: PARAMETRIC_LUT_LABELS[name],
    NanColor: [1, 0, 0] as RGB,
    RGBPoints: rgbPoints,
    description: `${PARAMETRIC_LUT_LABELS[name]} (parametric map, RTV-82)`,
  };
}

/** Every ramp as a colormap preset, ready to register via CustomizationService. */
export function parametricColormapPresets(steps = 32) {
  return PARAMETRIC_LUT_NAMES.map(name => toColormapPreset(name, steps));
}
