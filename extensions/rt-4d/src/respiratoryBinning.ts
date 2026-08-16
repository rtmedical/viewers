/**
 * Respiratory binning for 4D-CT, and the irregularity that breaks it — pure core (RTV-92).
 *
 * RTV-93 named the phases of an already-binned 4D-CT. This is the step before: taking the
 * surrogate trace (belt, block, or a spirometer) and deciding which acquisition goes in
 * which bin. Two methods, and they do not produce the same images.
 *
 * ## Phase binning and amplitude binning disagree, and the disagreement is the artefact
 *
 * **Phase binning** divides each breath into equal fractions of its own cycle. Every bin
 * gets filled, always. **Amplitude binning** bins by where the surrogate actually is.
 *
 * With perfectly regular breathing they agree. With irregular breathing — which is what
 * patients do — phase binning puts anatomically *different* positions into the same bin,
 * because 30% of a deep breath is a different diaphragm position from 30% of a shallow one.
 * The reconstructed phase then contains two different anatomies stitched together, and that
 * is the origin of the classic 4D-CT stair-step and duplicated-diaphragm artefacts.
 *
 * Amplitude binning does not have that problem and has the other one: a bin the patient
 * never reached is **empty**, and an empty bin is a hole in the 4D dataset rather than a
 * blurred image. Both are stated; neither is silently preferred.
 *
 * ## Irregularity is the finding, not a nuisance
 *
 * The most useful output here is not the bins, it is the number that says how much the
 * patient's breathing varied — because that number predicts the artefact and, in RT, it
 * predicts an ITV that under-covers. {@link assessRegularity} reports it before any binning
 * happens, and {@link binByPhase} carries the warning into the result rather than producing
 * clean-looking bins from dirty data.
 *
 * ## 0% and 100% are the same phase
 *
 * End-inspiration is both. An off-by-one that produces eleven bins for a ten-phase
 * acquisition, or that double-counts one, shows up as a cine that stutters once per cycle —
 * subtle enough to be blamed on the display.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type BinningMethod = 'phase' | 'amplitude';

export const BINNING_LABELS: Record<BinningMethod, string> = {
  phase: 'por fase',
  amplitude: 'por amplitude',
};

/** Cycle-to-cycle variation above this is irregular enough to matter. */
export const IRREGULARITY_THRESHOLD = 0.2;

export interface SurrogateSample {
  /** Seconds. */
  time: number;
  /** Surrogate position. Larger is more inspired, by convention. */
  amplitude: number;
}

export interface Cycle {
  /** Index of the end-inspiration sample that starts the cycle. */
  startIndex: number;
  endIndex: number;
  periodSec: number;
  /** Peak-to-trough of this cycle. */
  amplitudeRange: number;
}

const finite = (samples: SurrogateSample[]): SurrogateSample[] =>
  (samples ?? []).filter(
    s => Number.isFinite(Number(s?.time)) && Number.isFinite(Number(s?.amplitude))
  );

/**
 * A peak must rise this fraction of the trace's full range above the trough behind it.
 *
 * Without it, sensor noise near end-expiration is detected as a breath: the trace is nearly
 * flat there, so millivolts of noise produce a local maximum. Each spurious peak halves an
 * apparent period, which inflates the period variation, which reports a perfectly regular
 * patient as irregular and sends them to amplitude binning and its empty bins. The
 * detector's noise floor therefore decides the module's headline number.
 */
export const MIN_PEAK_PROMINENCE = 0.3;

/**
 * Splits the trace into cycles at end-inspiration peaks.
 *
 * Peaks rather than troughs because end-inspiration is the conventional 0% phase, and
 * because the diaphragm pauses longer at end-expiration, which makes the trough a broad
 * plateau and a poor landmark.
 *
 * Prominence is measured against the lowest point since the previous accepted peak, not
 * against an absolute height, because a real trace drifts: a patient who relaxes over
 * thirty seconds ends the acquisition breathing around a lower baseline, and a fixed height
 * gate stops detecting their breaths halfway through.
 */
export function detectCycles(
  samples: SurrogateSample[],
  minPeriodSec = 1.5,
  minProminence = MIN_PEAK_PROMINENCE
): Cycle[] {
  const trace = finite(samples);
  if (trace.length < 3) {
    return [];
  }

  const all = trace.map(s => s.amplitude);
  const range = Math.max(...all) - Math.min(...all);
  const prominenceFloor = range * Math.max(0, Number(minProminence) || 0);

  const peaks: number[] = [];
  // Lowest point seen since the last accepted peak — the trough a candidate must clear.
  let troughSincePeak = trace[0].amplitude;

  for (let i = 1; i < trace.length - 1; i++) {
    const previous = trace[i - 1].amplitude;
    const current = trace[i].amplitude;
    const next = trace[i + 1].amplitude;
    troughSincePeak = Math.min(troughSincePeak, current);

    if (!(current > previous && current >= next)) {
      continue;
    }
    if (peaks.length && current - troughSincePeak < prominenceFloor) {
      continue;
    }

    const lastPeak = peaks[peaks.length - 1];
    if (lastPeak === undefined || trace[i].time - trace[lastPeak].time >= minPeriodSec) {
      peaks.push(i);
      troughSincePeak = current;
    } else if (current > trace[lastPeak].amplitude) {
      peaks[peaks.length - 1] = i;
      troughSincePeak = current;
    }
  }

  const cycles: Cycle[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const startIndex = peaks[i - 1];
    const endIndex = peaks[i];
    const slice = trace.slice(startIndex, endIndex + 1).map(s => s.amplitude);
    cycles.push({
      startIndex,
      endIndex,
      periodSec: trace[endIndex].time - trace[startIndex].time,
      amplitudeRange: Math.max(...slice) - Math.min(...slice),
    });
  }
  return cycles;
}

export interface RegularityAssessment {
  cycles: number;
  meanPeriodSec: number;
  /** Coefficient of variation of the period. */
  periodVariation: number;
  /** Coefficient of variation of the amplitude range. */
  amplitudeVariation: number;
  regular: boolean;
  /** The method that suits this trace. */
  recommended: BinningMethod;
  message: string;
}

/**
 * How much the patient's breathing varied.
 *
 * The most useful number in the module: it predicts the artefact before any reconstruction
 * happens, and in RT it predicts an ITV that under-covers.
 */
export function assessRegularity(
  samples: SurrogateSample[],
  threshold = IRREGULARITY_THRESHOLD
): RegularityAssessment {
  const cycles = detectCycles(samples);
  if (cycles.length < 2) {
    return {
      cycles: cycles.length,
      meanPeriodSec: cycles[0]?.periodSec ?? 0,
      periodVariation: 0,
      amplitudeVariation: 0,
      regular: false,
      recommended: 'phase',
      message:
        'Menos de dois ciclos completos no traçado — não dá para julgar regularidade nem binar com confiança.',
    };
  }

  const periods = cycles.map(c => c.periodSec);
  const ranges = cycles.map(c => c.amplitudeRange);
  const periodVariation = coefficientOfVariation(periods);
  const amplitudeVariation = coefficientOfVariation(ranges);
  const limit = Math.max(0, Number(threshold) || IRREGULARITY_THRESHOLD);
  const regular = periodVariation <= limit && amplitudeVariation <= limit;

  return {
    cycles: cycles.length,
    meanPeriodSec: mean(periods),
    periodVariation,
    amplitudeVariation,
    regular,
    // Amplitude binning is anatomically consistent, which is what irregular breathing
    // destroys; it pays for that with empty bins.
    recommended: regular ? 'phase' : 'amplitude',
    message: regular
      ? `Respiração regular (${cycles.length} ciclos, variação de período ${(periodVariation * 100).toFixed(0)}%).`
      : `Respiração irregular: período varia ${(periodVariation * 100).toFixed(0)}% e amplitude ${(amplitudeVariation * 100).toFixed(0)}%. ` +
        'Binagem por fase vai colocar posições anatômicas diferentes no mesmo bin — é daí que vem o artefato de degrau e o diafragma duplicado. ' +
        'Em radioterapia, o ITV construído a partir daqui subestima a excursão.',
  };
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function coefficientOfVariation(values: number[]): number {
  const m = mean(values);
  if (!(Math.abs(m) > 1e-12) || values.length < 2) {
    return 0;
  }
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance) / Math.abs(m);
}

export interface Bin {
  /** 0 to binCount-1. */
  index: number;
  /** Phase as a percentage of the cycle, or the amplitude band centre. */
  label: string;
  /** Indices into the sample array assigned to this bin. */
  sampleIndices: number[];
}

export interface BinningResult {
  method: BinningMethod;
  bins: Bin[];
  /** Bins with no samples. Empty for phase binning, possible for amplitude. */
  emptyBins: number[];
  regularity: RegularityAssessment;
  warnings: string[];
  ok: boolean;
  reason?: string;
}

/**
 * Phase binning: each cycle divided into equal fractions of itself.
 *
 * Every bin fills, always — which is the attraction and the trap. With irregular breathing
 * the bins fill with anatomically different positions, and the result *looks* complete.
 */
export function binByPhase(samples: SurrogateSample[], binCount = 10): BinningResult {
  const trace = finite(samples);
  const count = Math.max(2, Math.floor(Number(binCount) || 10));
  const regularity = assessRegularity(samples);
  const cycles = detectCycles(samples);
  const warnings: string[] = [];

  if (!cycles.length) {
    return {
      method: 'phase',
      bins: [],
      emptyBins: [],
      regularity,
      warnings,
      ok: false,
      reason: 'Nenhum ciclo respiratório completo detectado.',
    };
  }

  const bins: Bin[] = Array.from({ length: count }, (_, index) => ({
    index,
    // 0% and 100% are the same phase; the labels run 0 to (count-1)/count.
    label: `${Math.round((index / count) * 100)}%`,
    sampleIndices: [],
  }));

  for (const cycle of cycles) {
    const span = trace[cycle.endIndex].time - trace[cycle.startIndex].time;
    if (!(span > 0)) {
      continue;
    }
    // End index excluded: it is the start of the next cycle, and counting it twice is the
    // stutter-once-per-cycle bug.
    for (let i = cycle.startIndex; i < cycle.endIndex; i++) {
      const fraction = (trace[i].time - trace[cycle.startIndex].time) / span;
      const index = Math.min(count - 1, Math.floor(fraction * count));
      bins[index].sampleIndices.push(i);
    }
  }

  if (!regularity.regular) {
    warnings.push(regularity.message);
  }

  return {
    method: 'phase',
    bins,
    emptyBins: bins.filter(b => !b.sampleIndices.length).map(b => b.index),
    regularity,
    warnings,
    ok: true,
  };
}

/**
 * Amplitude binning: bins by where the surrogate actually is.
 *
 * Anatomically consistent, and it leaves holes. An empty bin is not a blurred image — it is
 * a phase the reconstruction cannot produce at all, and pretending otherwise by
 * interpolating from the neighbours invents anatomy.
 */
export function binByAmplitude(samples: SurrogateSample[], binCount = 10): BinningResult {
  const trace = finite(samples);
  const count = Math.max(2, Math.floor(Number(binCount) || 10));
  const regularity = assessRegularity(samples);
  const warnings: string[] = [];

  if (trace.length < 2) {
    return {
      method: 'amplitude',
      bins: [],
      emptyBins: [],
      regularity,
      warnings,
      ok: false,
      reason: 'Traçado curto demais para binar.',
    };
  }

  const amplitudes = trace.map(s => s.amplitude);
  const min = Math.min(...amplitudes);
  const max = Math.max(...amplitudes);
  const span = max - min;
  if (!(span > 0)) {
    return {
      method: 'amplitude',
      bins: [],
      emptyBins: [],
      regularity,
      warnings,
      ok: false,
      reason: 'Amplitude constante — o surrogate não se moveu.',
    };
  }

  const bins: Bin[] = Array.from({ length: count }, (_, index) => ({
    index,
    label: `${(min + ((index + 0.5) / count) * span).toFixed(2)}`,
    sampleIndices: [],
  }));

  for (let i = 0; i < trace.length; i++) {
    const fraction = (trace[i].amplitude - min) / span;
    const index = Math.min(count - 1, Math.floor(fraction * count));
    bins[index].sampleIndices.push(i);
  }

  const emptyBins = bins.filter(b => !b.sampleIndices.length).map(b => b.index);
  if (emptyBins.length) {
    warnings.push(
      `${emptyBins.length} bin(s) vazio(s): o paciente nunca alcançou essa amplitude. ` +
        'Bin vazio é uma fase que a reconstrução não consegue produzir — interpolar dos vizinhos inventa anatomia.'
    );
  }

  return { method: 'amplitude', bins, emptyBins, regularity, warnings, ok: true };
}

/** Bins by whichever method the trace calls for, and says which it used and why. */
export function bin(
  samples: SurrogateSample[],
  binCount = 10,
  method?: BinningMethod
): BinningResult {
  const regularity = assessRegularity(samples);
  const chosen = method ?? regularity.recommended;
  const result = chosen === 'amplitude' ? binByAmplitude(samples, binCount) : binByPhase(samples, binCount);
  if (!method) {
    result.warnings.unshift(
      `Método escolhido automaticamente: ${BINNING_LABELS[chosen]} (${regularity.regular ? 'respiração regular' : 'respiração irregular'}).`
    );
  }
  return result;
}

export interface ItvNote {
  reliable: boolean;
  message: string;
}

/**
 * Whether an ITV drawn on this 4D-CT can be trusted.
 *
 * The RT consequence, and the reason the irregularity number matters more than the bins: an
 * ITV built from an irregular acquisition covers the excursion the patient happened to make
 * during those thirty seconds, not the one they will make over thirty fractions.
 */
export function itvReliability(regularity: RegularityAssessment): ItvNote {
  if (!regularity || regularity.cycles < 2) {
    return {
      reliable: false,
      message: 'Ciclos insuficientes — a excursão medida não representa a respiração do paciente.',
    };
  }
  if (regularity.regular) {
    return { reliable: true, message: '' };
  }
  return {
    reliable: false,
    message:
      `Respiração irregular (amplitude varia ${(regularity.amplitudeVariation * 100).toFixed(0)}%): o ITV ` +
      'cobre a excursão desta aquisição, não a que o paciente vai fazer ao longo do tratamento. Considere coaching respiratório ou uma margem maior.',
  };
}

/** One line for the gating panel. */
export function describeBinning(result: BinningResult): string {
  if (!result?.ok) {
    return result?.reason ?? '';
  }
  const filled = result.bins.length - result.emptyBins.length;
  const warnings = result.warnings.length ? ` ${result.warnings.join(' ')}` : '';
  return `Binagem ${BINNING_LABELS[result.method]}: ${filled}/${result.bins.length} bins preenchidos, ${result.regularity.cycles} ciclos.${warnings}`;
}
