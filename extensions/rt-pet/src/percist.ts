/**
 * PERCIST 1.0 response assessment and total metabolic tumour volume — pure core
 * (RTV-198).
 *
 * ## PERCIST is measurable-or-not before it is responding-or-not
 *
 * A lesion only counts if it is hotter than the patient's own liver by a defined margin:
 * `1.5 × SULmean(liver) + 2 SD`. Below that the uptake is not distinguishable from normal
 * variation, and a "response" measured on it is measuring noise.
 *
 * The liver reference is per-scan, not a constant, because it moves with the patient's
 * glycaemia, the uptake time and the reconstruction. {@link liverThreshold} computes it and
 * {@link isMeasurable} gates on it — so the first question the module answers is whether
 * this study has anything PERCIST can be applied to at all.
 *
 * ## Two conditions, not one
 *
 * Response and progression each need **a 30% relative change AND an absolute change of at
 * least 0.8 SUL units**. The absolute floor exists because 30% of a small number is a
 * small number: a lesion going from 2.1 to 1.4 SUL is a 33% drop and is noise. Reporting
 * it as a partial metabolic response is how a treatment gets credited with an effect it
 * did not have.
 *
 * ## A new lesion is progression regardless of the arithmetic
 *
 * PMD is declared by a new lesion even if every measured lesion shrank. The numeric path
 * cannot reach that conclusion, so it is a separate input and a separate branch.
 *
 * ## The TMTV threshold changes the answer by a factor of two
 *
 * Total metabolic tumour volume is threshold-defined, and the three thresholds in common
 * use — 41% of SUVmax, a fixed SUV of 2.5, and a liver-derived one — disagree by around
 * 2× on the same patient. None is wrong; they are different definitions. The number is
 * therefore **meaningless without the method**, and {@link computeTmtv} refuses to return
 * a bare volume: the method travels with it, and {@link compareTmtv} refuses to compare
 * two volumes computed differently.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

/** PERCIST relative change for response or progression. */
export const PERCIST_RELATIVE_CHANGE = 0.3;

/** PERCIST absolute change floor, SUL units. */
export const PERCIST_ABSOLUTE_CHANGE = 0.8;

/** Liver measurability multiplier. */
export const LIVER_MULTIPLIER = 1.5;

export type TmtvMethod = 'suvMax41' | 'fixedSuv25' | 'liverBased';

export const TMTV_METHOD_LABELS: Record<TmtvMethod, string> = {
  suvMax41: '41% do SUVmax',
  fixedSuv25: 'SUV fixo 2.5',
  liverBased: 'derivado do fígado',
};

export interface LiverReference {
  /** SULmean of a 3 cm sphere in normal right lobe. */
  sulMean: number;
  /** Standard deviation within the same sphere. */
  sulSd: number;
}

export interface MeasurabilityResult {
  measurable: boolean;
  threshold: number;
  message: string;
}

/**
 * `1.5 × SULmean(liver) + 2 SD`.
 *
 * Per-scan, never a constant — it moves with glycaemia, uptake time and reconstruction.
 */
export function liverThreshold(liver: LiverReference): number {
  const mean = Number(liver?.sulMean);
  const sd = Number(liver?.sulSd);
  if (!Number.isFinite(mean) || mean <= 0 || !Number.isFinite(sd) || sd < 0) {
    return NaN;
  }
  return LIVER_MULTIPLIER * mean + 2 * sd;
}

/**
 * Whether a lesion is measurable by PERCIST.
 *
 * The first question, before any response arithmetic: a "response" measured on
 * sub-threshold uptake is measuring normal variation.
 */
export function isMeasurable(sulPeak: number, liver: LiverReference): MeasurabilityResult {
  const threshold = liverThreshold(liver);
  const value = Number(sulPeak);

  if (!Number.isFinite(threshold)) {
    return {
      measurable: false,
      threshold: NaN,
      message: 'Referência hepática ausente — PERCIST não pode ser aplicado.',
    };
  }
  if (!Number.isFinite(value)) {
    return { measurable: false, threshold, message: 'SULpeak da lesão ausente.' };
  }
  if (value <= threshold) {
    return {
      measurable: false,
      threshold,
      message: `SULpeak ${value.toFixed(2)} não excede o limiar hepático de ${threshold.toFixed(2)} — lesão não mensurável por PERCIST.`,
    };
  }
  return { measurable: true, threshold, message: '' };
}

export type PercistResponse = 'CMR' | 'PMR' | 'SMD' | 'PMD' | 'NE';

export const PERCIST_LABELS: Record<PercistResponse, string> = {
  CMR: 'Resposta metabólica completa',
  PMR: 'Resposta metabólica parcial',
  SMD: 'Doença metabólica estável',
  PMD: 'Doença metabólica progressiva',
  NE: 'Não avaliável',
};

export interface PercistInput {
  /** SULpeak of the hottest measurable lesion at baseline. */
  baselineSulPeak: number;
  /** SULpeak of the hottest lesion now — not necessarily the same lesion. */
  currentSulPeak: number;
  baselineLiver: LiverReference;
  currentLiver: LiverReference;
  /** Uptake times, minutes. Compared before anything else. */
  baselineUptakeMin?: number;
  currentUptakeMin?: number;
  /** A lesion that was not there before. Forces PMD. */
  newLesion?: boolean;
  /** True when no residual uptake above background is visible at all. */
  completeResolution?: boolean;
}

export interface PercistResult {
  response: PercistResponse;
  label: string;
  /** Relative change in SULpeak. */
  changeFraction: number;
  /** Absolute change in SUL units. */
  changeAbsolute: number;
  rationale: string;
  warnings: string[];
}

/**
 * PERCIST 1.0 response.
 *
 * The order is the standard's: uptake-time comparability, then measurability, then the
 * new-lesion override, then the two-condition arithmetic. Anything that fails earlier
 * returns `NE` — which is a real answer, and the one that stops a treatment decision being
 * made on a number that does not mean what it looks like.
 */
export function assessPercist(input: PercistInput): PercistResult {
  const warnings: string[] = [];
  const notEvaluable = (rationale: string): PercistResult => ({
    response: 'NE',
    label: PERCIST_LABELS.NE,
    changeFraction: 0,
    changeAbsolute: 0,
    rationale,
    warnings,
  });

  const baselineUptake = Number(input?.baselineUptakeMin);
  const currentUptake = Number(input?.currentUptakeMin);
  if (Number.isFinite(baselineUptake) && Number.isFinite(currentUptake)) {
    const difference = Math.abs(currentUptake - baselineUptake);
    if (difference > 15) {
      return notEvaluable(
        `Tempos de captação diferem em ${difference.toFixed(0)} min — acima do limite de 15 min do PERCIST.`
      );
    }
  } else {
    warnings.push('Tempo de captação não registrado em um dos exames.');
  }

  const baselineMeasurable = isMeasurable(input?.baselineSulPeak, input?.baselineLiver);
  if (!baselineMeasurable.measurable) {
    return notEvaluable(`Baseline: ${baselineMeasurable.message}`);
  }

  const baseline = Number(input.baselineSulPeak);
  const current = Number(input.currentSulPeak);

  if (input?.newLesion) {
    // PMD by a new lesion even if every measured lesion shrank; the arithmetic cannot
    // reach this conclusion on its own.
    return {
      response: 'PMD',
      label: PERCIST_LABELS.PMD,
      changeFraction: Number.isFinite(current) ? (current - baseline) / baseline : 0,
      changeAbsolute: Number.isFinite(current) ? current - baseline : 0,
      rationale: 'Nova lesão — progressão metabólica independentemente da variação de SUL.',
      warnings,
    };
  }

  if (input?.completeResolution) {
    return {
      response: 'CMR',
      label: PERCIST_LABELS.CMR,
      changeFraction: -1,
      changeAbsolute: -baseline,
      rationale:
        'Captação residual não distinguível do fundo — resposta metabólica completa.',
      warnings,
    };
  }

  if (!Number.isFinite(current)) {
    return notEvaluable('SULpeak atual ausente.');
  }

  // A current lesion below the CURRENT scan's liver threshold is complete response, and
  // the current liver is the right reference — the patient's own liver moved too.
  const currentMeasurable = isMeasurable(current, input?.currentLiver);
  if (!currentMeasurable.measurable && Number.isFinite(currentMeasurable.threshold)) {
    return {
      response: 'CMR',
      label: PERCIST_LABELS.CMR,
      changeFraction: (current - baseline) / baseline,
      changeAbsolute: current - baseline,
      rationale: `Captação atual abaixo do limiar hepático (${currentMeasurable.threshold.toFixed(2)}) — resposta metabólica completa.`,
      warnings,
    };
  }

  const changeAbsolute = current - baseline;
  const changeFraction = changeAbsolute / baseline;
  const meetsRelative = Math.abs(changeFraction) >= PERCIST_RELATIVE_CHANGE;
  const meetsAbsolute = Math.abs(changeAbsolute) >= PERCIST_ABSOLUTE_CHANGE;

  // Both conditions. 30% of a small number is a small number.
  if (meetsRelative && meetsAbsolute) {
    const responding = changeAbsolute < 0;
    return {
      response: responding ? 'PMR' : 'PMD',
      label: responding ? PERCIST_LABELS.PMR : PERCIST_LABELS.PMD,
      changeFraction,
      changeAbsolute,
      rationale: `SULpeak ${(changeFraction * 100).toFixed(0)}% (${changeAbsolute.toFixed(2)} unidades) — atende aos dois critérios.`,
      warnings,
    };
  }

  const why = meetsRelative
    ? `variação de ${(changeFraction * 100).toFixed(0)}% atinge os 30%, mas ${Math.abs(changeAbsolute).toFixed(2)} unidades não atinge o piso absoluto de ${PERCIST_ABSOLUTE_CHANGE}`
    : `variação de ${(changeFraction * 100).toFixed(0)}% abaixo dos 30%`;

  return {
    response: 'SMD',
    label: PERCIST_LABELS.SMD,
    changeFraction,
    changeAbsolute,
    rationale: `Doença estável: ${why}.`,
    warnings,
  };
}

export interface TmtvVoxel {
  /** SUV or SUL of the voxel. */
  suv: number;
  /** Voxel volume, mL. */
  volumeMl: number;
}

export interface TmtvOptions {
  method: TmtvMethod;
  /** Highest SUV in the lesion, for the 41% method. */
  suvMax?: number;
  liver?: LiverReference;
}

export interface TmtvResult {
  volumeMl: number;
  /** Total lesion glycolysis: volume × mean SUV within it. */
  tlg: number;
  method: TmtvMethod;
  methodLabel: string;
  threshold: number;
  voxelCount: number;
  ok: boolean;
  reason?: string;
}

/**
 * Total metabolic tumour volume above a threshold.
 *
 * The method is part of the answer, not a setting — see the module note. There is no
 * default: a caller that has not decided which definition it is using has not asked a
 * well-formed question.
 */
export function computeTmtv(voxels: TmtvVoxel[], options: TmtvOptions): TmtvResult {
  const method = options?.method;
  const label = TMTV_METHOD_LABELS[method];

  const empty = (reason: string): TmtvResult => ({
    volumeMl: 0,
    tlg: 0,
    method,
    methodLabel: label ?? '',
    threshold: NaN,
    voxelCount: 0,
    ok: false,
    reason,
  });

  if (!label) {
    return empty('Método de limiar de TMTV não informado.');
  }

  let threshold = NaN;
  if (method === 'suvMax41') {
    const suvMax = Number(options?.suvMax);
    if (!Number.isFinite(suvMax) || suvMax <= 0) {
      return empty('SUVmax necessário para o limiar de 41%.');
    }
    threshold = 0.41 * suvMax;
  } else if (method === 'fixedSuv25') {
    threshold = 2.5;
  } else {
    threshold = liverThreshold(options?.liver as LiverReference);
    if (!Number.isFinite(threshold)) {
      return empty('Referência hepática necessária para o limiar derivado do fígado.');
    }
  }

  let volumeMl = 0;
  let weighted = 0;
  let voxelCount = 0;
  for (const voxel of voxels ?? []) {
    const suv = Number(voxel?.suv);
    const volume = Number(voxel?.volumeMl);
    if (Number.isFinite(suv) && Number.isFinite(volume) && volume > 0 && suv >= threshold) {
      volumeMl += volume;
      weighted += suv * volume;
      voxelCount += 1;
    }
  }

  return {
    volumeMl,
    tlg: weighted,
    method,
    methodLabel: label,
    threshold,
    voxelCount,
    ok: true,
  };
}

export interface TmtvComparison {
  comparable: boolean;
  changeFraction: number;
  message: string;
}

/**
 * Compares two TMTVs.
 *
 * Refuses across methods. The three thresholds disagree by around 2× on the same patient,
 * so a baseline measured at 41% of SUVmax against a follow-up at a fixed 2.5 produces a
 * change that is entirely definitional — and it will be reported as response.
 */
export function compareTmtv(prior: TmtvResult, current: TmtvResult): TmtvComparison {
  if (!prior?.ok || !current?.ok) {
    return { comparable: false, changeFraction: 0, message: 'TMTV indisponível em um dos exames.' };
  }
  if (prior.method !== current.method) {
    return {
      comparable: false,
      changeFraction: 0,
      message:
        `TMTV medido por métodos diferentes ("${prior.methodLabel}" vs "${current.methodLabel}"). ` +
        'Os limiares discordam em cerca de 2× no mesmo paciente — a diferença seria definicional, não biológica.',
    };
  }
  if (!(prior.volumeMl > 0)) {
    return {
      comparable: false,
      changeFraction: 0,
      message: 'TMTV basal zero — variação relativa indefinida.',
    };
  }
  const changeFraction = (current.volumeMl - prior.volumeMl) / prior.volumeMl;
  return {
    comparable: true,
    changeFraction,
    message: `TMTV ${changeFraction >= 0 ? '+' : ''}${(changeFraction * 100).toFixed(0)}% (${prior.methodLabel}).`,
  };
}

/** Readout for the PERCIST panel. */
export function describePercist(result: PercistResult): string {
  if (!result) {
    return '';
  }
  const warnings = result.warnings.length ? ` ${result.warnings.join(' ')}` : '';
  return `${result.response} — ${result.label}. ${result.rationale}${warnings}`;
}
