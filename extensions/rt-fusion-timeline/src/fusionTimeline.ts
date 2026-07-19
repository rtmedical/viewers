/**
 * Pure **fusion / registration timeline** model + chart geometry (RTV-135).
 *
 * Framework-free and `@ohif/*`-free: extracts the translation from a DICOM
 * Spatial Registration matrix, computes per-registration displacement magnitude,
 * builds a chronological timeline + summary, and produces SVG chart geometry
 * (same approach as `@ohif/extension-rt-dvh`'s dvhChart) — all unit-tested.
 *
 * Source note: the per-fraction displacement *history* in legacy connectviewer
 * came from a backend "fusion store". Here the points are parsed from loaded
 * Spatial Registration Objects (REG) when present; wiring the historical store
 * is a backend follow-up.
 */

export interface Translation {
  tx: number;
  ty: number;
  tz: number;
}

/** Translation from a 4×4 registration matrix (row-major, 16 numbers). */
export function parseRegistrationTranslation(matrix: number[]): Translation {
  if (!Array.isArray(matrix) || matrix.length < 12) {
    return { tx: 0, ty: 0, tz: 0 };
  }
  // row-major: translation is column 4 of rows 0..2 → indices 3, 7, 11
  return { tx: matrix[3] ?? 0, ty: matrix[7] ?? 0, tz: matrix[11] ?? 0 };
}

export function translationMagnitude({ tx, ty, tz }: Translation): number {
  return Math.sqrt(tx * tx + ty * ty + tz * tz);
}

export interface FusionPointInput extends Translation {
  /** Label / date / fraction identifier (used for ordering + x-axis). */
  label: string;
}

export interface FusionPoint extends FusionPointInput {
  magnitudeMm: number;
}

export interface FusionTimeline {
  points: FusionPoint[];
  summary: {
    count: number;
    maxMagnitudeMm?: number;
    meanMagnitudeMm?: number;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Build a chronological fusion timeline (sorted by label) with magnitudes. */
export function buildFusionTimeline(points: FusionPointInput[]): FusionTimeline {
  const enriched: FusionPoint[] = (points ?? [])
    .map(p => ({ ...p, magnitudeMm: round2(translationMagnitude(p)) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const mags = enriched.map(p => p.magnitudeMm);
  return {
    points: enriched,
    summary: {
      count: enriched.length,
      maxMagnitudeMm: mags.length ? Math.max(...mags) : undefined,
      meanMagnitudeMm: mags.length ? round2(mags.reduce((a, b) => a + b, 0) / mags.length) : undefined,
    },
  };
}

// ---- SVG chart geometry (tx/ty/tz/magnitude over the timeline) ----

export const FUSION_SERIES: { key: 'tx' | 'ty' | 'tz' | 'magnitudeMm'; label: string; color: string }[] = [
  { key: 'tx', label: 'X', color: '#e15759' },
  { key: 'ty', label: 'Y', color: '#59a14f' },
  { key: 'tz', label: 'Z', color: '#4e79a7' },
  { key: 'magnitudeMm', label: '|d|', color: '#edc948' },
];

export interface FusionChartGeometry {
  width: number;
  height: number;
  pad: number;
  minMm: number;
  maxMm: number;
  series: { key: string; label: string; color: string; polyline: string }[];
  zeroY: number;
}

export function buildFusionChart(
  timeline: FusionTimeline,
  options: { width?: number; height?: number; pad?: number } = {}
): FusionChartGeometry {
  const width = options.width ?? 460;
  const height = options.height ?? 220;
  const pad = options.pad ?? 28;
  const pts = timeline.points;

  let min = 0;
  let max = 0;
  for (const p of pts) {
    for (const s of FUSION_SERIES) {
      const v = p[s.key] as number;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === max) {
    max = min + 1;
  }

  const plotW = width - 2 * pad;
  const plotH = height - 2 * pad;
  const n = pts.length;
  const xOf = (i: number) => pad + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yOf = (v: number) => height - pad - ((v - min) / (max - min)) * plotH;

  const series = FUSION_SERIES.map(s => ({
    key: s.key,
    label: s.label,
    color: s.color,
    polyline: pts.map((p, i) => `${xOf(i).toFixed(1)},${yOf(p[s.key] as number).toFixed(1)}`).join(' '),
  }));

  return { width, height, pad, minMm: min, maxMm: max, series, zeroY: yOf(0) };
}

export default buildFusionTimeline;
