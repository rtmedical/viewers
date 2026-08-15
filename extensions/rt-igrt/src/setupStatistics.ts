/**
 * Setup error statistics and the van Herk margin recipe — pure core (RTV-208).
 *
 * A course of IGRT produces a couch correction per fraction per patient. Those numbers are
 * not just a log: aggregated correctly they are the measurement that decides the PTV
 * margin for the whole department.
 *
 * ## Systematic and random are different errors and only one of them is correctable
 *
 * This is the distinction the whole analysis rests on, and it disappears if the shifts are
 * pooled into one standard deviation.
 *
 * - **Systematic (Σ)** — the *mean* of a patient's shifts. It is the same every day: a
 *   preparation error, a mis-set reference mark. It shifts the whole delivered dose
 *   distribution off target, and it is **correctable** — one plan adjustment fixes every
 *   remaining fraction.
 * - **Random (σ)** — the *spread* of a patient's shifts around their own mean. It blurs
 *   the dose distribution rather than moving it, and it is **not correctable**, only
 *   margined.
 *
 * Σ is the standard deviation *of the per-patient means* across the population; σ is the
 * root-mean-square *of the per-patient standard deviations*. Computing one SD over all the
 * shifts thrown together gives a number that is neither, and it is the number a
 * spreadsheet produces by default.
 *
 * ## The margin recipe weights them very differently, and that is the point
 *
 * ```
 * M = 2.5 Σ + 0.7 σ
 * ```
 *
 * Systematic error is weighted **three and a half times** as heavily as random. A
 * department that reduces its random spread and leaves a systematic offset in place has
 * barely moved its required margin — and the recipe says so numerically, which is a much
 * better argument than an assertion. {@link vanHerkMargin} reports the two contributions
 * separately for exactly that reason.
 *
 * ## The recipe assumes things this data may not satisfy
 *
 * It is derived for a 90%/95% dose-population criterion with a Gaussian penumbra and
 * assumes the errors are normally distributed and independent. Small samples, a systematic
 * trend over the course, or a couple of large outliers all break it. {@link marginInputs}
 * reports the sample sizes and flags what it can, rather than emitting a margin from six
 * fractions and one patient as though it meant something.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

/** Coefficient on the systematic term. */
export const VAN_HERK_SYSTEMATIC = 2.5;
/** Coefficient on the random term. */
export const VAN_HERK_RANDOM = 0.7;

/** Below this many patients the population statistics are not meaningful. */
export const MIN_PATIENTS = 10;
/** Below this many fractions per patient the per-patient SD is not meaningful. */
export const MIN_FRACTIONS = 5;

export type Axis = 'vertical' | 'lateral' | 'longitudinal';
export const AXES: Axis[] = ['vertical', 'lateral', 'longitudinal'];

export interface PatientShifts {
  patientId: string;
  /** One measurement per fraction, mm, in one axis. */
  shiftsMm: number[];
}

export interface PatientStatistics {
  patientId: string;
  /** Mean of this patient's shifts — their systematic error, mm. */
  meanMm: number;
  /** SD of this patient's shifts — their random error, mm. */
  sdMm: number;
  fractions: number;
  /** True when there were too few fractions for the SD to mean anything. */
  underSampled: boolean;
}

const finite = (values: unknown): number[] =>
  ((values as unknown[]) ?? []).map(Number).filter(v => Number.isFinite(v));

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Sample standard deviation, n−1. */
export function standardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Per-patient mean and spread. */
export function patientStatistics(patient: PatientShifts): PatientStatistics {
  const shifts = finite(patient?.shiftsMm);
  return {
    patientId: String(patient?.patientId ?? ''),
    meanMm: mean(shifts),
    sdMm: standardDeviation(shifts),
    fractions: shifts.length,
    underSampled: shifts.length < MIN_FRACTIONS,
  };
}

export interface PopulationStatistics {
  /** Σ — SD of the per-patient means, mm. Systematic, correctable. */
  sigmaSystematicMm: number;
  /** σ — RMS of the per-patient SDs, mm. Random, not correctable. */
  sigmaRandomMm: number;
  /** Overall mean of the per-patient means — a residual group systematic. */
  groupMeanMm: number;
  patients: number;
  /** Patients whose fraction count was too low for their SD to be meaningful. */
  underSampledPatients: string[];
  ok: boolean;
  warnings: string[];
}

/**
 * Population Σ and σ.
 *
 * Σ is the SD **of the means**, σ is the RMS **of the SDs**. One standard deviation over
 * all the shifts pooled together is neither of these — and it is what a spreadsheet
 * produces by default, which is why the two are computed separately here and never from
 * a flat list.
 */
export function populationStatistics(patients: PatientShifts[]): PopulationStatistics {
  const stats = (patients ?? []).filter(Boolean).map(patientStatistics).filter(s => s.fractions > 0);
  const warnings: string[] = [];

  if (!stats.length) {
    return {
      sigmaSystematicMm: 0,
      sigmaRandomMm: 0,
      groupMeanMm: 0,
      patients: 0,
      underSampledPatients: [],
      ok: false,
      warnings: ['Sem dados de deslocamento.'],
    };
  }

  const means = stats.map(s => s.meanMm);
  const sds = stats.filter(s => !s.underSampled).map(s => s.sdMm);
  const underSampledPatients = stats.filter(s => s.underSampled).map(s => s.patientId);

  if (stats.length < MIN_PATIENTS) {
    warnings.push(
      `Apenas ${stats.length} pacientes — abaixo de ${MIN_PATIENTS}, Σ é uma estimativa ruim da população.`
    );
  }
  if (underSampledPatients.length) {
    warnings.push(
      `${underSampledPatients.length} paciente(s) com menos de ${MIN_FRACTIONS} frações foram excluídos do cálculo de σ.`
    );
  }
  if (!sds.length) {
    warnings.push('Nenhum paciente com frações suficientes para estimar o erro aleatório.');
  }

  const sigmaRandomMm = sds.length
    ? Math.sqrt(sds.reduce((sum, sd) => sum + sd * sd, 0) / sds.length)
    : 0;

  return {
    sigmaSystematicMm: standardDeviation(means),
    sigmaRandomMm,
    groupMeanMm: mean(means),
    patients: stats.length,
    underSampledPatients,
    ok: true,
    warnings,
  };
}

export interface MarginResult {
  marginMm: number;
  /** Contribution of the systematic term, mm. */
  systematicContributionMm: number;
  /** Contribution of the random term, mm. */
  randomContributionMm: number;
  /** Share of the margin driven by systematic error, 0..1. */
  systematicShare: number;
  warnings: string[];
  ok: boolean;
}

/**
 * `M = 2.5 Σ + 0.7 σ`.
 *
 * The two contributions are returned separately because the ratio is the actionable part:
 * systematic error is weighted three and a half times as heavily, so a department chasing
 * its random spread while leaving a systematic offset in place has barely moved its
 * margin. The recipe says so numerically, which argues better than an assertion.
 */
export function vanHerkMargin(
  statistics: PopulationStatistics,
  coefficients: { systematic?: number; random?: number } = {}
): MarginResult {
  const a = positiveOr(coefficients.systematic, VAN_HERK_SYSTEMATIC);
  const b = positiveOr(coefficients.random, VAN_HERK_RANDOM);

  if (!statistics?.ok) {
    return {
      marginMm: 0,
      systematicContributionMm: 0,
      randomContributionMm: 0,
      systematicShare: 0,
      warnings: statistics?.warnings ?? ['Estatísticas indisponíveis.'],
      ok: false,
    };
  }

  const systematicContributionMm = a * statistics.sigmaSystematicMm;
  const randomContributionMm = b * statistics.sigmaRandomMm;
  const marginMm = systematicContributionMm + randomContributionMm;

  return {
    marginMm,
    systematicContributionMm,
    randomContributionMm,
    systematicShare: marginMm > 0 ? systematicContributionMm / marginMm : 0,
    warnings: statistics.warnings,
    ok: true,
  };
}

function positiveOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface MarginInputsReport {
  perAxis: Record<Axis, MarginResult>;
  patients: number;
  /** Total fractions across all patients and axes. */
  fractions: number;
  warnings: string[];
}

/**
 * Margins for all three axes at once.
 *
 * Reports the sample sizes alongside, rather than emitting a margin from six fractions and
 * one patient as though it meant something. The recipe is derived for a population; a
 * margin computed from one patient is that patient's history, not a margin.
 */
export function marginInputs(
  byAxis: Record<Axis, PatientShifts[]>
): MarginInputsReport {
  const perAxis = {} as Record<Axis, MarginResult>;
  const warnings: string[] = [];
  let patients = 0;
  let fractions = 0;

  for (const axis of AXES) {
    const stats = populationStatistics(byAxis?.[axis] ?? []);
    perAxis[axis] = vanHerkMargin(stats);
    patients = Math.max(patients, stats.patients);
    fractions += (byAxis?.[axis] ?? []).reduce(
      (sum, p) => sum + finite(p?.shiftsMm).length,
      0
    );
    for (const warning of stats.warnings) {
      if (!warnings.includes(warning)) {
        warnings.push(warning);
      }
    }
  }

  return { perAxis, patients, fractions, warnings };
}

/**
 * Whether a systematic offset large enough to correct is present.
 *
 * A group mean that is not zero is a setup process problem, not a margin problem — and
 * adding margin to absorb it delivers dose to healthy tissue every fraction of every
 * patient rather than fixing the reference mark once.
 */
export function groupSystematicAlert(
  statistics: PopulationStatistics,
  thresholdMm = 1
): { present: boolean; message: string } {
  if (!statistics?.ok) {
    return { present: false, message: '' };
  }
  const offset = Math.abs(statistics.groupMeanMm);
  if (offset <= Math.max(0, Number(thresholdMm) || 0)) {
    return { present: false, message: '' };
  }
  return {
    present: true,
    message:
      `Desvio sistemático de grupo de ${statistics.groupMeanMm.toFixed(1)} mm — isso é um problema do processo de setup, ` +
      'não de margem. Absorvê-lo com margem entrega dose a tecido sadio em toda fração de todo paciente.',
  };
}

/** Readout for the margin panel. */
export function describeMargin(result: MarginResult, axis?: Axis): string {
  if (!result?.ok) {
    return result?.warnings?.join(' ') ?? '';
  }
  const label = axis ? `${axis}: ` : '';
  const share = Math.round(result.systematicShare * 100);
  const warnings = result.warnings.length ? ` ${result.warnings.join(' ')}` : '';
  return (
    `${label}margem ${result.marginMm.toFixed(1)} mm ` +
    `(sistemático ${result.systematicContributionMm.toFixed(1)} mm = ${share}%, ` +
    `aleatório ${result.randomContributionMm.toFixed(1)} mm).${warnings}`
  );
}
