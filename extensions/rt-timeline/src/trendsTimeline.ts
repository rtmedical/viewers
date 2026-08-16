/**
 * Trends over a treatment course: patient weight and SSD — pure core (RTV-169).
 *
 * `courseTimeline.ts` places the events of a course on an axis. This is the other kind of
 * timeline: two numbers measured over and over, whose *shape* is the finding.
 *
 * ## This is a replan trigger, not a wellness chart
 *
 * A head-and-neck patient losing weight through chemoradiation is not a nutrition note on
 * the side of the record. The external contour changes, the source-to-surface distance
 * changes with it, the build-up region moves, and the dose distribution being delivered
 * stops being the one that was planned and approved. Around 5% loss from the planning
 * weight is the conventional point at which that question has to be asked out loud, and
 * {@link assessWeight} exists to ask it.
 *
 * ## SSD is the more direct evidence, and it is noisier
 *
 * Weight is a whole-body proxy. A patient can lose ten percent and have an unchanged SSD
 * over the treated volume, or lose two percent and show a large SSD change as oedema
 * resolves. SSD is measured per beam at the treatment position, so it speaks about the
 * geometry that actually matters — and it carries daily setup variation on top, which
 * means a single reading says almost nothing.
 *
 * The split is the same one `setupStatistics.ts` (RTV-208) makes for couch corrections, and
 * for the same reason: **a sustained offset is an anatomical change, scatter is setup.**
 * {@link assessSsd} separates the drift from the scatter rather than reporting one standard
 * deviation over both.
 *
 * ## A gap is not a flat line
 *
 * The failure specific to a trend chart. If nobody weighed the patient for three weeks, the
 * line between the two points still gets drawn, and it reads as three weeks of stability —
 * which is exactly the period in which the loss happened. {@link findGaps} marks them, and
 * a trend is refused across one.
 *
 * ## The baseline is the planning value
 *
 * Not the first recorded one. If the first weight in the system is from a week into
 * treatment, the loss measured from it is the loss that happened after the loss started.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export interface TrendPoint {
  /** Epoch ms. */
  at: number;
  value: number;
  /** Fraction number, when the measurement belongs to one. */
  fraction?: number;
}

export interface TrendSeries {
  /** The value at planning. Never inferred from the first sample. */
  baseline: number;
  /** When the baseline was established, epoch ms. */
  baselineAt: number;
  points: TrendPoint[];
}

/** Relative weight loss from the planning weight at which a replan is discussed. */
export const WEIGHT_REPLAN_FRACTION = 0.05;
/** Sustained SSD drift, in millimetres, at which the same question is asked. */
export const SSD_DRIFT_MM = 10;
/** A measurement gap longer than this breaks the trend. */
export const MAX_GAP_DAYS = 7;

const DAY_MS = 86_400_000;

const finite = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

function ordered(series: TrendSeries): TrendPoint[] {
  return (series?.points ?? [])
    .filter(p => Number.isFinite(finite(p?.at)) && Number.isFinite(finite(p?.value)))
    .slice()
    .sort((a, b) => a.at - b.at);
}

export interface Gap {
  fromAt: number;
  toAt: number;
  days: number;
}

/**
 * Stretches with no measurement.
 *
 * The chart draws a line across them regardless, and that line reads as stability during
 * exactly the period nobody was looking.
 */
export function findGaps(series: TrendSeries, maxGapDays = MAX_GAP_DAYS): Gap[] {
  const points = ordered(series);
  const limit = Math.max(0, Number(maxGapDays) || MAX_GAP_DAYS) * DAY_MS;
  const gaps: Gap[] = [];

  let previousAt = Number.isFinite(finite(series?.baselineAt)) ? Number(series.baselineAt) : NaN;
  for (const point of points) {
    if (Number.isFinite(previousAt) && point.at - previousAt > limit) {
      gaps.push({ fromAt: previousAt, toAt: point.at, days: (point.at - previousAt) / DAY_MS });
    }
    previousAt = point.at;
  }
  return gaps;
}

export interface LinearFit {
  /** Units per day. */
  slopePerDay: number;
  intercept: number;
  /** Root-mean-square residual around the fit — the scatter, not the drift. */
  residualRms: number;
  n: number;
}

/** Least squares against time in days, so the slope reads as "per day". */
export function fitTrend(points: TrendPoint[], originAt: number): LinearFit {
  const n = points.length;
  if (n < 2) {
    return { slopePerDay: 0, intercept: n ? points[0].value : 0, residualRms: 0, n };
  }
  const xs = points.map(p => (p.at - originAt) / DAY_MS);
  const ys = points.map(p => p.value);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
  }
  const slopePerDay = sxx > 0 ? sxy / sxx : 0;
  const intercept = meanY - slopePerDay * meanX;
  const residualRms = Math.sqrt(
    ys.reduce((sum, y, i) => sum + (y - (intercept + slopePerDay * xs[i])) ** 2, 0) / n
  );
  return { slopePerDay, intercept, residualRms, n };
}

export type TrendVerdict = 'stable' | 'drifting' | 'threshold-crossed' | 'insufficient';

export interface WeightAssessment {
  verdict: TrendVerdict;
  baselineKg: number;
  latestKg: number | null;
  /** Signed: negative is loss. */
  changeKg: number | null;
  changeFraction: number | null;
  slopeKgPerDay: number;
  /** Projected fraction lost at the end of the course, when an end date is given. */
  projectedFraction: number | null;
  gaps: Gap[];
  replanIndicated: boolean;
  message: string;
}

/**
 * Weight against the planning weight.
 *
 * Reports the projection as well as the current loss, because the useful moment to raise a
 * replan is before the threshold is crossed rather than at the fraction where it is.
 */
export function assessWeight(
  series: TrendSeries,
  options: { courseEndAt?: number; threshold?: number; maxGapDays?: number } = {}
): WeightAssessment {
  const baselineKg = finite(series?.baseline);
  const points = ordered(series);
  const gaps = findGaps(series, options.maxGapDays);
  const threshold = Number.isFinite(finite(options.threshold))
    ? Number(options.threshold)
    : WEIGHT_REPLAN_FRACTION;

  if (!Number.isFinite(baselineKg) || baselineKg <= 0) {
    return empty('Sem peso de planejamento — a perda medida a partir do primeiro registro é a perda que aconteceu depois que a perda começou.');
  }
  if (!points.length) {
    return empty('Nenhum peso registrado durante o curso.');
  }

  const latest = points[points.length - 1];
  const changeKg = latest.value - baselineKg;
  const changeFraction = changeKg / baselineKg;
  const fit = fitTrend(points, series.baselineAt);

  let projectedFraction: number | null = null;
  const courseEndAt = finite(options.courseEndAt);
  if (Number.isFinite(courseEndAt) && courseEndAt > latest.at) {
    const days = (courseEndAt - latest.at) / DAY_MS;
    projectedFraction = (changeKg + fit.slopePerDay * days) / baselineKg;
  }

  const crossed = changeFraction <= -threshold;
  const projectedToCross = projectedFraction !== null && projectedFraction <= -threshold;
  const verdict: TrendVerdict = crossed
    ? 'threshold-crossed'
    : points.length < 2
      ? 'insufficient'
      : projectedToCross || fit.slopePerDay < 0
        ? 'drifting'
        : 'stable';

  const parts: string[] = [
    `${changeKg >= 0 ? '+' : ''}${changeKg.toFixed(1)} kg (${(changeFraction * 100).toFixed(1)}%) desde o planejamento.`,
  ];
  if (crossed) {
    parts.push(
      `Ultrapassa ${(threshold * 100).toFixed(0)}%: o contorno externo mudou, e a distribuição sendo entregue deixou de ser a que foi planejada e aprovada. Avaliar replanejamento.`
    );
  } else if (projectedToCross) {
    parts.push(
      `Projeção para o fim do curso: ${(projectedFraction! * 100).toFixed(1)}%. Levantar o replanejamento agora, não na fração em que o limiar for cruzado.`
    );
  }
  if (gaps.length) {
    parts.push(gapMessage(gaps));
  }

  return {
    verdict,
    baselineKg,
    latestKg: latest.value,
    changeKg,
    changeFraction,
    slopeKgPerDay: fit.slopePerDay,
    projectedFraction,
    gaps,
    replanIndicated: crossed || projectedToCross,
    message: parts.join(' '),
  };

  function empty(message: string): WeightAssessment {
    return {
      verdict: 'insufficient',
      baselineKg,
      latestKg: null,
      changeKg: null,
      changeFraction: null,
      slopeKgPerDay: 0,
      projectedFraction: null,
      gaps,
      replanIndicated: false,
      message,
    };
  }
}

function gapMessage(gaps: Gap[]): string {
  const longest = gaps.reduce((a, b) => (b.days > a.days ? b : a));
  return (
    `${gaps.length} intervalo(s) sem medida, o maior de ${longest.days.toFixed(0)} dias. ` +
    'O gráfico desenha a linha mesmo assim, e ela se lê como estabilidade justamente no período em que ninguém olhou.'
  );
}

export interface SsdAssessment {
  verdict: TrendVerdict;
  baselineMm: number;
  /** Sustained component: the fitted change from baseline to the latest point. */
  driftMm: number | null;
  /** Scatter around the fit — day-to-day setup, not anatomy. */
  setupScatterMm: number;
  slopeMmPerDay: number;
  gaps: Gap[];
  /** True when the drift alone crosses the limit. */
  anatomicalChange: boolean;
  message: string;
}

/**
 * SSD per beam over the course.
 *
 * Separates the sustained offset from the daily scatter. Reporting one standard deviation
 * over both is the mistake: a patient with 8 mm of setup scatter and no drift and a patient
 * with 8 mm of drift and no scatter produce a similar number, and only one of them needs a
 * new plan.
 */
export function assessSsd(
  series: TrendSeries,
  options: { driftLimitMm?: number; maxGapDays?: number } = {}
): SsdAssessment {
  const baselineMm = finite(series?.baseline);
  const points = ordered(series);
  const gaps = findGaps(series, options.maxGapDays);
  const limit = Number.isFinite(finite(options.driftLimitMm))
    ? Number(options.driftLimitMm)
    : SSD_DRIFT_MM;

  if (!Number.isFinite(baselineMm) || points.length < 2) {
    return {
      verdict: 'insufficient',
      baselineMm,
      driftMm: null,
      setupScatterMm: 0,
      slopeMmPerDay: 0,
      gaps,
      anatomicalChange: false,
      message: 'Menos de duas medidas de DFS — nada de que extrair tendência. Uma leitura isolada é variação de setup.',
    };
  }

  const fit = fitTrend(points, series.baselineAt);
  const latestDays = (points[points.length - 1].at - series.baselineAt) / DAY_MS;
  // The fitted value at the latest time, not the latest sample: the sample carries that
  // day's setup error and the fit does not.
  const fittedLatest = fit.intercept + fit.slopePerDay * latestDays;
  const driftMm = fittedLatest - baselineMm;
  const anatomicalChange = Math.abs(driftMm) >= limit;

  const parts: string[] = [
    `Deriva sustentada de ${driftMm.toFixed(1)} mm, dispersão de setup ${fit.residualRms.toFixed(1)} mm.`,
  ];
  if (anatomicalChange) {
    parts.push(
      `A deriva sozinha passa de ${limit} mm: isso é mudança de contorno, não erro de posicionamento — a região de build-up se deslocou.`
    );
  } else if (fit.residualRms >= limit) {
    parts.push(
      'A dispersão é grande e a deriva não: o problema é reprodutibilidade de setup, e margem ou replanejamento não o resolvem.'
    );
  }
  if (gaps.length) {
    parts.push(gapMessage(gaps));
  }

  return {
    verdict: anatomicalChange ? 'threshold-crossed' : Math.abs(fit.slopePerDay) > 0 ? 'drifting' : 'stable',
    baselineMm,
    driftMm,
    setupScatterMm: fit.residualRms,
    slopeMmPerDay: fit.slopePerDay,
    gaps,
    anatomicalChange,
    message: parts.join(' '),
  };
}

export interface ReplanSignal {
  indicated: boolean;
  reasons: string[];
  message: string;
}

/**
 * The two trends read together.
 *
 * They disagree often, and the disagreement is informative rather than a problem to
 * resolve: weight falling with SSD steady over the target says the loss is elsewhere;
 * SSD falling with weight steady says local oedema resolved or the tumour shrank.
 */
export function replanSignal(weight: WeightAssessment, ssd: SsdAssessment): ReplanSignal {
  const reasons: string[] = [];
  if (weight?.replanIndicated) {
    reasons.push(weight.message);
  }
  if (ssd?.anatomicalChange) {
    reasons.push(ssd.message);
  }

  if (!reasons.length) {
    const disagreement =
      weight?.changeFraction !== null &&
      weight?.changeFraction !== undefined &&
      weight.changeFraction <= -0.02 &&
      ssd &&
      ssd.driftMm !== null &&
      Math.abs(ssd.driftMm) < 3;
    return {
      indicated: false,
      reasons,
      message: disagreement
        ? 'Peso caindo com DFS estável sobre o alvo — a perda está em outro lugar, e a geometria tratada não mudou.'
        : 'Sem sinal de replanejamento nas tendências.',
    };
  }

  return { indicated: true, reasons, message: reasons.join(' ') };
}

/** One line for the trends panel. */
export function describeTrends(weight: WeightAssessment, ssd: SsdAssessment): string {
  return `Peso: ${weight.message} DFS: ${ssd.message}`;
}
