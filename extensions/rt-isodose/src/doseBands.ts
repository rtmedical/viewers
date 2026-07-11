/**
 * Iso-band rasterization (RTV Wave 4 / Phase 5).
 *
 * Pure, framework-free core for the Eclipse "Isodose Color Wash" mode: turn a
 * dose scalar grid into a band labelmap where every voxel is assigned the index
 * of the highest isodose level it reaches. The labelmap is then rendered as a
 * coloured Labelmap representation (volumetric → all MPR planes) using the
 * per-level colours from {@link ./isodose}. Kept pure so it is unit-tested in
 * isolation and reused by the rt-isodose command layer.
 */

/**
 * Assign each voxel to an isodose band.
 *
 * @param scalar   Per-voxel dose in Gy (any array-like of numbers).
 * @param levelsGy Dose thresholds in Gy (any order). They are sorted ascending;
 *                 a voxel's band = how many thresholds its dose is >= to, so
 *                 band 0 = below the lowest level and band N = at/above the
 *                 highest. Band i (i>=1) corresponds to the i-th lowest level.
 * @returns Uint8Array (band index per voxel). Up to 255 levels are supported.
 */
export function doseToBandLabelmap(
  scalar: ArrayLike<number>,
  levelsGy: number[]
): Uint8Array {
  const n = scalar.length;
  const out = new Uint8Array(n);
  const levels = [...levelsGy]
    .filter(v => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!levels.length) {
    return out;
  }
  const nLevels = Math.min(levels.length, 255);
  for (let i = 0; i < n; i++) {
    const d = scalar[i];
    if (!(d > 0) || !Number.isFinite(d)) {
      continue; // band 0 (no/void dose)
    }
    // Count thresholds this dose meets — highest band it reaches.
    let band = 0;
    for (let k = 0; k < nLevels; k++) {
      if (d >= levels[k]) {
        band = k + 1;
      } else {
        break;
      }
    }
    out[i] = band;
  }
  return out;
}

/**
 * Convenience: the Gy thresholds for a set of isodose percents against a
 * prescription dose, sorted ascending (matches the band indices above).
 */
export function isodoseLevelsGy(prescriptionGy: number, percents: number[]): number[] {
  if (!(prescriptionGy > 0)) {
    return [];
  }
  return percents
    .map(p => Math.round(prescriptionGy * p) / 100)
    .filter(v => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
}

export default doseToBandLabelmap;
