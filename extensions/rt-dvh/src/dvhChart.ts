/**
 * Pure SVG chart geometry for the DVH panel (RTV-131).
 *
 * Maps {@link DvhCurve}s to polyline coordinates + axis ticks with no rendering
 * dependency, so the dose×volume mapping is unit-tested without a chart library
 * or a DOM. The panel renders raw `<svg>` from this.
 */
import { DvhCurve } from './dvhParser';

export const DVH_PALETTE = [
  '#4ec9b0', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
  '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
];

export interface DvhChartSeries {
  roiName: string;
  color: string;
  /** SVG polyline `points` attribute. */
  polyline: string;
}

export interface DvhChartGeometry {
  width: number;
  height: number;
  pad: number;
  doseMax: number;
  volMax: number;
  /** y-axis as percent of structure volume (vs absolute volume units). */
  asPercent: boolean;
  series: DvhChartSeries[];
  doseTicks: { value: number; x: number }[];
  volTicks: { value: number; y: number }[];
}

function niceMax(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

export interface BuildDvhChartOptions {
  width?: number;
  height?: number;
  pad?: number;
  asPercent?: boolean;
}

export function buildDvhChart(
  curves: DvhCurve[],
  options: BuildDvhChartOptions = {}
): DvhChartGeometry {
  const width = options.width ?? 480;
  const height = options.height ?? 300;
  const pad = options.pad ?? 32;
  const asPercent = options.asPercent ?? true;

  const doseMaxRaw = curves.reduce(
    (m, c) => Math.max(m, c.points.reduce((mm, p) => Math.max(mm, p.dose), 0)),
    0
  );
  const volMaxRaw = asPercent
    ? 100
    : curves.reduce((m, c) => Math.max(m, c.totalVolume ?? 0), 0);
  const doseMax = niceMax(doseMaxRaw);
  const volMax = asPercent ? 100 : niceMax(volMaxRaw);

  const plotW = width - 2 * pad;
  const plotH = height - 2 * pad;
  const xOf = (dose: number) => pad + (doseMax ? (dose / doseMax) * plotW : 0);
  const yOf = (vol: number) => height - pad - (volMax ? (vol / volMax) * plotH : 0);

  const series: DvhChartSeries[] = curves.map((c, i) => {
    const total = c.totalVolume ?? (c.points[0]?.volume ?? 0);
    const polyline = c.points
      .map(p => {
        const v = asPercent ? (total ? (p.volume / total) * 100 : 0) : p.volume;
        return `${xOf(p.dose).toFixed(1)},${yOf(v).toFixed(1)}`;
      })
      .join(' ');
    return {
      roiName: c.roiName || (c.roiNumber != null ? `ROI ${c.roiNumber}` : `Curve ${i + 1}`),
      color: DVH_PALETTE[i % DVH_PALETTE.length],
      polyline,
    };
  });

  const doseTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    value: Math.round(doseMax * f * 10) / 10,
    x: pad + f * plotW,
  }));
  const volTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    value: Math.round(volMax * f),
    y: height - pad - f * plotH,
  }));

  return { width, height, pad, doseMax, volMax, asPercent, series, doseTicks, volTicks };
}

export default buildDvhChart;
