/**
 * Isodose-line level resolution — pure core.
 *
 * The streaming RTDOSE volume exposes RAW stored pixels (DoseGridScaling is NOT
 * applied by the loader — empirically raw maxima are in the millions), so the
 * marching-squares thresholds must be expressed in raw units. This module turns
 * (prescription Gy, DoseGridScaling, raw max) into per-level raw thresholds +
 * display labels, falling back to percent-of-max when Gy calibration is not
 * possible. Framework-free; colors come from {@link ./isodose}.
 */
import { buildIsodoseLevels, ColormapName, DEFAULT_ISODOSE_PERCENTS } from './isodose';

export interface IsodoseLineLevel {
  /** Percent of the reference dose (Rx, or max when relative). */
  percent: number;
  /** Absolute dose in Gy when calibration is known. */
  doseGy?: number;
  /** Threshold in the volume's RAW scalar units (what marching squares gets). */
  raw: number;
  /** Line color. */
  hex: string;
}

export interface IsodoseLineSpec {
  /** 'absolute' = Gy from Rx × DoseGridScaling; 'relative' = % of max raw dose. */
  mode: 'absolute' | 'relative';
  /** Gy per raw unit when known (DoseGridScaling, or 1 for pre-scaled volumes). */
  gyPerRaw?: number;
  levels: IsodoseLineLevel[];
}

/**
 * Resolve isodose-line thresholds.
 *
 * @param maxRaw  Max scalar value scanned from the volume (raw units).
 * @param doseGridScaling  DICOM DoseGridScaling (Gy per raw unit), if present.
 * @param prescriptionGy   Prescribed dose (Gy), if known.
 * @param percents Isodose percents (default Eclipse-conventional set).
 */
export function resolveIsodoseLineLevels(
  maxRaw: number,
  doseGridScaling?: number,
  prescriptionGy?: number,
  percents: number[] = DEFAULT_ISODOSE_PERCENTS,
  colormap: ColormapName = 'jet'
): IsodoseLineSpec {
  const scaling = Number(doseGridScaling);
  // A dose grid already in Gy tops out well under 500; raw uint grids are huge.
  const gyPerRaw =
    Number.isFinite(scaling) && scaling > 0
      ? scaling
      : maxRaw > 0 && maxRaw < 500
        ? 1
        : undefined;

  if (gyPerRaw != null && prescriptionGy != null && Number.isFinite(prescriptionGy) && prescriptionGy > 0) {
    const levels = buildIsodoseLevels(prescriptionGy, percents, colormap)
      .filter(l => l.doseGy != null && l.doseGy > 0)
      .map(l => ({ percent: l.percent, doseGy: l.doseGy, raw: (l.doseGy as number) / gyPerRaw, hex: l.hex }));
    return { mode: 'absolute', gyPerRaw, levels };
  }

  // Relative fallback: percents of the max scanned dose (no Rx / no calibration).
  const levels = buildIsodoseLevels(undefined, percents, colormap)
    .filter(l => l.percent > 0 && l.percent <= 100)
    .map(l => ({
      percent: l.percent,
      doseGy: gyPerRaw != null ? Math.round(maxRaw * gyPerRaw * l.percent) / 100 : undefined,
      raw: (maxRaw * l.percent) / 100,
      hex: l.hex,
    }));
  return { mode: 'relative', gyPerRaw, levels };
}

export default resolveIsodoseLineLevels;
