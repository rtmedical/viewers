/**
 * Volume doubling time and prior-nodule matching — pure core (RTV-69).
 *
 * ```
 * VDT = (t₂ − t₁) · ln 2 / ln(V₂ / V₁)
 * ```
 *
 * Three lines of arithmetic that decide whether a patient gets a follow-up CT or a
 * biopsy. Everything that matters is in refusing to produce a number when the inputs
 * cannot support one.
 *
 * ## VDT is exquisitely sensitive to measurement error, and small nodules are all error
 *
 * Volume from a single diameter is `V = π/6 · d³`, so a **relative** error in the
 * diameter becomes three times that in the volume. On a 5 mm nodule, the ±1 mm that two
 * radiologists routinely disagree by is a ±60% volume swing — and because VDT depends on
 * `ln(V₂/V₁)`, that swing is *divided into* the interval. Two measurements that are
 * genuinely 6.0 and 6.5 mm can produce a VDT anywhere from ~150 to ~2000 days depending
 * on where the calipers land.
 *
 * A screen showing "VDT = 287 dias" from two caliper readings is false precision, and it
 * is false precision attached to a management decision. So {@link computeVdt} returns a
 * confidence interval derived from a stated measurement uncertainty, and
 * {@link describeVdt} prints the interval, not just the point estimate. When the interval
 * spans the suspicion threshold, the result says the study cannot answer the question —
 * which is the honest output, and the one that leads to "repeat at 3 months" rather than
 * to a wrong confident number.
 *
 * ## A shrinking nodule does not have a doubling time
 *
 * `V₂ < V₁` makes the logarithm negative and VDT negative. A negative doubling time is
 * not "very slow growth"; it is regression, and printing −412 days next to a threshold of
 * 400 invites exactly the wrong reading. `V₂ = V₁` makes it infinite. Both are returned
 * as *outcomes*, not as numbers — see {@link VdtOutcome}.
 *
 * ## Matching a nodule to its prior is where a wrong VDT comes from
 *
 * A VDT computed across two *different* nodules is a number with no meaning and no
 * warning label. Without a deformable registration, the best available match is nearest
 * neighbour in patient coordinates, and {@link matchPriorNodules} therefore
 * **refuses ambiguous matches**: if two priors sit within the tolerance of the same
 * current nodule, neither is chosen. Leaving a nodule unmatched costs the reader one
 * click; matching it to the wrong prior costs them the diagnosis.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

/** Below this, growth is fast enough to be treated as suspicious. Fleischner/Lung-RADS. */
export const VDT_SUSPICIOUS_DAYS = 400;
/** Above this, growth is slow enough to be treated as probably benign. */
export const VDT_BENIGN_DAYS = 600;

/**
 * Default caliper uncertainty, in mm, one standard reading difference.
 *
 * 1 mm is the inter-reader difference reported for solid nodules on thin-slice CT. It is
 * deliberately not smaller: pretending to 0.1 mm would make the confidence interval
 * narrow and useless as a guard.
 */
export const DEFAULT_DIAMETER_UNCERTAINTY_MM = 1;

/**
 * Minimum interval for a growth assessment, in days.
 *
 * A 2% volume change over three weeks is noise. Below this the comparison is refused
 * rather than converted into a very short doubling time, which is what the arithmetic
 * would otherwise happily produce.
 */
export const MIN_INTERVAL_DAYS = 60;

export const DAY_MS = 86_400_000;

export type VdtOutcome =
  | 'growing'
  | 'shrinking'
  | 'stable'
  | 'intervalTooShort'
  | 'invalidInput';

export type VdtSuspicion = 'suspicious' | 'indeterminate' | 'probablyBenign' | 'notApplicable';

export interface NoduleMeasurement {
  /** Mean diameter in mm, or the volume directly when a segmentation produced one. */
  diameterMm?: number;
  /** Segmented volume in mm³. Preferred over the diameter when present. */
  volumeMm3?: number;
  /** Acquisition time, epoch ms. */
  acquiredAt: number;
}

/** Sphere-equivalent volume from a mean diameter. */
export function volumeFromDiameterMm(diameterMm: number): number {
  const d = Number(diameterMm);
  if (!Number.isFinite(d) || d <= 0) {
    return 0;
  }
  return (Math.PI / 6) * d * d * d;
}

export function diameterFromVolumeMm3(volumeMm3: number): number {
  const v = Number(volumeMm3);
  if (!Number.isFinite(v) || v <= 0) {
    return 0;
  }
  return Math.cbrt((6 * v) / Math.PI);
}

/**
 * The volume a measurement stands for.
 *
 * A segmented volume wins over a diameter whenever it is present: it is the measurement
 * VDT actually wants, and converting a diameter to a sphere is the approximation that
 * causes most of the error described in the module note.
 */
export function measurementVolumeMm3(measurement: NoduleMeasurement): number {
  const segmented = Number(measurement?.volumeMm3);
  if (Number.isFinite(segmented) && segmented > 0) {
    return segmented;
  }
  return volumeFromDiameterMm(Number(measurement?.diameterMm));
}

export interface VdtOptions {
  /** Caliper uncertainty in mm, used for the confidence interval. */
  diameterUncertaintyMm?: number;
  suspiciousDays?: number;
  benignDays?: number;
  minIntervalDays?: number;
}

export interface VdtResult {
  outcome: VdtOutcome;
  /**
   * Days. Non-null only when `outcome` is 'growing'.
   *
   * A shrinking nodule deliberately gets `null` rather than the negative number the
   * formula produces — see the module note. The size change is reported through
   * `volumeChangeFraction` instead, which is the quantity that actually means something
   * for a regressing nodule.
   */
  days: number | null;
  /**
   * Bounds implied by the measurement uncertainty. Null when not computable.
   *
   * `upperDays` is `Infinity` when the slow end of the envelope is consistent with no
   * growth — a real and common outcome on small nodules, and the reason the interval is
   * reported at all.
   */
  lowerDays: number | null;
  upperDays: number | null;
  intervalDays: number;
  volumeChangeFraction: number;
  suspicion: VdtSuspicion;
  /**
   * True when the confidence interval straddles the suspicion threshold, i.e. the
   * measurements cannot answer the question that was asked of them.
   */
  inconclusive: boolean;
  message: string;
}

const days = (ms: number): number => ms / DAY_MS;

/**
 * Volume doubling time between two measurements of the same nodule.
 *
 * The confidence interval is built by perturbing **both** diameters by the stated
 * uncertainty in the directions that maximise and minimise the growth ratio. That is a
 * worst-case envelope rather than a statistical CI, which is the right shape here: the
 * question is "could these measurements be consistent with a benign nodule?", and a
 * worst-case answer is the one a reader can act on.
 */
export function computeVdt(
  prior: NoduleMeasurement,
  current: NoduleMeasurement,
  options: VdtOptions = {}
): VdtResult {
  const suspiciousDays = numberOr(options.suspiciousDays, VDT_SUSPICIOUS_DAYS);
  const benignDays = numberOr(options.benignDays, VDT_BENIGN_DAYS);
  const minInterval = numberOr(options.minIntervalDays, MIN_INTERVAL_DAYS);

  const t1 = Number(prior?.acquiredAt);
  const t2 = Number(current?.acquiredAt);
  const v1 = measurementVolumeMm3(prior);
  const v2 = measurementVolumeMm3(current);

  const base: VdtResult = {
    outcome: 'invalidInput',
    days: null,
    lowerDays: null,
    upperDays: null,
    intervalDays: 0,
    volumeChangeFraction: 0,
    suspicion: 'notApplicable',
    inconclusive: false,
    message: '',
  };

  if (!Number.isFinite(t1) || !Number.isFinite(t2) || v1 <= 0 || v2 <= 0) {
    return { ...base, message: 'Medidas insuficientes para calcular VDT.' };
  }

  const intervalDays = days(t2 - t1);
  const changeFraction = (v2 - v1) / v1;

  if (intervalDays <= 0) {
    return {
      ...base,
      intervalDays,
      volumeChangeFraction: changeFraction,
      message: 'O exame atual não é posterior ao prior.',
    };
  }

  if (intervalDays < minInterval) {
    return {
      ...base,
      outcome: 'intervalTooShort',
      intervalDays,
      volumeChangeFraction: changeFraction,
      message: `Intervalo de ${intervalDays.toFixed(0)} dias é curto demais para avaliar crescimento (mínimo ${minInterval}).`,
    };
  }

  if (v2 === v1) {
    return {
      ...base,
      outcome: 'stable',
      intervalDays,
      volumeChangeFraction: 0,
      suspicion: 'notApplicable',
      message: 'Volume inalterado — não há tempo de duplicação definido.',
    };
  }

  const vdt = (intervalDays * Math.LN2) / Math.log(v2 / v1);
  const shrinking = v2 < v1;

  // Envelope: prior read as SMALL as plausible against current read as LARGE as
  // plausible is the fastest growth the measurements admit (shortest VDT); the mirror
  // case is the slowest (longest VDT).
  const uncertainty = Math.max(0, numberOr(options.diameterUncertaintyMm, DEFAULT_DIAMETER_UNCERTAINTY_MM));
  const d1 = diameterFromVolumeMm3(v1);
  const d2 = diameterFromVolumeMm3(v2);
  const fastRatio = ratioOf(d1 - uncertainty, d2 + uncertainty);
  const slowRatio = ratioOf(d1 + uncertainty, d2 - uncertainty);

  const vdtFor = (ratio: number | null): number | null => {
    if (ratio === null || !(ratio > 0)) {
      return null;
    }
    if (ratio <= 1) {
      // The slow end of the envelope is consistent with no growth at all. That is not a
      // missing bound to be dropped — it is the statement "these measurements cannot
      // rule out a stable nodule", and it has to survive into the result.
      return Infinity;
    }
    return (intervalDays * Math.LN2) / Math.log(ratio);
  };

  const lowerDays = vdtFor(fastRatio);
  const upperDays = vdtFor(slowRatio);

  const suspicion = shrinking
    ? 'notApplicable'
    : classifyVdt(vdt, suspiciousDays, benignDays);

  // The interval straddling the threshold means these two measurements cannot answer
  // the question, however precise the point estimate looks.
  const inconclusive =
    !shrinking &&
    lowerDays !== null &&
    upperDays !== null &&
    (lowerDays < suspiciousDays) !== (upperDays < suspiciousDays);
  // An infinite upper bound counts as straddling: `Infinity < threshold` is false, so
  // the comparison above already gets this right, but it is the case that matters most
  // and it is worth naming.

  if (shrinking) {
    // No doubling time, and no confidence interval for one. Reporting -412 days next to
    // a threshold of 400 invites exactly the wrong reading.
    return {
      ...base,
      outcome: 'shrinking',
      intervalDays,
      volumeChangeFraction: changeFraction,
      suspicion: 'notApplicable',
    };
  }

  return {
    outcome: 'growing',
    days: vdt,
    lowerDays,
    upperDays,
    intervalDays,
    volumeChangeFraction: changeFraction,
    suspicion,
    inconclusive,
    message: '',
  };
}

function ratioOf(priorDiameter: number, currentDiameter: number): number | null {
  if (!(priorDiameter > 0) || !(currentDiameter > 0)) {
    return null;
  }
  return Math.pow(currentDiameter / priorDiameter, 3);
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function classifyVdt(
  vdtDays: number,
  suspiciousDays = VDT_SUSPICIOUS_DAYS,
  benignDays = VDT_BENIGN_DAYS
): VdtSuspicion {
  const v = Number(vdtDays);
  if (!Number.isFinite(v) || v <= 0) {
    return 'notApplicable';
  }
  if (v < suspiciousDays) {
    return 'suspicious';
  }
  return v > benignDays ? 'probablyBenign' : 'indeterminate';
}

/**
 * The line the reader sees.
 *
 * Always the interval, never the point estimate alone — the whole argument of this module
 * is that the point estimate on its own is false precision.
 */
export function describeVdt(result: VdtResult): string {
  if (!result) {
    return '';
  }
  switch (result.outcome) {
    case 'invalidInput':
    case 'intervalTooShort':
      return result.message;
    case 'stable':
      return result.message;
    case 'shrinking':
      return `Nódulo regrediu ${Math.abs(result.volumeChangeFraction * 100).toFixed(0)}% em volume em ${result.intervalDays.toFixed(0)} dias — não há tempo de duplicação.`;
    default:
      break;
  }

  const point = `VDT ${result.days!.toFixed(0)} dias`;
  const range = formatRange(result.lowerDays, result.upperDays);
  const verdict = result.inconclusive
    ? ' — intervalo cruza o limiar; estas medidas não respondem à pergunta.'
    : result.suspicion === 'suspicious'
      ? ' — crescimento suspeito.'
      : result.suspicion === 'probablyBenign'
        ? ' — crescimento lento.'
        : ' — indeterminado.';
  return point + range + verdict;
}

/**
 * The bracket text.
 *
 * An unbounded upper end is spelled out rather than printed as a number: it means the
 * measurements are compatible with a nodule that is not growing at all, which is a
 * clinically different statement from "VDT is large".
 */
function formatRange(lower: number | null, upper: number | null): string {
  if (lower === null || upper === null) {
    return '';
  }
  if (!Number.isFinite(upper)) {
    return ` (≥ ${lower.toFixed(0)} dias; as medidas também são compatíveis com ausência de crescimento)`;
  }
  return ` (${lower.toFixed(0)}–${upper.toFixed(0)} pela incerteza de medida)`;
}

export interface TrackedNodule {
  id: string;
  /** Patient coordinates in mm. */
  position: [number, number, number];
  measurement: NoduleMeasurement;
  label?: string;
}

export interface NoduleMatch {
  currentId: string;
  priorId: string;
  distanceMm: number;
}

export interface MatchReport {
  matched: NoduleMatch[];
  /** Current nodules with no acceptable prior. */
  unmatchedCurrent: string[];
  /** Priors nothing matched to — a nodule that resolved, or a miss. */
  unmatchedPrior: string[];
  /** Refused because two priors were equally plausible. */
  ambiguous: Array<{ currentId: string; candidates: string[] }>;
}

/** Default search radius for a prior nodule, in mm. */
export const MATCH_RADIUS_MM = 15;
/**
 * Two candidates whose distances differ by less than this are treated as
 * indistinguishable.
 */
export const MATCH_AMBIGUITY_MM = 5;

const distance = (a: [number, number, number], b: [number, number, number]): number =>
  Math.hypot(Number(a?.[0]) - Number(b?.[0]), Number(a?.[1]) - Number(b?.[1]), Number(a?.[2]) - Number(b?.[2]));

/**
 * Matches current nodules to their priors by proximity.
 *
 * Nearest neighbour in patient coordinates, with two refusals: nothing within
 * `radiusMm`, and two candidates too close to each other to choose between. The second is
 * the important one — a VDT computed across two different nodules is a number with no
 * meaning and no warning label, and leaving it unmatched costs the reader one click.
 *
 * Assumes the two studies share a frame of reference, which for a follow-up chest CT of
 * the same patient on the same scanner is approximately true and is why the radius is
 * generous. A deformable registration would replace this wholesale.
 */
export function matchPriorNodules(
  current: TrackedNodule[],
  prior: TrackedNodule[],
  radiusMm = MATCH_RADIUS_MM,
  ambiguityMm = MATCH_AMBIGUITY_MM
): MatchReport {
  const radius = numberOr(radiusMm, MATCH_RADIUS_MM);
  const ambiguity = numberOr(ambiguityMm, MATCH_AMBIGUITY_MM);
  const currents = (current ?? []).filter(n => n?.id);
  const priors = (prior ?? []).filter(n => n?.id);

  const matched: NoduleMatch[] = [];
  const ambiguous: MatchReport['ambiguous'] = [];
  const unmatchedCurrent: string[] = [];
  const takenPriors = new Set<string>();

  for (const node of currents) {
    const candidates = priors
      .filter(p => !takenPriors.has(p.id))
      .map(p => ({ id: p.id, distanceMm: distance(node.position, p.position) }))
      .filter(c => Number.isFinite(c.distanceMm) && c.distanceMm <= radius)
      .sort((a, b) => a.distanceMm - b.distanceMm);

    if (!candidates.length) {
      unmatchedCurrent.push(node.id);
    } else if (
      candidates.length > 1 &&
      candidates[1].distanceMm - candidates[0].distanceMm < ambiguity
    ) {
      ambiguous.push({ currentId: node.id, candidates: candidates.slice(0, 2).map(c => c.id) });
    } else {
      takenPriors.add(candidates[0].id);
      matched.push({
        currentId: node.id,
        priorId: candidates[0].id,
        distanceMm: candidates[0].distanceMm,
      });
    }
  }

  return {
    matched,
    unmatchedCurrent,
    unmatchedPrior: priors.filter(p => !takenPriors.has(p.id)).map(p => p.id),
    ambiguous,
  };
}

export interface LongitudinalRow {
  currentId: string;
  priorId?: string;
  label?: string;
  priorDiameterMm: number | null;
  currentDiameterMm: number | null;
  vdt: VdtResult | null;
  note: string;
}

/**
 * The longitudinal table: one row per current nodule, matched or not.
 *
 * Unmatched and ambiguous nodules get a row with a note rather than being dropped. A
 * nodule silently missing from a follow-up report is the failure mode this whole feature
 * exists to prevent.
 */
export function buildLongitudinalReport(
  current: TrackedNodule[],
  prior: TrackedNodule[],
  options: VdtOptions = {},
  radiusMm = MATCH_RADIUS_MM
): LongitudinalRow[] {
  const report = matchPriorNodules(current, prior, radiusMm);
  const priorById = new Map((prior ?? []).filter(p => p?.id).map(p => [p.id, p]));
  const matchByCurrent = new Map(report.matched.map(m => [m.currentId, m]));
  const ambiguousByCurrent = new Map(report.ambiguous.map(a => [a.currentId, a]));

  return (current ?? [])
    .filter(n => n?.id)
    .map(node => {
      const currentDiameterMm = diameterOf(node.measurement);
      const match = matchByCurrent.get(node.id);
      if (match) {
        const priorNode = priorById.get(match.priorId)!;
        const vdt = computeVdt(priorNode.measurement, node.measurement, options);
        return {
          currentId: node.id,
          priorId: match.priorId,
          label: node.label,
          priorDiameterMm: diameterOf(priorNode.measurement),
          currentDiameterMm,
          vdt,
          note: describeVdt(vdt),
        };
      }
      const ambiguity = ambiguousByCurrent.get(node.id);
      return {
        currentId: node.id,
        label: node.label,
        priorDiameterMm: null,
        currentDiameterMm,
        vdt: null,
        note: ambiguity
          ? `Dois nódulos prévios igualmente próximos (${ambiguity.candidates.join(', ')}) — pareie manualmente.`
          : 'Sem nódulo prévio correspondente — possivelmente novo.',
      };
    });
}

function diameterOf(measurement: NoduleMeasurement): number | null {
  const volume = measurementVolumeMm3(measurement);
  return volume > 0 ? diameterFromVolumeMm3(volume) : null;
}
