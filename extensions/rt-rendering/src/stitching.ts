/**
 * Multi-station stitching — pure core (RTV-60).
 *
 * Whole-body angiography is acquired in stations (pelvis, thigh, calf) that overlap by
 * design. Composing them into one volume is what makes a whole-body MIP possible.
 *
 * ## The check that has to come first
 *
 * Stations can only be composed if they share a **FrameOfReferenceUID**. That UID is the
 * DICOM statement that two series' coordinates mean the same thing; without it,
 * `ImagePositionPatient` values from different series are numbers in unrelated spaces.
 * Stitching across frames of reference does not fail loudly — it produces a composite
 * that looks plausible and is geometrically wrong, which is the worst possible outcome
 * for a study someone will measure a stenosis on.
 *
 * So {@link planStitch} refuses, with a reason, rather than composing.
 *
 * ## The detail that makes it look right
 *
 * Concatenating at the overlap boundary leaves a visible seam: the two stations differ
 * slightly in noise, contrast phase and detector response, and the eye finds a straight
 * horizontal line instantly. {@link blendWeightAt} ramps linearly across the overlap so
 * the transition is spread over centimetres instead of landing on one slice.
 *
 * Framework-free: geometry and weights only, no pixel access. Zero-fork per RTV-114.
 */

export interface Station {
  seriesInstanceUid: string;
  frameOfReferenceUid?: string;
  /** ImagePositionPatient of the first slice, mm. */
  originMm: [number, number, number];
  /** Slice spacing along the stack axis, mm. */
  sliceSpacingMm: number;
  /** Number of slices. */
  slices: number;
  /** In-plane spacing [row, col], mm. */
  pixelSpacingMm?: [number, number];
  rows?: number;
  columns?: number;
}

export interface StationExtent {
  seriesInstanceUid: string;
  /** Lowest z, mm (patient superior-inferior axis). */
  startMm: number;
  /** Highest z, mm. */
  endMm: number;
  sliceSpacingMm: number;
  slices: number;
}

const finite = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * The z extent a station covers.
 *
 * Only the z axis is considered: multi-station angio steps the table along the patient
 * axis, and stations that differ in x/y are a different problem (mosaicing) that this
 * does not claim to solve.
 */
export function stationExtent(station: Station): StationExtent | null {
  if (!station?.seriesInstanceUid) {
    return null;
  }
  const spacing = finite(station.sliceSpacingMm);
  const slices = Math.floor(finite(station.slices));
  if (!(spacing > 0) || slices < 1) {
    return null;
  }
  const z = finite(station.originMm?.[2]);
  const span = (slices - 1) * spacing;
  return {
    seriesInstanceUid: station.seriesInstanceUid,
    startMm: Math.min(z, z + span),
    endMm: Math.max(z, z + span),
    sliceSpacingMm: spacing,
    slices,
  };
}

export interface OverlapRegion {
  /** Series below, in z. */
  lowerUid: string;
  /** Series above, in z. */
  upperUid: string;
  startMm: number;
  endMm: number;
  get lengthMm(): number;
}

function overlapOf(a: StationExtent, b: StationExtent): OverlapRegion | null {
  const lower = a.startMm <= b.startMm ? a : b;
  const upper = lower === a ? b : a;
  const startMm = Math.max(lower.startMm, upper.startMm);
  const endMm = Math.min(lower.endMm, upper.endMm);
  if (!(endMm > startMm)) {
    return null;
  }
  return {
    lowerUid: lower.seriesInstanceUid,
    upperUid: upper.seriesInstanceUid,
    startMm,
    endMm,
    get lengthMm() {
      return endMm - startMm;
    },
  };
}

export interface StitchPlan {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Stations ordered along z, low to high. */
  ordered: StationExtent[];
  overlaps: OverlapRegion[];
  /** Gaps between consecutive stations, in mm. Empty when they all overlap. */
  gaps: Array<{ afterUid: string; beforeUid: string; lengthMm: number }>;
  /** Total z coverage of the composite, mm. */
  totalLengthMm: number;
  /** Slice spacing to resample the composite at, mm. */
  outputSpacingMm: number;
  outputSlices: number;
}

/**
 * Plans a composition.
 *
 * The output spacing is the **finest** of the stations, not the coarsest: resampling a
 * fine station down to a coarse one throws away detail that was acquired, and a
 * whole-body run is usually finest where it matters (the calf, where the vessels are
 * smallest).
 */
export function planStitch(stations: Station[]): StitchPlan {
  const errors: string[] = [];
  const warnings: string[] = [];

  const list = (stations ?? []).filter(Boolean);
  const extents = list.map(stationExtent).filter(Boolean) as StationExtent[];

  if (extents.length !== list.length) {
    warnings.push('Some stations had no usable geometry and were skipped.');
  }
  if (extents.length < 2) {
    errors.push('At least two stations with usable geometry are needed.');
  }

  // The check that has to come first — see the module note.
  const frames = new Set(
    list
      .map(s => String(s.frameOfReferenceUid ?? '').trim())
      .filter(Boolean)
  );
  if (frames.size > 1) {
    errors.push(
      'The stations do not share a FrameOfReferenceUID, so their coordinates are not comparable and they cannot be composed.'
    );
  } else if (frames.size === 0 && extents.length >= 2) {
    warnings.push(
      'No FrameOfReferenceUID on any station — the composition assumes their positions share a frame.'
    );
  }

  const ordered = [...extents].sort((a, b) => a.startMm - b.startMm);

  const overlaps: OverlapRegion[] = [];
  const gaps: StitchPlan['gaps'] = [];
  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    const overlap = overlapOf(previous, current);
    if (overlap) {
      overlaps.push(overlap);
    } else {
      const lengthMm = current.startMm - previous.endMm;
      gaps.push({
        afterUid: previous.seriesInstanceUid,
        beforeUid: current.seriesInstanceUid,
        lengthMm,
      });
      // A gap is not fatal — the composite simply has nothing there — but it must be
      // said, because a MIP through a gap looks like an occluded vessel.
      warnings.push(
        `${lengthMm.toFixed(1)} mm gap between stations; a MIP across it will look like an occlusion.`
      );
    }
  }

  const spacings = ordered.map(e => e.sliceSpacingMm).filter(s => s > 0);
  const outputSpacingMm = spacings.length ? Math.min(...spacings) : 1;
  const startMm = ordered.length ? ordered[0].startMm : 0;
  const endMm = ordered.length ? Math.max(...ordered.map(e => e.endMm)) : 0;
  const totalLengthMm = Math.max(0, endMm - startMm);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    ordered,
    overlaps,
    gaps,
    totalLengthMm,
    outputSpacingMm,
    outputSlices: outputSpacingMm > 0 ? Math.floor(totalLengthMm / outputSpacingMm) + 1 : 0,
  };
}

/**
 * Blend weight for the **upper** station at position `zMm`, in [0, 1].
 *
 * A linear ramp across the overlap. Outside the overlap the answer is 0 or 1, so a
 * caller can use this everywhere without special-casing.
 *
 * Linear rather than a smoothstep on purpose: a smooth curve keeps the two stations
 * nearly 50/50 across most of the overlap, which doubles the noise where the ramp is
 * flattest. Linear spends the least distance at the noisiest mix.
 */
export function blendWeightAt(overlap: OverlapRegion | null | undefined, zMm: number): number {
  const z = Number(zMm);
  if (!overlap || !Number.isFinite(z)) {
    return 0;
  }
  const span = overlap.endMm - overlap.startMm;
  if (!(span > 0)) {
    // A degenerate overlap is a hard cut; ramping over zero distance is undefined.
    return z >= overlap.endMm ? 1 : 0;
  }
  if (z <= overlap.startMm) {
    return 0;
  }
  if (z >= overlap.endMm) {
    return 1;
  }
  return (z - overlap.startMm) / span;
}

/**
 * Which station(s) contribute at a given z, with their weights.
 *
 * Returns at most two: stations are ordered along z and only consecutive ones overlap in
 * a stepping acquisition. Empty inside a gap, which is the honest answer — there is no
 * data there.
 */
export function contributionsAt(
  plan: StitchPlan,
  zMm: number
): Array<{ seriesInstanceUid: string; weight: number }> {
  const z = Number(zMm);
  if (!plan?.ordered?.length || !Number.isFinite(z)) {
    return [];
  }

  const covering = plan.ordered.filter(e => z >= e.startMm && z <= e.endMm);
  if (!covering.length) {
    return [];
  }
  if (covering.length === 1) {
    return [{ seriesInstanceUid: covering[0].seriesInstanceUid, weight: 1 }];
  }

  const [lower, upper] = covering;
  const overlap = plan.overlaps.find(
    o => o.lowerUid === lower.seriesInstanceUid && o.upperUid === upper.seriesInstanceUid
  );
  const w = blendWeightAt(overlap, z);
  return [
    { seriesInstanceUid: lower.seriesInstanceUid, weight: 1 - w },
    { seriesInstanceUid: upper.seriesInstanceUid, weight: w },
  ];
}

/** One-line summary for the panel. */
export function describeStitch(plan: StitchPlan): string {
  if (!plan?.ok) {
    return plan?.errors?.[0] ?? 'Cannot compose these stations.';
  }
  const parts = [
    `${plan.ordered.length} stations`,
    `${Math.round(plan.totalLengthMm)} mm`,
    `${plan.outputSlices} slices at ${plan.outputSpacingMm} mm`,
  ];
  if (plan.gaps.length) {
    parts.push(`${plan.gaps.length} gap${plan.gaps.length === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}
