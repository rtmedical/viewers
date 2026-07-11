/** Tiny display formatters for the Eclipse-style Info Window (RTV Wave 4). */

/** Number with fixed digits; em-dash for null/undefined; drops trailing on ints. */
export function num(v?: number | null, digits = 1): string {
  if (v == null || !Number.isFinite(v)) {
    return '—';
  }
  return Number.isInteger(v) ? String(v) : v.toFixed(digits);
}

/** Angle in degrees, e.g. "180.0°" (Eclipse shows one decimal). */
export function angle(v?: number | null): string {
  return v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}°`;
}

/** A [lo, hi] pair (jaws) as "-4.3 / 4.6"; em-dash if absent. */
export function pair(p?: [number, number] | null, digits = 1): string {
  if (!p) {
    return '—';
  }
  return `${p[0].toFixed(digits)} / ${p[1].toFixed(digits)}`;
}

/** mm -> cm with one decimal (isocenter coords come from DICOM in mm). */
export function mmToCm(v?: number | null): string {
  return v == null || !Number.isFinite(v) ? '—' : (v / 10).toFixed(2);
}
