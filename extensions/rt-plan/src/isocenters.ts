/**
 * Isocenter helpers (RTV-145) — pure, framework-free.
 *
 * The RTPLAN parser ({@link ./rtPlanParser}) already extracts each beam's
 * `IsocenterPosition` [x, y, z] in mm. These are patient coordinates (LPS) in
 * the plan's Frame of Reference — the same space as the planning CT volume in
 * the normal single-FoR case, so a collected isocenter can be handed directly
 * to viewport navigation (and fused/registered series follow via their own
 * FoR registration).
 *
 * `collectIsocenters` dedupes per position (beams routinely share one
 * isocenter) with a 0.01 mm per-axis tolerance and returns the entries ordered
 * by their lowest beam number. `formatIsocenter` renders the panel/toast label.
 */
import { RtPlan } from './rtPlanParser';

/** Beams whose isocenters differ ≤ this per axis (mm) share one entry. */
export const ISOCENTER_TOLERANCE_MM = 0.01;

export interface IsocenterEntry {
  /** BeamNumber of the first (lowest-numbered) beam at this position. */
  beamNumber?: number;
  /** BeamName of that first beam. */
  beamName?: string;
  /** IsocenterPosition [x, y, z] in mm (plan FoR, LPS). */
  isocenter: [number, number, number];
  /** Stable position identity ('x,y,z' @ 0.01 mm) — dedupe id / React key. */
  key: string;
  /** Every BeamNumber sharing this isocenter, in ascending order. */
  beamNumbers: number[];
}

/** toFixed that never yields '-0.00' style negative zeros. */
function fixed(value: number, digits: number): string {
  const s = value.toFixed(digits);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

function positionKey(isocenter: [number, number, number]): string {
  return isocenter.map(v => fixed(v, 2)).join(',');
}

/**
 * Unique isocenters of `plan`, ordered by lowest referencing beam number
 * (beams without a number sort last, in plan order). Beams without a finite
 * 3D isocenter are skipped.
 */
export function collectIsocenters(plan: RtPlan | undefined | null): IsocenterEntry[] {
  const entries: IsocenterEntry[] = [];
  const beams = [...(plan?.beams ?? [])].sort((a, b) => {
    if (a.number == null && b.number == null) {
      return 0;
    }
    if (a.number == null) {
      return 1;
    }
    if (b.number == null) {
      return -1;
    }
    return a.number - b.number;
  });

  for (const beam of beams) {
    const iso = beam.isocenter;
    if (!iso || iso.length < 3 || iso.some(v => !Number.isFinite(v))) {
      continue;
    }
    // 1e-9 absorbs float noise so the documented "≤ 0.01 mm" boundary holds
    // (e.g. |1.01 - 1| evaluates to 0.010000000000000009 in IEEE 754).
    const match = entries.find(e =>
      e.isocenter.every((v, axis) => Math.abs(v - iso[axis]) <= ISOCENTER_TOLERANCE_MM + 1e-9)
    );
    if (match) {
      if (beam.number != null && !match.beamNumbers.includes(beam.number)) {
        match.beamNumbers.push(beam.number);
      }
      continue;
    }
    entries.push({
      beamNumber: beam.number,
      beamName: beam.name,
      isocenter: [iso[0], iso[1], iso[2]],
      key: positionKey(iso),
      beamNumbers: beam.number != null ? [beam.number] : [],
    });
  }
  return entries;
}

/** 'x, y, z mm' with one decimal place (no negative zeros). */
export function formatIsocenter(isocenter: [number, number, number]): string {
  return `${isocenter.map(v => fixed(v, 1)).join(', ')} mm`;
}

export default collectIsocenters;
