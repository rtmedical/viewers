/**
 * Pure **dose colormaps + isodose levels** for the Isodoses panel (RTV-137).
 *
 * Framework-free and `@ohif/*`-free: generates dose-heat color lookup tables
 * (hot / jet / grayscale / rainbow) and isodose level definitions (as a % of the
 * prescription dose), all unit-tested. The viewport overlay that actually draws
 * the isodose lines / dose-wash from an RTDOSE grid is a cornerstone integration
 * follow-up; this module is the color/level data layer the panel renders.
 */

export type RGB = [number, number, number];
export type ColormapName = 'hot' | 'jet' | 'grayscale' | 'rainbow';

export const COLORMAP_NAMES: ColormapName[] = ['hot', 'jet', 'grayscale', 'rainbow'];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const to255 = (v: number) => Math.round(clamp01(v) * 255);

/** HSL (h in degrees, s/l in [0,1]) → RGB 0-255. */
function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [to255(r + m), to255(g + m), to255(b + m)];
}

/** Color at normalized position t∈[0,1] for a named colormap. */
export function colormapColor(name: ColormapName, t: number): RGB {
  const x = clamp01(t);
  switch (name) {
    case 'grayscale':
      return [to255(x), to255(x), to255(x)];
    case 'hot':
      // black → red → yellow → white
      return [to255(x / 0.4), to255((x - 0.4) / 0.35), to255((x - 0.75) / 0.25)];
    case 'jet':
      // standard jet approximation: dark blue → cyan → yellow → dark red
      return [
        to255(1.5 - Math.abs(4 * x - 3)),
        to255(1.5 - Math.abs(4 * x - 2)),
        to255(1.5 - Math.abs(4 * x - 1)),
      ];
    case 'rainbow':
    default:
      // blue (240°) → red (0°)
      return hslToRgb((1 - x) * 240, 1, 0.5);
  }
}

/** Build an N-entry colormap LUT. */
export function buildColormap(name: ColormapName, steps = 256): RGB[] {
  const n = Math.max(2, Math.floor(steps));
  const lut: RGB[] = [];
  for (let i = 0; i < n; i++) lut.push(colormapColor(name, i / (n - 1)));
  return lut;
}

/** Map an absolute dose to a color via [minGy,maxGy] normalization. */
export function mapDoseToColor(doseGy: number, minGy: number, maxGy: number, name: ColormapName): RGB {
  const span = maxGy - minGy;
  const t = span > 0 ? (doseGy - minGy) / span : 0;
  return colormapColor(name, t);
}

/** "#rrggbb" from an RGB triple. */
export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

/** Conventional isodose percentages (relative to prescription), high → low. */
export const DEFAULT_ISODOSE_PERCENTS = [107, 100, 95, 90, 80, 70, 50, 30, 10];

export interface IsodoseLevel {
  percent: number;
  doseGy?: number;
  color: RGB;
  hex: string;
}

/**
 * Build isodose levels for a prescription dose. Each percent gets a color from
 * the colormap (mapped across the percent range), sorted high → low. When no
 * prescription is given, `doseGy` is omitted (percent-only levels).
 */
export function buildIsodoseLevels(
  prescriptionGy?: number,
  percents: number[] = DEFAULT_ISODOSE_PERCENTS,
  colormap: ColormapName = 'jet'
): IsodoseLevel[] {
  const sorted = [...percents].sort((a, b) => b - a);
  const max = Math.max(...sorted, 1);
  const min = Math.min(...sorted, 0);
  const span = max - min;
  return sorted.map(percent => {
    const t = span > 0 ? (percent - min) / span : 1;
    const color = colormapColor(colormap, t);
    return {
      percent,
      doseGy:
        prescriptionGy != null && Number.isFinite(prescriptionGy)
          ? Math.round(prescriptionGy * percent) / 100
          : undefined,
      color,
      hex: rgbToHex(color),
    };
  });
}

export default buildIsodoseLevels;
