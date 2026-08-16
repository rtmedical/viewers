/**
 * Carotid stenosis quantification — pure core (RTV-54).
 *
 * The segmentation is a sidecar. This is the part that turns a lumen into a percentage, and
 * the percentage is the number that sends a patient to endarterectomy or does not.
 *
 * ## The same lesion is 70% by one method and 85% by the other
 *
 * NASCET divides the residual lumen by the **distal normal internal carotid**. ECST divides
 * it by the **estimated original diameter at the bulb**, which is much wider. They are not
 * two estimates of one quantity; they are two different quantities, and the trial
 * thresholds belong to the trial that produced them. A 70% ECST is roughly a 50% NASCET and
 * does not meet the surgical threshold that 70% appears to meet.
 *
 * So the method is a required field, {@link convertBetweenMethods} exists to make the gap
 * visible rather than to make the numbers interchangeable, and {@link surgicalThreshold}
 * refuses to grade a percentage against the other method's cut-off.
 *
 * ## Near-occlusion is a category, not a large percentage
 *
 * This is the failure that matters most. When the stenosis is severe enough to collapse the
 * distal internal carotid, NASCET's denominator shrinks with the numerator — and the
 * computed percentage **falls**. A vessel that is nearly closed can compute as 50%, and
 * every downstream rule reads that as moderate disease.
 *
 * The formula does not break loudly. It returns a plausible, moderate number for the most
 * severe lesion on the list. {@link assessStenosis} looks at the distal calibre and the
 * side-to-side difference and refuses to report a percentage when the reference segment is
 * itself collapsed.
 *
 * ## Area stenosis and diameter stenosis are different numbers
 *
 * CTA makes area easy to compute and the trials measured diameter. For a concentric plaque
 * a 50% diameter reduction is a 75% area reduction, and the larger number is the one that
 * looks alarming in a report. {@link areaToDiameterStenosis} converts under the stated
 * assumption of a circular lumen, and says that eccentric plaque breaks it.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type StenosisMethod = 'nascet' | 'ecst';

export const METHOD_LABELS: Record<StenosisMethod, string> = {
  nascet: 'NASCET (referência: carótida interna distal normal)',
  ecst: 'ECST (referência: diâmetro original estimado do bulbo)',
};

/** Surgical thresholds, percent, by method and symptom status. */
export const SURGICAL_THRESHOLD: Record<StenosisMethod, { symptomatic: number; asymptomatic: number }> = {
  nascet: { symptomatic: 70, asymptomatic: 60 },
  // The ECST equivalents of the NASCET thresholds, not independent numbers.
  ecst: { symptomatic: 82, asymptomatic: 76 },
};

/** A distal internal carotid below this is collapsed rather than normal, millimetres. */
export const COLLAPSED_DISTAL_MM = 2.5;
/** Side-to-side distal calibre difference above this suggests distal collapse, as a fraction. */
export const DISTAL_ASYMMETRY_FRACTION = 0.3;

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

export interface StenosisInput {
  /** Narrowest residual lumen diameter, millimetres. */
  minLumenMm: number;
  /** Reference diameter for the chosen method, millimetres. */
  referenceMm: number;
  method: StenosisMethod;
  /** Contralateral distal internal carotid, when measured. Used to spot distal collapse. */
  contralateralDistalMm?: number;
  /** Whether the reference measurement is the distal ICA (true for NASCET). */
  referenceIsDistalIca?: boolean;
}

export type StenosisCategory =
  | 'none'
  | 'mild'
  | 'moderate'
  | 'severe'
  | 'near-occlusion'
  | 'occluded'
  | 'indeterminate';

export const CATEGORY_LABELS: Record<StenosisCategory, string> = {
  none: 'sem estenose significativa',
  mild: 'leve',
  moderate: 'moderada',
  severe: 'grave',
  'near-occlusion': 'quase-oclusão',
  occluded: 'ocluída',
  indeterminate: 'indeterminada',
};

export interface StenosisResult {
  /** Null when the measurement cannot support one. */
  percent: number | null;
  method: StenosisMethod;
  category: StenosisCategory;
  warnings: string[];
  ok: boolean;
  message: string;
}

/**
 * Percentage stenosis, or a refusal.
 *
 * Refuses when the distal reference is itself collapsed. The arithmetic would still
 * produce a number — a moderate-looking one, for the most severe lesion in the series.
 */
export function assessStenosis(input: StenosisInput): StenosisResult {
  const minLumen = num(input?.minLumenMm);
  const reference = num(input?.referenceMm);
  const method = input?.method;
  const warnings: string[] = [];

  if (!METHOD_LABELS[method]) {
    return {
      percent: null,
      method: 'nascet',
      category: 'indeterminate',
      warnings,
      ok: false,
      message: 'Método de medida não informado — 70% por um método é 50% pelo outro.',
    };
  }
  if (!Number.isFinite(minLumen) || minLumen < 0) {
    return { percent: null, method, category: 'indeterminate', warnings, ok: false, message: 'Luz residual não medida.' };
  }
  if (!(reference > 0)) {
    return { percent: null, method, category: 'indeterminate', warnings, ok: false, message: 'Diâmetro de referência ausente.' };
  }
  if (minLumen === 0) {
    return {
      percent: 100,
      method,
      category: 'occluded',
      warnings,
      ok: true,
      message: 'Sem luz residual — vaso ocluído.',
    };
  }
  if (minLumen > reference) {
    warnings.push(
      'Luz residual maior que a referência: a referência provavelmente não está num segmento normal.'
    );
  }

  // The reference-collapse check has to come before the arithmetic, because the arithmetic
  // is what hides the problem.
  const distalIsReference = input.referenceIsDistalIca ?? method === 'nascet';
  if (distalIsReference) {
    const contralateral = num(input?.contralateralDistalMm);
    const asymmetric =
      Number.isFinite(contralateral) &&
      contralateral > 0 &&
      (contralateral - reference) / contralateral > DISTAL_ASYMMETRY_FRACTION;

    if (reference < COLLAPSED_DISTAL_MM || asymmetric) {
      return {
        percent: null,
        method,
        category: 'near-occlusion',
        warnings,
        ok: false,
        message:
          `Carótida interna distal com ${reference.toFixed(1)} mm` +
          (asymmetric ? `, contra ${contralateral.toFixed(1)} mm do lado oposto` : '') +
          '. O segmento de referência está colabado, e é aí que a fórmula falha em silêncio: ' +
          'o denominador encolhe junto com o numerador e a porcentagem CAI. Um vaso quase fechado calcula como estenose moderada. ' +
          'Quase-oclusão é uma categoria, não uma porcentagem alta.',
      };
    }
  }

  const percent = Math.max(0, (1 - minLumen / reference) * 100);
  const category = categorise(percent, method);

  return {
    percent,
    method,
    category,
    warnings,
    ok: true,
    message: `${percent.toFixed(0)}% por ${METHOD_LABELS[method]} — ${CATEGORY_LABELS[category]}.`,
  };
}

function categorise(percent: number, method: StenosisMethod): StenosisCategory {
  // Bands expressed in NASCET terms and converted, so one set of clinical boundaries drives
  // both scales rather than two lists drifting apart.
  const nascet = method === 'nascet' ? percent : ecstToNascet(percent);
  if (nascet < 30) {
    return 'none';
  }
  if (nascet < 50) {
    return 'mild';
  }
  if (nascet < 70) {
    return 'moderate';
  }
  return 'severe';
}

/** ECST ≈ 0.6 × NASCET + 40. */
export function nascetToEcst(nascetPercent: number): number {
  return 0.6 * num(nascetPercent) + 40;
}

export function ecstToNascet(ecstPercent: number): number {
  return (num(ecstPercent) - 40) / 0.6;
}

export interface MethodComparison {
  nascetPercent: number;
  ecstPercent: number;
  message: string;
}

/**
 * The same lesion on both scales.
 *
 * Exists to make the gap visible, not to make the two interchangeable: the conversion is a
 * population regression, and using it to report a NASCET figure the study never measured
 * puts a derived number where a measurement belongs.
 */
export function convertBetweenMethods(percent: number, method: StenosisMethod): MethodComparison {
  const value = num(percent);
  const nascetPercent = method === 'nascet' ? value : ecstToNascet(value);
  const ecstPercent = method === 'ecst' ? value : nascetToEcst(value);
  return {
    nascetPercent,
    ecstPercent,
    message:
      `${value.toFixed(0)}% ${method.toUpperCase()} equivale a cerca de ${(method === 'nascet' ? ecstPercent : nascetPercent).toFixed(0)}% ` +
      `${method === 'nascet' ? 'ECST' : 'NASCET'}. A conversão é uma regressão populacional e serve para mostrar a diferença, ` +
      'não para relatar um número que o exame não mediu.',
  };
}

export interface ThresholdResult {
  meets: boolean;
  thresholdPercent: number;
  applicable: boolean;
  message: string;
}

/**
 * Whether the stenosis meets the surgical threshold.
 *
 * The threshold belongs to the method. Grading an ECST percentage against the NASCET
 * cut-off refers a patient whose NASCET stenosis is around fifty percent.
 */
export function surgicalThreshold(
  result: StenosisResult,
  symptomatic: boolean
): ThresholdResult {
  const thresholdPercent = SURGICAL_THRESHOLD[result.method][symptomatic ? 'symptomatic' : 'asymptomatic'];

  if (result.category === 'near-occlusion') {
    return {
      meets: false,
      thresholdPercent,
      applicable: false,
      message:
        'Quase-oclusão: o limiar percentual não se aplica, e o benefício da endarterectomia nesse subgrupo é diferente do da estenose grave comum. Decisão clínica, não aritmética.',
    };
  }
  if (result.category === 'occluded') {
    return {
      meets: false,
      thresholdPercent,
      applicable: false,
      message: 'Vaso ocluído — não há estenose a operar.',
    };
  }
  if (result.percent === null) {
    return { meets: false, thresholdPercent, applicable: false, message: result.message };
  }

  const meets = result.percent >= thresholdPercent;
  return {
    meets,
    thresholdPercent,
    applicable: true,
    message:
      `${result.percent.toFixed(0)}% contra o limiar de ${thresholdPercent}% para ${symptomatic ? 'sintomático' : 'assintomático'} ` +
      `em ${result.method.toUpperCase()} — ${meets ? 'atinge' : 'não atinge'}.`,
  };
}

export interface AreaConversion {
  diameterPercent: number;
  areaPercent: number;
  message: string;
}

/**
 * Area stenosis to diameter stenosis, under a circular-lumen assumption.
 *
 * CTA makes area easy and the trials measured diameter. A 50% diameter reduction is a 75%
 * area reduction, and the larger number is the one that reads as alarming — so quoting an
 * area percentage next to a diameter threshold overstates the lesion by a wide margin.
 */
export function areaToDiameterStenosis(areaPercent: number): AreaConversion {
  const area = Math.min(100, Math.max(0, num(areaPercent)));
  const diameterPercent = (1 - Math.sqrt(1 - area / 100)) * 100;
  return {
    diameterPercent,
    areaPercent: area,
    message:
      `${area.toFixed(0)}% de redução de área equivale a ${diameterPercent.toFixed(0)}% de redução de diâmetro numa luz circular. ` +
      'Os ensaios mediram diâmetro; citar a área ao lado de um limiar de diâmetro exagera a lesão. Placa excêntrica quebra a suposição de circularidade.',
  };
}

export interface DopplerCrossCheck {
  agrees: boolean;
  message: string;
}

/** Peak systolic velocity above this suggests ≥70% NASCET, cm/s. */
export const PSV_SEVERE_CM_S = 230;

/**
 * Anatomic stenosis against the Doppler velocity.
 *
 * Two independent measurements of the same lesion, and when they disagree one of them is
 * wrong in a way neither can detect alone — a heavily calcified plaque makes CTA
 * over-estimate, and a contralateral occlusion raises velocities on the patent side without
 * any extra narrowing there.
 */
export function crossCheckDoppler(
  result: StenosisResult,
  peakSystolicCmS: number,
  options: { contralateralOccluded?: boolean } = {}
): DopplerCrossCheck {
  const psv = num(peakSystolicCmS);
  if (result.percent === null || !Number.isFinite(psv)) {
    return { agrees: false, message: 'Sem as duas medidas, não há verificação cruzada.' };
  }

  const nascet = result.method === 'nascet' ? result.percent : ecstToNascet(result.percent);
  const anatomicSevere = nascet >= 70;
  const dopplerSevere = psv >= PSV_SEVERE_CM_S;

  if (anatomicSevere === dopplerSevere) {
    return { agrees: true, message: '' };
  }

  const parts = [
    `Anatomia diz ${anatomicSevere ? 'grave' : 'não grave'} (${nascet.toFixed(0)}% NASCET) e Doppler diz ${dopplerSevere ? 'grave' : 'não grave'} (${psv.toFixed(0)} cm/s).`,
  ];
  if (anatomicSevere && !dopplerSevere) {
    parts.push('Placa muito calcificada faz a angio-TC superestimar — o cálcio florescente fecha a luz na imagem.');
  }
  if (!anatomicSevere && dopplerSevere) {
    parts.push(
      options.contralateralOccluded
        ? 'Oclusão contralateral eleva as velocidades do lado pérvio sem estreitamento adicional ali.'
        : 'Velocidade alta sem estreitamento correspondente: considere oclusão contralateral, tortuosidade ou erro de ângulo insonante.'
    );
  }
  return { agrees: false, message: parts.join(' ') };
}

/** One line for the carotid panel. */
export function describeStenosis(result: StenosisResult, threshold?: ThresholdResult): string {
  const parts = [result.message];
  if (threshold?.message) {
    parts.push(threshold.message);
  }
  if (result.warnings.length) {
    parts.push(result.warnings.join(' '));
  }
  return parts.join(' ');
}
