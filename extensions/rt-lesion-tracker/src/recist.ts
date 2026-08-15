/**
 * RECIST 1.1 response assessment — pure core (RTV-10).
 *
 * Every rule here comes from the RECIST 1.1 guideline (Eisenhauer et al., Eur J
 * Cancer 2009;45:228-247). They are transcribed deliberately literally, because the
 * places this goes wrong are all places where "obvious" simplifications are wrong:
 *
 * - **Nodal lesions are measured by SHORT axis, not longest diameter.** A lymph node
 *   is measured across, not along. Summing longest diameters for nodes overstates
 *   every sum of diameters in the study.
 * - **PR is measured against baseline; PD is measured against NADIR.** Not both
 *   against baseline. A patient who shrinks from 100 to 50 and grows back to 70 is
 *   *progressing* (+40% from nadir), even though they are still 30% below baseline.
 * - **PD needs BOTH ≥20% relative growth AND ≥5 mm absolute growth.** Without the
 *   absolute floor, a 4 mm nadir growing to 5 mm is "25% progression" — measurement
 *   noise promoted to a clinical event.
 * - **A node that shrinks below 10 mm short axis counts as resolved for CR**, even
 *   though it is still visible and still measurable.
 *
 * Framework-free and `@ohif/*`-free. Zero-fork per RTV-114.
 */

/** How a lesion is measured. */
export type LesionKind = 'nodal' | 'nonNodal';

/** Target lesions drive the arithmetic; non-target are assessed qualitatively. */
export type LesionCategory = 'target' | 'nonTarget';

/** At most five target lesions in total. */
export const TARGET_MAX_TOTAL = 5;
/** At most two target lesions per organ. */
export const TARGET_MAX_PER_ORGAN = 2;

/** Measurability floors, in mm. */
export const MEASURABLE_NON_NODAL_MM = 10;
export const MEASURABLE_NODAL_SHORT_AXIS_MM = 15;
/** A node below this short axis is considered normal — it counts as resolved. */
export const NODAL_NORMAL_SHORT_AXIS_MM = 10;

/** Partial response: at least a 30% decrease from baseline. */
export const PR_DECREASE_FRACTION = 0.3;
/** Progression: at least a 20% increase from nadir... */
export const PD_INCREASE_FRACTION = 0.2;
/** ...and at least 5 mm in absolute terms. */
export const PD_ABSOLUTE_MM = 5;

export type TargetResponse = 'CR' | 'PR' | 'SD' | 'PD' | 'NE';
export type NonTargetResponse = 'CR' | 'Non-CR/Non-PD' | 'PD' | 'NE';
export type OverallResponse = 'CR' | 'PR' | 'SD' | 'PD' | 'NE';

export interface LesionMeasurement {
  lesionId: string;
  kind: LesionKind;
  /** Longest diameter, mm. What counts for a non-nodal lesion. */
  longestDiameterMm?: number;
  /** Short axis, mm. What counts for a nodal lesion. */
  shortAxisMm?: number;
  /** The lesion could not be assessed at this timepoint. */
  notEvaluable?: boolean;
  /** The lesion is no longer visible. */
  absent?: boolean;
  /** Organ, for the two-per-organ rule. */
  organ?: string;
}

/**
 * The diameter that counts toward the sum, in mm.
 *
 * Short axis for nodal, longest diameter for everything else. An absent lesion
 * contributes 0. A measurement with no usable number returns `NaN`, which
 * {@link sumOfDiameters} turns into a not-evaluable sum rather than silently
 * dropping the lesion.
 */
export function recistDiameterMm(measurement: LesionMeasurement): number {
  if (!measurement) {
    return NaN;
  }
  if (measurement.absent) {
    return 0;
  }
  const value =
    measurement.kind === 'nodal' ? measurement.shortAxisMm : measurement.longestDiameterMm;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/** Whether a lesion qualifies as measurable at baseline. */
export function isMeasurable(measurement: LesionMeasurement): boolean {
  const value = recistDiameterMm(measurement);
  if (!Number.isFinite(value)) {
    return false;
  }
  return measurement.kind === 'nodal'
    ? value >= MEASURABLE_NODAL_SHORT_AXIS_MM
    : value >= MEASURABLE_NON_NODAL_MM;
}

export interface SumOfDiameters {
  /** Sum in mm, or `null` when the timepoint is not evaluable. */
  mm: number | null;
  notEvaluable: boolean;
  /** Lesion ids that made the sum not evaluable. */
  blockedBy: string[];
}

/**
 * Sum of diameters for a set of target lesions.
 *
 * One lesion that cannot be assessed makes the whole sum not evaluable — dropping it
 * and summing the rest would compare a 4-lesion sum against a 5-lesion baseline and
 * manufacture a response.
 */
export function sumOfDiameters(measurements: LesionMeasurement[]): SumOfDiameters {
  const list = (measurements ?? []).filter(Boolean);
  const blockedBy: string[] = [];
  let total = 0;

  for (const measurement of list) {
    if (measurement.notEvaluable) {
      blockedBy.push(measurement.lesionId);
      continue;
    }
    const value = recistDiameterMm(measurement);
    if (!Number.isFinite(value)) {
      blockedBy.push(measurement.lesionId);
      continue;
    }
    total += value;
  }

  if (blockedBy.length || !list.length) {
    return { mm: null, notEvaluable: true, blockedBy };
  }
  return { mm: round1(total), notEvaluable: false, blockedBy };
}

export interface TargetSelectionIssue {
  code: 'tooMany' | 'tooManyInOrgan' | 'notMeasurable';
  message: string;
  lesionIds: string[];
}

/**
 * Validates a baseline target selection against the 5-total / 2-per-organ /
 * measurability rules. Returns issues rather than throwing: the reader is mid-selection
 * and needs guidance, not an exception.
 */
export function validateTargetSelection(measurements: LesionMeasurement[]): TargetSelectionIssue[] {
  const list = (measurements ?? []).filter(Boolean);
  const issues: TargetSelectionIssue[] = [];

  if (list.length > TARGET_MAX_TOTAL) {
    issues.push({
      code: 'tooMany',
      message: `RECIST 1.1 allows at most ${TARGET_MAX_TOTAL} target lesions; ${list.length} selected.`,
      lesionIds: list.slice(TARGET_MAX_TOTAL).map(l => l.lesionId),
    });
  }

  const byOrgan = new Map<string, string[]>();
  for (const measurement of list) {
    const organ = (measurement.organ ?? '').trim().toLowerCase();
    if (!organ) {
      continue;
    }
    byOrgan.set(organ, [...(byOrgan.get(organ) ?? []), measurement.lesionId]);
  }
  for (const [organ, ids] of byOrgan) {
    if (ids.length > TARGET_MAX_PER_ORGAN) {
      issues.push({
        code: 'tooManyInOrgan',
        message: `At most ${TARGET_MAX_PER_ORGAN} target lesions per organ; ${ids.length} in ${organ}.`,
        lesionIds: ids.slice(TARGET_MAX_PER_ORGAN),
      });
    }
  }

  const unmeasurable = list.filter(m => !isMeasurable(m));
  if (unmeasurable.length) {
    issues.push({
      code: 'notMeasurable',
      message: `Below the measurability floor (${MEASURABLE_NON_NODAL_MM} mm, or ${MEASURABLE_NODAL_SHORT_AXIS_MM} mm short axis for nodes).`,
      lesionIds: unmeasurable.map(l => l.lesionId),
    });
  }

  return issues;
}

export interface TargetAssessmentInput {
  measurements: LesionMeasurement[];
  /** Sum at baseline, mm. */
  baselineSumMm: number;
  /**
   * Smallest sum recorded so far, mm — including baseline. PD is measured against
   * this, not against baseline.
   */
  nadirSumMm: number;
}

export interface TargetAssessment {
  response: TargetResponse;
  sum: SumOfDiameters;
  /** Change from baseline, as a fraction (-0.3 = 30% smaller). */
  changeFromBaseline: number | null;
  /** Change from nadir, as a fraction. */
  changeFromNadir: number | null;
  /** Absolute change from nadir, mm. */
  absoluteChangeFromNadirMm: number | null;
  /** Plain-language reason for the classification. */
  rationale: string;
}

/**
 * Classifies the target-lesion response at one timepoint.
 *
 * Order matters and is not arbitrary: **CR, then PD, then PR, then SD**. A patient can
 * satisfy PR against baseline and PD against nadir at the same time (baseline 100,
 * nadir 50, now 70 — 30% below baseline, 40% above nadir); RECIST calls that
 * progression.
 */
export function assessTarget(input: TargetAssessmentInput): TargetAssessment {
  const measurements = (input?.measurements ?? []).filter(Boolean);
  const sum = sumOfDiameters(measurements);

  if (sum.notEvaluable || sum.mm == null) {
    return {
      response: 'NE',
      sum,
      changeFromBaseline: null,
      changeFromNadir: null,
      absoluteChangeFromNadirMm: null,
      rationale: sum.blockedBy.length
        ? `Not evaluable: ${sum.blockedBy.join(', ')} could not be measured.`
        : 'Not evaluable: no target lesions recorded.',
    };
  }

  const baseline = Number(input?.baselineSumMm);
  const nadir = Number(input?.nadirSumMm);
  const current = sum.mm;

  const changeFromBaseline =
    Number.isFinite(baseline) && baseline > 0 ? (current - baseline) / baseline : null;
  const changeFromNadir = Number.isFinite(nadir) && nadir > 0 ? (current - nadir) / nadir : null;
  const absoluteChangeFromNadirMm = Number.isFinite(nadir) ? round1(current - nadir) : null;

  const base = {
    sum,
    changeFromBaseline,
    changeFromNadir,
    absoluteChangeFromNadirMm,
  };

  // CR: every target lesion gone, and every node down to a normal short axis.
  // A node at 8 mm is still visible and still measurable, but RECIST counts it
  // as resolved.
  const allResolved = measurements.every(m =>
    m.kind === 'nodal'
      ? m.absent || Number(m.shortAxisMm) < NODAL_NORMAL_SHORT_AXIS_MM
      : !!m.absent || recistDiameterMm(m) === 0
  );
  if (allResolved) {
    return {
      ...base,
      response: 'CR',
      rationale: 'All target lesions resolved (nodes below 10 mm short axis).',
    };
  }

  // PD: relative AND absolute growth from nadir. Both, not either — otherwise a
  // 4 mm nadir growing to 5 mm reads as 25% progression.
  if (
    changeFromNadir != null &&
    absoluteChangeFromNadirMm != null &&
    changeFromNadir >= PD_INCREASE_FRACTION &&
    absoluteChangeFromNadirMm >= PD_ABSOLUTE_MM
  ) {
    return {
      ...base,
      response: 'PD',
      rationale: `${percent(changeFromNadir)} above nadir (+${absoluteChangeFromNadirMm} mm).`,
    };
  }

  if (changeFromBaseline != null && changeFromBaseline <= -PR_DECREASE_FRACTION) {
    return {
      ...base,
      response: 'PR',
      rationale: `${percent(Math.abs(changeFromBaseline))} below baseline.`,
    };
  }

  return {
    ...base,
    response: 'SD',
    rationale: 'Neither enough shrinkage for PR nor enough growth for PD.',
  };
}

export interface NonTargetInput {
  /** Every non-target lesion has disappeared (and nodes are normal). */
  allResolved?: boolean;
  /** Unequivocal progression of existing non-target disease. */
  unequivocalProgression?: boolean;
  /** At least one non-target lesion could not be assessed. */
  notEvaluable?: boolean;
  /** There are non-target lesions at all. */
  present?: boolean;
}

/**
 * Non-target assessment. Qualitative by design — RECIST does not measure these.
 *
 * Progression wins over not-evaluable: unequivocal progression is a clinical finding
 * that does not become uncertain because a different lesion was missed.
 */
export function assessNonTarget(input: NonTargetInput = {}): NonTargetResponse {
  if (input.present === false) {
    // No non-target disease at baseline: nothing to progress, nothing to resolve.
    return 'CR';
  }
  if (input.unequivocalProgression) {
    return 'PD';
  }
  if (input.notEvaluable) {
    return 'NE';
  }
  if (input.allResolved) {
    return 'CR';
  }
  return 'Non-CR/Non-PD';
}

export interface OverallInput {
  target: TargetResponse;
  nonTarget: NonTargetResponse;
  newLesions?: boolean;
}

/**
 * The RECIST 1.1 overall-response table (guideline table 'Time point response:
 * patients with target (+/- non-target) disease').
 *
 * Written as explicit rules rather than a lookup so each row carries its reason. The
 * two that trip people up: **CR target + non-CR/non-PD non-target is PR, not CR**, and
 * **any new lesion is PD regardless of everything else**.
 */
export function overallResponse(input: OverallInput): { response: OverallResponse; rationale: string } {
  const { target, nonTarget } = input ?? ({} as OverallInput);

  if (input?.newLesions) {
    return { response: 'PD', rationale: 'New lesions.' };
  }
  if (target === 'PD') {
    return { response: 'PD', rationale: 'Target lesions progressed.' };
  }
  if (nonTarget === 'PD') {
    return { response: 'PD', rationale: 'Unequivocal progression of non-target disease.' };
  }

  if (target === 'CR') {
    if (nonTarget === 'CR') {
      return { response: 'CR', rationale: 'Everything resolved.' };
    }
    // Residual non-target disease keeps this out of CR.
    return {
      response: 'PR',
      rationale:
        nonTarget === 'NE'
          ? 'Target complete, non-target not evaluable.'
          : 'Target complete, non-target disease persists.',
    };
  }

  if (target === 'PR') {
    return { response: 'PR', rationale: 'Target lesions shrank by at least 30%.' };
  }
  if (target === 'SD') {
    return { response: 'SD', rationale: 'Stable disease.' };
  }

  return { response: 'NE', rationale: 'Target lesions not evaluable.' };
}

export interface Timepoint {
  id: string;
  /** ISO date, for ordering and display. */
  date?: string;
  measurements: LesionMeasurement[];
  nonTarget?: NonTargetInput;
  newLesions?: boolean;
}

export interface TimepointResult {
  id: string;
  date?: string;
  sum: SumOfDiameters;
  /** Smallest evaluable sum up to and including this timepoint. */
  nadirMm: number | null;
  target: TargetAssessment;
  nonTarget: NonTargetResponse;
  overall: OverallResponse;
  rationale: string;
  isBaseline: boolean;
}

/**
 * Walks a study's timepoints in order, carrying baseline and nadir forward.
 *
 * The nadir is the smallest **evaluable** sum seen so far, baseline included. A
 * not-evaluable timepoint neither sets nor resets it — an unmeasurable scan is missing
 * information, not evidence of shrinkage.
 */
export function assessTimepoints(timepoints: Timepoint[]): TimepointResult[] {
  const list = (timepoints ?? []).filter(Boolean);
  const results: TimepointResult[] = [];

  let baselineMm: number | null = null;
  let nadirMm: number | null = null;

  for (const [index, timepoint] of list.entries()) {
    const sum = sumOfDiameters(timepoint.measurements ?? []);
    const isBaseline = index === 0;

    if (sum.mm != null) {
      if (baselineMm == null) {
        baselineMm = sum.mm;
      }
      nadirMm = nadirMm == null ? sum.mm : Math.min(nadirMm, sum.mm);
    }

    const target = isBaseline
      ? {
          response: (sum.notEvaluable ? 'NE' : 'SD') as TargetResponse,
          sum,
          changeFromBaseline: sum.mm == null ? null : 0,
          changeFromNadir: sum.mm == null ? null : 0,
          absoluteChangeFromNadirMm: sum.mm == null ? null : 0,
          rationale: sum.notEvaluable ? 'Baseline not evaluable.' : 'Baseline.',
        }
      : assessTarget({
          measurements: timepoint.measurements ?? [],
          baselineSumMm: baselineMm ?? NaN,
          nadirSumMm: nadirMm ?? NaN,
        });

    const nonTarget = assessNonTarget(timepoint.nonTarget ?? {});
    const overall = isBaseline
      ? { response: 'NE' as OverallResponse, rationale: 'Baseline — no response yet.' }
      : overallResponse({
          target: target.response,
          nonTarget,
          newLesions: timepoint.newLesions,
        });

    results.push({
      id: timepoint.id,
      date: timepoint.date,
      sum,
      nadirMm,
      target,
      nonTarget,
      overall: overall.response,
      rationale: overall.rationale,
      isBaseline,
    });
  }

  return results;
}

/** Human label for a response code. */
export const RESPONSE_LABELS: Record<OverallResponse, string> = {
  CR: 'Complete response',
  PR: 'Partial response',
  SD: 'Stable disease',
  PD: 'Progressive disease',
  NE: 'Not evaluable',
};

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function percent(fraction: number): string {
  return `${Math.round(Math.abs(fraction) * 100)}%`;
}
