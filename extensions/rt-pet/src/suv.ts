/**
 * SUV and SUL — pure core (RTV-198).
 *
 * The standardised uptake value is the number every PET report is built on, and it is
 * arithmetic anyone can write in an afternoon. What takes longer is the set of things that
 * make two SUVs from the same patient incomparable, which is most of this file.
 *
 * ```
 * SUV_bw = C(t) · weight / (injected dose decay-corrected to scan time)
 * ```
 *
 * ## Uptake time is the biggest single source of false change
 *
 * FDG keeps accumulating in tumour long after it has plateaued in normal tissue. An SUV
 * measured at 90 minutes is meaningfully higher than the same lesion at 60 minutes — with
 * no biological change at all. A follow-up scanned late shows progression that is the
 * clock, not the disease, and a follow-up scanned early shows response.
 *
 * PERCIST's answer is a hard rule: the two scans must be within 15 minutes of each other
 * in uptake time. {@link compareUptakeTimes} implements that as a refusal, not a note,
 * because this is the failure that changes management most often and it is completely
 * invisible in the images.
 *
 * ## SUV by body weight is biased by fat, so response criteria use lean body mass
 *
 * Adipose tissue takes up almost no FDG, so dividing by total weight makes a heavy
 * patient's SUV read high everywhere. Worse for follow-up: a patient who **gains 8 kg**
 * during chemotherapy shows an SUV rise with no change in the tumour.
 *
 * PERCIST therefore uses SUL, normalised to lean body mass. {@link suvLeanBodyMass} is
 * what response assessment must call; {@link suvBodyWeight} exists because reports still
 * quote it, and both carry which one they are.
 *
 * ## Decay correction is to the injection time, and the residual matters
 *
 * The dose that entered the patient is the syringe dose minus what stayed in the syringe.
 * A 5% residual is a 5% error in every SUV in the study, in the same direction — which
 * makes it exactly the kind of error that survives averaging and looks like a real
 * difference between patients.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

/** F-18 half-life, minutes. */
export const F18_HALF_LIFE_MIN = 109.771;

/** PERCIST: the two scans must agree in uptake time to within this. */
export const UPTAKE_TIME_TOLERANCE_MIN = 15;

/** Uptake times outside this band are outside what the reference values were built on. */
export const UPTAKE_TIME_MIN = 50;
export const UPTAKE_TIME_MAX = 70;

export type SuvKind = 'bodyWeight' | 'leanBodyMass' | 'bodySurfaceArea';
export type Sex = 'male' | 'female';

export interface DoseInput {
  /** Activity drawn into the syringe, MBq. */
  injectedDoseMbq: number;
  /** Activity left in the syringe after injection, MBq. Defaults to 0. */
  residualDoseMbq?: number;
  /** Minutes between injection and the start of the scan. */
  uptakeTimeMin: number;
}

export interface PatientInput {
  weightKg: number;
  heightCm?: number;
  sex?: Sex;
}

export type SuvFailure =
  | 'missingDose'
  | 'missingWeight'
  | 'missingHeight'
  | 'missingSex'
  | 'nonPhysicalUptakeTime';

export interface SuvResult {
  value: number;
  kind: SuvKind;
  /** Decay-corrected net dose actually in the patient, MBq. */
  netDoseMbq: number;
  ok: boolean;
  failure?: SuvFailure;
  reason?: string;
  warnings: string[];
}

/**
 * Dose remaining at scan time, after decay and after the syringe residual.
 *
 * Subtracting the residual before decaying, rather than after, is the right order: the
 * residual never entered the patient and never decayed in them.
 */
export function netDoseAtScan(dose: DoseInput): number {
  const injected = Number(dose?.injectedDoseMbq);
  const residual = Number(dose?.residualDoseMbq) || 0;
  const uptake = Number(dose?.uptakeTimeMin);
  if (!Number.isFinite(injected) || injected <= 0 || !Number.isFinite(uptake) || uptake < 0) {
    return 0;
  }
  const administered = Math.max(0, injected - Math.max(0, residual));
  return administered * Math.pow(0.5, uptake / F18_HALF_LIFE_MIN);
}

/**
 * Janmahasatian lean body mass, kg.
 *
 * Chosen over the older James formula because James is non-monotonic in weight at high
 * BMI — it *decreases* LBM as an obese patient gains weight, which turns into an SUL that
 * rises for a purely mechanical reason in exactly the population SUL exists to fix.
 */
export function leanBodyMassKg(patient: PatientInput): number {
  const weight = Number(patient?.weightKg);
  const height = Number(patient?.heightCm);
  const sex = patient?.sex;
  if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(height) || height <= 0) {
    return 0;
  }
  const bmi = weight / Math.pow(height / 100, 2);
  return sex === 'female'
    ? (9270 * weight) / (8780 + 244 * bmi)
    : (9270 * weight) / (6680 + 216 * bmi);
}

/** DuBois body surface area, m². */
export function bodySurfaceAreaM2(patient: PatientInput): number {
  const weight = Number(patient?.weightKg);
  const height = Number(patient?.heightCm);
  if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(height) || height <= 0) {
    return 0;
  }
  return 0.007184 * Math.pow(weight, 0.425) * Math.pow(height, 0.725);
}

function uptakeWarnings(uptakeTimeMin: number): string[] {
  const uptake = Number(uptakeTimeMin);
  if (!Number.isFinite(uptake)) {
    return [];
  }
  if (uptake < UPTAKE_TIME_MIN || uptake > UPTAKE_TIME_MAX) {
    return [
      `Tempo de captação de ${uptake.toFixed(0)} min fora da janela de ${UPTAKE_TIME_MIN}–${UPTAKE_TIME_MAX} min — os valores de referência não valem.`,
    ];
  }
  return [];
}

const fail = (kind: SuvKind, failure: SuvFailure, reason: string): SuvResult => ({
  value: 0,
  kind,
  netDoseMbq: 0,
  ok: false,
  failure,
  reason,
  warnings: [],
});

/**
 * SUV normalised to total body weight.
 *
 * Quoted in most reports, and the wrong choice for response assessment — see the module
 * note. `kind` travels with the value so a downstream comparison can refuse a mismatch.
 */
export function suvBodyWeight(
  activityConcentrationBqMl: number,
  patient: PatientInput,
  dose: DoseInput
): SuvResult {
  const netDoseMbq = netDoseAtScan(dose);
  if (!(netDoseMbq > 0)) {
    return fail('bodyWeight', 'missingDose', 'Dose injetada ou tempo de captação ausentes.');
  }
  const weight = Number(patient?.weightKg);
  if (!Number.isFinite(weight) || weight <= 0) {
    return fail('bodyWeight', 'missingWeight', 'Peso do paciente ausente.');
  }
  const concentration = Number(activityConcentrationBqMl);
  if (!Number.isFinite(concentration) || concentration < 0) {
    return fail('bodyWeight', 'missingDose', 'Concentração de atividade inválida.');
  }

  // Bq/mL · g / Bq → dimensionless, with weight in g and dose in Bq.
  const value = (concentration * weight * 1000) / (netDoseMbq * 1e6);
  return {
    value,
    kind: 'bodyWeight',
    netDoseMbq,
    ok: true,
    warnings: uptakeWarnings(dose?.uptakeTimeMin),
  };
}

/**
 * SUL — SUV normalised to lean body mass.
 *
 * What PERCIST requires. Refuses without height and sex rather than falling back to body
 * weight: a value silently computed as SUVbw and labelled SUL is the exact confusion this
 * distinction exists to prevent.
 */
export function suvLeanBodyMass(
  activityConcentrationBqMl: number,
  patient: PatientInput,
  dose: DoseInput
): SuvResult {
  if (!Number.isFinite(Number(patient?.heightCm)) || Number(patient?.heightCm) <= 0) {
    return fail('leanBodyMass', 'missingHeight', 'Altura ausente — SUL não pode ser calculado.');
  }
  if (patient?.sex !== 'male' && patient?.sex !== 'female') {
    return fail('leanBodyMass', 'missingSex', 'Sexo ausente — SUL não pode ser calculado.');
  }

  const lbm = leanBodyMassKg(patient);
  if (!(lbm > 0)) {
    return fail('leanBodyMass', 'missingWeight', 'Massa magra não pôde ser estimada.');
  }

  const base = suvBodyWeight(activityConcentrationBqMl, { ...patient, weightKg: lbm }, dose);
  return { ...base, kind: 'leanBodyMass' };
}

export interface UptakeComparison {
  comparable: boolean;
  differenceMin: number;
  message: string;
}

/**
 * Whether two scans' uptake times allow their SUVs to be compared.
 *
 * A refusal rather than a note: this is the failure that changes management most often and
 * it is completely invisible in the images. Nothing in the pictures tells the reader the
 * follow-up was scanned half an hour later.
 */
export function compareUptakeTimes(
  priorMin: number,
  currentMin: number,
  toleranceMin = UPTAKE_TIME_TOLERANCE_MIN
): UptakeComparison {
  const a = Number(priorMin);
  const b = Number(currentMin);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return {
      comparable: false,
      differenceMin: NaN,
      message: 'Tempo de captação não registrado em um dos exames — SUV não comparável.',
    };
  }
  const differenceMin = Math.abs(b - a);
  if (differenceMin <= Math.max(0, Number(toleranceMin) || 0)) {
    return { comparable: true, differenceMin, message: '' };
  }
  return {
    comparable: false,
    differenceMin,
    message:
      `Tempos de captação diferem em ${differenceMin.toFixed(0)} min (limite ${toleranceMin}). ` +
      'O FDG segue acumulando em tumor, então a diferença de SUV seria do relógio e não da doença.',
  };
}

/** Readout line. */
export function describeSuv(result: SuvResult): string {
  if (!result) {
    return '';
  }
  if (!result.ok) {
    return result.reason ?? '';
  }
  const label = result.kind === 'leanBodyMass' ? 'SUL' : 'SUV';
  const warning = result.warnings.length ? ` ${result.warnings.join(' ')}` : '';
  return `${label} ${result.value.toFixed(2)}${warning}`;
}
