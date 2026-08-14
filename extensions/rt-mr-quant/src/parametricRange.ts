/**
 * Parametric-map display range, window/level and value formatting — pure core (RTV-82).
 *
 * A parametric map is not an image with arbitrary grey values: each voxel is a
 * physical quantity with a unit and a clinically meaningful range. This module
 * is the layer that turns those numbers into something a LUT can colour:
 * normalisation over a display range, the window/level ↔ range equivalence, a
 * transparency threshold so the map overlays anatomy instead of hiding it, and
 * unit-aware formatting for the readout and the colour-bar ticks.
 *
 * Framework-free. Colours come from {@link ./parametricLut}. Zero-fork per RTV-114.
 */

import { lutColor, ParametricLutName } from './parametricLut';

/** Map kinds the panel knows the units and sensible defaults for. */
export type ParametricMapKind = 'ADC' | 'CBV' | 'CBF' | 'MTT' | 'TTP' | 'generic';

export interface ParametricRange {
  /** Lowest value the ramp starts at. */
  min: number;
  /** Highest value the ramp ends at. */
  max: number;
}

export interface ParametricMapDescriptor {
  kind: ParametricMapKind;
  label: string;
  /** Unit as it is shown to the reader. */
  unit: string;
  /** Clinically conventional display window. */
  defaultRange: ParametricRange;
  /** Decimals for the readout. */
  decimals: number;
}

/**
 * Conventional display windows.
 *
 * ADC is expressed in the unit DICOM ADC maps are normally stored in
 * (10⁻⁶ mm²/s, i.e. µm²/s), so 0–3000 covers CSF-free brain tissue through
 * free water. The perfusion ranges follow the usual DSC reporting scales.
 * These are *display* conventions, not diagnostic thresholds.
 */
export const PARAMETRIC_MAP_DESCRIPTORS: Record<ParametricMapKind, ParametricMapDescriptor> = {
  ADC: {
    kind: 'ADC',
    label: 'ADC',
    unit: '×10⁻⁶ mm²/s',
    defaultRange: { min: 0, max: 3000 },
    decimals: 0,
  },
  CBV: {
    kind: 'CBV',
    label: 'CBV',
    unit: 'mL/100 g',
    defaultRange: { min: 0, max: 8 },
    decimals: 1,
  },
  CBF: {
    kind: 'CBF',
    label: 'CBF',
    unit: 'mL/100 g/min',
    defaultRange: { min: 0, max: 80 },
    decimals: 0,
  },
  MTT: {
    kind: 'MTT',
    label: 'MTT',
    unit: 's',
    defaultRange: { min: 0, max: 20 },
    decimals: 1,
  },
  TTP: {
    kind: 'TTP',
    label: 'TTP',
    unit: 's',
    defaultRange: { min: 0, max: 30 },
    decimals: 1,
  },
  generic: {
    kind: 'generic',
    label: 'Value',
    unit: '',
    defaultRange: { min: 0, max: 1 },
    decimals: 3,
  },
};

export const PARAMETRIC_MAP_KINDS: ParametricMapKind[] = [
  'ADC',
  'CBV',
  'CBF',
  'MTT',
  'TTP',
  'generic',
];

/**
 * Infers the map kind from a series description.
 *
 * Whole-token matching, like the Dixon detector, so "ADCX" or "MTTL" cannot
 * match. Returns `generic` when nothing is recognised — never throws.
 */
export function inferMapKind(seriesDescription?: string): ParametricMapKind {
  const tokens = (seriesDescription ?? '')
    .toUpperCase()
    .split(/[\\\s_\-./,()[\]+]+/)
    .filter(Boolean);

  for (const kind of ['ADC', 'CBV', 'CBF', 'MTT', 'TTP'] as ParametricMapKind[]) {
    if (tokens.includes(kind)) {
      return kind;
    }
  }
  return 'generic';
}

/** Orders a range and rejects a degenerate one by widening it minimally. */
export function normalizeRange(range: ParametricRange): ParametricRange {
  const min = Number.isFinite(range?.min) ? range.min : 0;
  const max = Number.isFinite(range?.max) ? range.max : 1;
  if (min === max) {
    // A zero-width window would divide by zero downstream. Widen by one unit
    // rather than throwing — a reader dragging a slider can legitimately land here.
    return { min, max: min + 1 };
  }
  return min < max ? { min, max } : { min: max, max: min };
}

/**
 * Normalises a value to [0,1] over the display range.
 * Non-finite input yields `NaN` so callers can treat it as "no data".
 */
export function normalizeValue(value: number, range: ParametricRange): number {
  if (!Number.isFinite(value)) {
    return NaN;
  }
  const { min, max } = normalizeRange(range);
  const t = (value - min) / (max - min);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Window width/centre for a display range.
 *
 * Parametric maps are wired into the same window/level tooling as images, so the
 * panel needs both views of the same state. The two functions are inverses up to
 * floating-point representation (see the round-trip test).
 */
export function rangeToWindow(range: ParametricRange): { windowWidth: number; windowCenter: number } {
  const { min, max } = normalizeRange(range);
  return { windowWidth: max - min, windowCenter: (max + min) / 2 };
}

/** The inverse of {@link rangeToWindow}. */
export function windowToRange(windowWidth: number, windowCenter: number): ParametricRange {
  const width = Number.isFinite(windowWidth) ? Math.abs(windowWidth) : 1;
  const center = Number.isFinite(windowCenter) ? windowCenter : 0.5;
  return normalizeRange({ min: center - width / 2, max: center + width / 2 });
}

export interface ParametricOverlayOptions {
  lut: ParametricLutName;
  range: ParametricRange;
  /** Overlay opacity in [0,1]. */
  opacity?: number;
  /**
   * Values at or below this are drawn fully transparent, so background voxels
   * (typically 0) let the anatomy show through instead of painting the whole
   * slice with the ramp's low end. Defaults to the range minimum.
   */
  lowerThreshold?: number;
}

export type RGBA = [number, number, number, number];

/**
 * Maps one value to an overlay RGBA (channels 0-255, alpha 0-1).
 *
 * Transparent when the value is not finite or sits at/below the threshold —
 * that transparency is what makes the map usable *over* anatomy, and is the
 * behaviour worth getting right in this module rather than in a component.
 */
export function mapValueToRgba(value: number, options: ParametricOverlayOptions): RGBA {
  const range = normalizeRange(options.range);
  const opacity = clampOpacity(options.opacity);
  const threshold = Number.isFinite(options.lowerThreshold as number)
    ? (options.lowerThreshold as number)
    : range.min;

  if (!Number.isFinite(value) || value <= threshold) {
    return [0, 0, 0, 0];
  }

  const [r, g, b] = lutColor(options.lut, normalizeValue(value, range));
  return [r, g, b, opacity];
}

function clampOpacity(opacity?: number): number {
  if (!Number.isFinite(opacity as number)) {
    return 1;
  }
  const v = opacity as number;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Formats a value with its unit, or an em dash when there is no value. */
export function formatParametricValue(
  value: number,
  kind: ParametricMapKind = 'generic',
  withUnit = true
): string {
  const descriptor = PARAMETRIC_MAP_DESCRIPTORS[kind] ?? PARAMETRIC_MAP_DESCRIPTORS.generic;
  if (!Number.isFinite(value)) {
    return '—';
  }
  const text = value.toFixed(descriptor.decimals);
  return withUnit && descriptor.unit ? `${text} ${descriptor.unit}` : text;
}

export interface LegendTick {
  /** Value at this tick. */
  value: number;
  /** Position along the bar, 0 at `range.min` and 1 at `range.max`. */
  position: number;
  label: string;
}

/**
 * Evenly spaced ticks for the colour-bar legend, inclusive of both ends.
 * `count` is clamped to at least 2 so there is always a low and a high label.
 */
export function buildLegendTicks(
  range: ParametricRange,
  kind: ParametricMapKind = 'generic',
  count = 5
): LegendTick[] {
  const { min, max } = normalizeRange(range);
  const n = Math.max(2, Math.floor(count));
  const ticks: LegendTick[] = [];
  for (let i = 0; i < n; i++) {
    const position = i / (n - 1);
    const value = min + (max - min) * position;
    // Only the top tick carries the unit — repeating it on every tick is noise.
    ticks.push({ value, position, label: formatParametricValue(value, kind, i === n - 1) });
  }
  return ticks;
}
