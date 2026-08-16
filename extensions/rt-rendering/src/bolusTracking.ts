/**
 * Bolus tracking: the trigger decision for a contrast-enhanced acquisition — pure core
 * (RTV-66).
 *
 * Lives beside `dsa.ts` and `roadmap.ts` because it belongs to the same family: what the
 * contrast is doing, and what the equipment should do about it. The monitoring scans and
 * the scanner handshake are not here.
 *
 * ## The trigger ROI is placed once, before there is any contrast to see
 *
 * Everything downstream depends on it and nothing downstream can check it, which is why
 * {@link validateRoiBaseline} runs first. An ROI that clips the aortic wall, a calcified
 * plaque or a stent has a baseline that is high and heterogeneous — and if the protocol
 * triggers on an absolute Hounsfield value, it fires before the contrast arrives; if it
 * triggers on a rise above baseline, the rise is measured from the wrong floor. An ROI
 * with a corner in lung has the opposite problem and triggers late.
 *
 * Neither failure announces itself. The scan runs, the images come out, and the only sign
 * is that the arteries are not opacified the way they should be — which reads as a poor
 * injection.
 *
 * ## Trigger and scan are not the same moment
 *
 * Between the trigger and the first diagnostic slice there is table movement and a
 * breath-hold instruction: several seconds during which the contrast keeps rising, or in a
 * fast circulation has already peaked. Reporting the enhancement *at the trigger* answers
 * the wrong question. {@link evaluateTrigger} extrapolates the slope across the delay and
 * reports what the aorta will look like when the scan actually starts.
 *
 * ## One frame over the line is not an arrival
 *
 * Monitoring scans are low-dose and noisy. A single frame above threshold can be noise, and
 * triggering on it starts the acquisition before the contrast is there: a non-diagnostic
 * study, repeated with a second contrast load and a second dose. The rise has to be
 * sustained.
 *
 * ## Not triggering also costs
 *
 * Aborting is the safe direction, and it is not free: a missed trigger is a repeat
 * examination with more contrast and more dose, in a patient whose renal function is
 * usually the reason the protocol was careful in the first place. So the abort says which
 * of the two it was — the bolus never arrived, or the monitoring ran out of time while it
 * was still rising.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export interface MonitorFrame {
  /** Seconds from the start of monitoring. */
  timeSec: number;
  /** Mean attenuation inside the trigger ROI. */
  meanHu: number;
  /** Standard deviation inside the ROI, when the scanner reports it. */
  sdHu?: number;
}

export interface RoiBaselineCheck {
  ok: boolean;
  baselineHu: number;
  baselineSdHu: number;
  warnings: string[];
  reason?: string;
}

/** Unenhanced blood pool sits in this band; outside it the ROI is not in the lumen. */
export const BLOOD_POOL_HU = { min: 20, max: 90 };
/** Above this the ROI is heterogeneous — wall, calcium, stent or a corner in lung. */
export const BASELINE_SD_LIMIT = 20;

const finite = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

/**
 * Whether the trigger ROI is in the blood pool.
 *
 * Runs before monitoring, on the pre-contrast frames, because this is the only moment the
 * question can be answered: once contrast arrives, a bad ROI and a good one both go up.
 */
export function validateRoiBaseline(
  frames: MonitorFrame[],
  baselineFrames = 2
): RoiBaselineCheck {
  const count = Math.max(1, Math.floor(Number(baselineFrames) || 2));
  const values = (frames ?? [])
    .slice(0, count)
    .map(f => finite(f?.meanHu))
    .filter(Number.isFinite);
  const warnings: string[] = [];

  if (!values.length) {
    return {
      ok: false,
      baselineHu: NaN,
      baselineSdHu: NaN,
      warnings,
      reason: 'Sem quadros de monitoramento pré-contraste para estabelecer a linha de base.',
    };
  }

  const baselineHu = mean(values);
  // Prefer the scanner's own ROI SD; fall back to the spread between baseline frames,
  // which is a weaker signal because two frames of a homogeneous ROI also differ.
  const reportedSd = (frames ?? [])
    .slice(0, count)
    .map(f => finite(f?.sdHu))
    .filter(Number.isFinite);
  const baselineSdHu = reportedSd.length ? mean(reportedSd) : standardDeviation(values);

  if (baselineHu < BLOOD_POOL_HU.min || baselineHu > BLOOD_POOL_HU.max) {
    return {
      ok: false,
      baselineHu,
      baselineSdHu,
      warnings,
      reason:
        `Linha de base de ${baselineHu.toFixed(0)} HU está fora da faixa de sangue não contrastado (${BLOOD_POOL_HU.min}–${BLOOD_POOL_HU.max} HU). ` +
        'A ROI provavelmente pega parede, cálcio, stent ou um canto de pulmão — e nenhuma dessas falhas se anuncia: o exame roda, ' +
        'as imagens saem, e o único sinal é a artéria mal opacificada, o que se lê como injeção ruim.',
    };
  }

  if (baselineSdHu > BASELINE_SD_LIMIT) {
    warnings.push(
      `Desvio padrão de ${baselineSdHu.toFixed(0)} HU dentro da ROI — heterogênea demais para uma medida de lúmen. ` +
        'Se o disparo for por valor absoluto, cálcio na ROI dispara antes de o contraste chegar.'
    );
  }

  return { ok: true, baselineHu, baselineSdHu, warnings };
}

export interface TriggerConfig {
  /** Threshold, in HU. */
  thresholdHu: number;
  /**
   * Whether the threshold is a rise above the measured baseline or an absolute value.
   *
   * The two conventions coexist in real protocols and give different answers on the same
   * patient, so the choice is explicit rather than defaulted.
   */
  mode: 'delta' | 'absolute';
  /** Seconds between the trigger and the first diagnostic slice. */
  diagnosticDelaySec: number;
  /** Frames that must stay above threshold before firing. */
  consecutiveFrames: number;
  /** Monitoring stops here whatever happened. */
  maxMonitoringSec: number;
  baselineFrames?: number;
}

export const DEFAULT_TRIGGER: TriggerConfig = {
  thresholdHu: 100,
  mode: 'delta',
  diagnosticDelaySec: 5,
  consecutiveFrames: 2,
  maxMonitoringSec: 40,
  baselineFrames: 2,
};

export type TriggerOutcome = 'triggered' | 'timeout' | 'never-arrived' | 'invalid-roi';

export interface TriggerResult {
  outcome: TriggerOutcome;
  triggered: boolean;
  /** Monitoring time at which the trigger fired. */
  triggerAtSec: number | null;
  baselineHu: number;
  /** Enhancement above baseline at the trigger. */
  enhancementHu: number | null;
  /** Rate of rise around the trigger, HU per second. */
  slopeHuPerSec: number | null;
  /** Extrapolated enhancement when the diagnostic scan actually starts. */
  predictedAtScanHu: number | null;
  scanStartsAtSec: number | null;
  warnings: string[];
  message: string;
}

/**
 * Decides when to start the diagnostic acquisition.
 *
 * The number that matters is not the enhancement at the trigger but the one predicted at
 * the first slice: between the two there is table movement and a breath-hold instruction,
 * and in a fast circulation the peak can pass inside that gap.
 */
export function evaluateTrigger(
  frames: MonitorFrame[],
  config: TriggerConfig = DEFAULT_TRIGGER
): TriggerResult {
  const list = (frames ?? [])
    .filter(f => Number.isFinite(finite(f?.timeSec)) && Number.isFinite(finite(f?.meanHu)))
    .slice()
    .sort((a, b) => a.timeSec - b.timeSec);

  const baseline = validateRoiBaseline(list, config.baselineFrames);
  const warnings = [...baseline.warnings];

  if (!baseline.ok) {
    return {
      outcome: 'invalid-roi',
      triggered: false,
      triggerAtSec: null,
      baselineHu: baseline.baselineHu,
      enhancementHu: null,
      slopeHuPerSec: null,
      predictedAtScanHu: null,
      scanStartsAtSec: null,
      warnings,
      message: baseline.reason ?? 'ROI de disparo inválida.',
    };
  }

  const needed = Math.max(1, Math.floor(Number(config.consecutiveFrames) || 1));
  const threshold = Number(config.thresholdHu);
  const above = (frame: MonitorFrame): boolean =>
    config.mode === 'absolute'
      ? frame.meanHu >= threshold
      : frame.meanHu - baseline.baselineHu >= threshold;

  let run = 0;
  let triggerIndex = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i].timeSec > config.maxMonitoringSec) {
      break;
    }
    if (above(list[i])) {
      run++;
      if (run >= needed) {
        triggerIndex = i;
        break;
      }
    } else {
      // A single frame over the line is noise, not an arrival; the run restarts.
      run = 0;
    }
  }

  if (triggerIndex < 0) {
    const last = list[list.length - 1];
    const everRose = list.some(f => f.meanHu - baseline.baselineHu > 10);
    const ranOut = Boolean(last) && last.timeSec >= config.maxMonitoringSec;
    return {
      outcome: ranOut && everRose ? 'timeout' : 'never-arrived',
      triggered: false,
      triggerAtSec: null,
      baselineHu: baseline.baselineHu,
      enhancementHu: last ? last.meanHu - baseline.baselineHu : null,
      slopeHuPerSec: slopeAt(list, list.length - 1),
      predictedAtScanHu: null,
      scanStartsAtSec: null,
      warnings,
      message:
        ranOut && everRose
          ? `Monitoramento encerrado em ${config.maxMonitoringSec}s com o realce ainda subindo. Abortar é a direção segura e não é de graça: ` +
            'repetir significa outra carga de contraste e outra dose, num paciente cuja função renal costuma ser o motivo de o protocolo ser cuidadoso.'
          : 'O bolus não chegou à ROI. Verifique o acesso venoso, a injeção e a posição da ROI antes de repetir.',
    };
  }

  const triggerFrame = list[triggerIndex];
  const slopeHuPerSec = slopeAt(list, triggerIndex);
  const enhancementHu = triggerFrame.meanHu - baseline.baselineHu;
  const delay = Math.max(0, Number(config.diagnosticDelaySec) || 0);
  const predictedAtScanHu =
    slopeHuPerSec === null ? enhancementHu : enhancementHu + slopeHuPerSec * delay;

  if (slopeHuPerSec !== null && slopeHuPerSec < 0) {
    warnings.push(
      'O realce já estava caindo no disparo: o pico passou dentro do intervalo de monitoramento e a aquisição vai pegar a descida.'
    );
  }
  if (predictedAtScanHu !== null && predictedAtScanHu < enhancementHu) {
    warnings.push(
      `Realce previsto no início da varredura (${predictedAtScanHu.toFixed(0)} HU) menor que no disparo (${enhancementHu.toFixed(0)} HU).`
    );
  }

  return {
    outcome: 'triggered',
    triggered: true,
    triggerAtSec: triggerFrame.timeSec,
    baselineHu: baseline.baselineHu,
    enhancementHu,
    slopeHuPerSec,
    predictedAtScanHu,
    scanStartsAtSec: triggerFrame.timeSec + delay,
    warnings,
    message:
      `Disparo em ${triggerFrame.timeSec.toFixed(1)}s com ${enhancementHu.toFixed(0)} HU de realce; ` +
      `varredura começa em ${(triggerFrame.timeSec + delay).toFixed(1)}s com ${predictedAtScanHu === null ? '?' : predictedAtScanHu.toFixed(0)} HU previstos.`,
  };
}

/** Local rate of rise, from the frame before to the frame itself. */
function slopeAt(frames: MonitorFrame[], index: number): number | null {
  if (index <= 0 || index >= frames.length) {
    return null;
  }
  const a = frames[index - 1];
  const b = frames[index];
  const dt = b.timeSec - a.timeSec;
  if (!(dt > 0)) {
    return null;
  }
  return (b.meanHu - a.meanHu) / dt;
}

export interface DoseNote {
  frames: number;
  monitoringSec: number;
  message: string;
}

/**
 * What the monitoring itself cost.
 *
 * Each monitoring image is an exposure. Worth stating next to the trigger because the
 * obvious way to make triggering more reliable — monitor longer, monitor faster — is paid
 * for in dose, and the payment is invisible in the diagnostic series.
 */
export function monitoringDose(frames: MonitorFrame[]): DoseNote {
  const list = (frames ?? []).filter(f => Number.isFinite(finite(f?.timeSec)));
  const monitoringSec = list.length ? list[list.length - 1].timeSec - list[0].timeSec : 0;
  return {
    frames: list.length,
    monitoringSec,
    message: `${list.length} quadro(s) de monitoramento ao longo de ${monitoringSec.toFixed(1)}s — cada um é uma exposição.`,
  };
}

/** One line for the bolus-tracking panel. */
export function describeTrigger(result: TriggerResult): string {
  const warnings = result.warnings.length ? ` ${result.warnings.join(' ')}` : '';
  return `${result.message}${warnings}`;
}
