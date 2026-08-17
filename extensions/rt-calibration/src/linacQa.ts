/**
 * Linac QA results: tolerance, trend and Winston-Lutz decomposition — pure core (RTV-129).
 *
 * pylinac does the image analysis in the sidecar. What is here is what the numbers mean once
 * it has produced them, and the interpretation is where a QA programme quietly stops working.
 *
 * ## Pass and fail are three states, not two
 *
 * TG-142 gives a tolerance and, separately, an action level. Within tolerance is fine.
 * Beyond action, do not treat. **Between them** is the state a QA programme exists to
 * catch — investigate, decide, and probably treat while you do. Collapsing the three into a
 * boolean throws away the band where nearly all real drift lives, and leaves a dashboard
 * that is green until the day it is red.
 *
 * ## A passing result that is drifting is not the same as one that is stable
 *
 * Two machines both read 1.2% output error. One has read 1.2% for a year; the other read
 * 0.1% last month. The single value is identical and the second machine will be out of
 * tolerance in three weeks. The split is the same one `setupStatistics.ts` (RTV-208) makes
 * for setup errors and `trendsTimeline.ts` (RTV-169) makes for weight: a **sustained
 * direction** and a **scatter** are different facts and one standard deviation over both is
 * neither.
 *
 * ## Re-baselining erases the drift from the record
 *
 * Many TG-142 tolerances are relative to a baseline established at commissioning. When a
 * machine drifts and someone re-establishes the baseline, every future reading is in
 * tolerance again and the drift is gone from the history — not marked, gone. This is the
 * same failure the treatment-record tombstone prevents in `treatmentAudit.ts` (RTV-178) and
 * the replaced-ruler entry prevents in `calibration.ts` (RTV-138), and it needs the same
 * answer: the old baseline stays, with a reason.
 *
 * ## A service event is a discontinuity, not a data point
 *
 * Trending across a waveguide replacement or a MLC recalibration averages two machines.
 * {@link segmentAtService} splits the history instead.
 *
 * ## A single Winston-Lutz number blames the linac for the phantom
 *
 * The measured ball-to-field offset combines gantry sag, collimator walkout, couch walkout,
 * the imaging panel's own offset **and where the technologist put the ball**. Only some of
 * those are correctable by adjusting the machine, and the mean offset — the number usually
 * quoted as "isocentre size" — is dominated by the two that are not.
 * {@link winstonLutzComponents} separates them.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type QaState = 'within-tolerance' | 'investigate' | 'action';

export const STATE_LABELS: Record<QaState, string> = {
  'within-tolerance': 'dentro da tolerância',
  investigate: 'entre tolerância e nível de ação',
  action: 'acima do nível de ação',
};

export interface QaTest {
  id: string;
  name: string;
  unit: string;
  /** Beyond this, investigate. */
  toleranceAbs: number;
  /** Beyond this, do not treat. */
  actionAbs: number;
  /** Whether the test has to be repeated for every beam energy. */
  perEnergy: boolean;
  /** Whether the value is a deviation from a baseline rather than an absolute. */
  relativeToBaseline: boolean;
}

/** A working subset of TG-142, enough to exercise the interpretation. */
export const TG142_TESTS: Record<string, QaTest> = {
  'output-constancy': {
    id: 'output-constancy',
    name: 'Constância de output',
    unit: '%',
    toleranceAbs: 2,
    actionAbs: 3,
    perEnergy: true,
    relativeToBaseline: true,
  },
  'beam-flatness': {
    id: 'beam-flatness',
    name: 'Planura do feixe',
    unit: '%',
    toleranceAbs: 2,
    actionAbs: 3,
    perEnergy: true,
    relativeToBaseline: true,
  },
  'mlc-leaf-position': {
    id: 'mlc-leaf-position',
    name: 'Posição de lâmina do MLC (picket fence)',
    unit: 'mm',
    toleranceAbs: 1,
    actionAbs: 1.5,
    perEnergy: false,
    relativeToBaseline: false,
  },
  'winston-lutz': {
    id: 'winston-lutz',
    name: 'Coincidência isocentro (Winston-Lutz)',
    unit: 'mm',
    toleranceAbs: 1,
    actionAbs: 2,
    perEnergy: false,
    relativeToBaseline: false,
  },
  'kv-mv-alignment': {
    id: 'kv-mv-alignment',
    name: 'Coincidência kV/MV',
    unit: 'mm',
    toleranceAbs: 1,
    actionAbs: 2,
    perEnergy: false,
    relativeToBaseline: false,
  },
};

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};
const text = (value: unknown): string => String(value ?? '').trim();

export interface Classification {
  state: QaState;
  /** Deviation actually compared against the limits. */
  deviation: number;
  treatable: boolean;
  message: string;
}

/**
 * Where a result sits against the two limits.
 *
 * Three states, never two. The middle band is the one a QA programme exists to catch, and a
 * boolean pass/fail leaves a dashboard that is green until the day it is red.
 */
export function classifyResult(
  value: number,
  test: QaTest,
  baseline?: number
): Classification {
  const raw = num(value);
  if (!Number.isFinite(raw) || !test) {
    return {
      state: 'action',
      deviation: NaN,
      treatable: false,
      message: 'Resultado ausente — tratar sem resultado é tratar sem QA.',
    };
  }

  const base = num(baseline);
  if (test.relativeToBaseline && !Number.isFinite(base)) {
    return {
      state: 'action',
      deviation: NaN,
      treatable: false,
      message: `${test.name} é medido contra uma linha de base e nenhuma foi informada — sem ela o número não tem contra o que ser comparado.`,
    };
  }

  const deviation = test.relativeToBaseline ? raw - base : raw;
  const magnitude = Math.abs(deviation);

  if (magnitude > test.actionAbs) {
    return {
      state: 'action',
      deviation,
      treatable: false,
      message: `${magnitude.toFixed(2)} ${test.unit} acima do nível de ação (${test.actionAbs} ${test.unit}) — não tratar.`,
    };
  }
  if (magnitude > test.toleranceAbs) {
    return {
      state: 'investigate',
      deviation,
      treatable: true,
      message:
        `${magnitude.toFixed(2)} ${test.unit} entre a tolerância (${test.toleranceAbs}) e o nível de ação (${test.actionAbs}). ` +
        'Este é o estado que o programa de QA existe para pegar: investigar, decidir, e provavelmente tratar enquanto se investiga. ' +
        'Um passa/falha booleano joga fora exatamente essa faixa.',
    };
  }
  return {
    state: 'within-tolerance',
    deviation,
    treatable: true,
    message: `${magnitude.toFixed(2)} ${test.unit}, dentro da tolerância.`,
  };
}

export interface QaMeasurement {
  at: number;
  value: number;
  energy?: string;
}

export interface ServiceEvent {
  at: number;
  description: string;
}

export interface TrendSegment {
  fromAt: number;
  toAt: number;
  measurements: QaMeasurement[];
  /** Sustained change per day, in the test's unit. */
  driftPerDay: number;
  /** Scatter about the fitted line. */
  scatter: number;
  /** Fitted value at the end of the segment. */
  fittedLatest: number;
}

const DAY_MS = 86_400_000;

/**
 * Splits a history at service events.
 *
 * Trending across a waveguide replacement or an MLC recalibration averages two machines. The
 * segment boundary is not a gap in the data, it is a change in what the data is about.
 */
export function segmentAtService(
  measurements: QaMeasurement[],
  services: ServiceEvent[]
): QaMeasurement[][] {
  const sorted = (measurements ?? [])
    .filter(m => m && Number.isFinite(num(m.at)) && Number.isFinite(num(m.value)))
    .slice()
    .sort((a, b) => a.at - b.at);
  const boundaries = (services ?? [])
    .filter(s => s && Number.isFinite(num(s.at)))
    .map(s => num(s.at))
    .sort((a, b) => a - b);

  if (!boundaries.length) {
    return sorted.length ? [sorted] : [];
  }

  const segments: QaMeasurement[][] = [];
  let current: QaMeasurement[] = [];
  let next = 0;

  for (const m of sorted) {
    while (next < boundaries.length && m.at >= boundaries[next]) {
      if (current.length) {
        segments.push(current);
        current = [];
      }
      next++;
    }
    current.push(m);
  }
  if (current.length) {
    segments.push(current);
  }
  return segments;
}

/** Least squares of value against time in days. */
export function fitSegment(measurements: QaMeasurement[]): TrendSegment {
  const list = measurements ?? [];
  const fromAt = list[0]?.at ?? NaN;
  const toAt = list[list.length - 1]?.at ?? NaN;

  if (list.length < 2) {
    return {
      fromAt,
      toAt,
      measurements: list,
      driftPerDay: 0,
      scatter: 0,
      fittedLatest: list[0]?.value ?? NaN,
    };
  }

  const xs = list.map(m => (m.at - fromAt) / DAY_MS);
  const ys = list.map(m => m.value);
  const n = list.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
  }
  const driftPerDay = sxx > 0 ? sxy / sxx : 0;
  const intercept = meanY - driftPerDay * meanX;
  const scatter = Math.sqrt(
    ys.reduce((sum, y, i) => sum + (y - (intercept + driftPerDay * xs[i])) ** 2, 0) / n
  );

  return {
    fromAt,
    toAt,
    measurements: list,
    driftPerDay,
    scatter,
    fittedLatest: intercept + driftPerDay * xs[xs.length - 1],
  };
}

export interface TrendVerdict {
  segment: TrendSegment;
  /** Days until the fitted line crosses the tolerance, when it is heading there. */
  daysToTolerance: number | null;
  drifting: boolean;
  message: string;
}

/**
 * Whether a passing result is heading somewhere.
 *
 * Two machines both reading 1.2% are not in the same condition if one has read 1.2% for a
 * year and the other read 0.1% last month. The projection is the useful output, because the
 * point of a trend is to act before the threshold rather than at it.
 */
export function assessTrend(
  segment: TrendSegment,
  test: QaTest,
  baseline?: number
): TrendVerdict {
  const base = test.relativeToBaseline ? num(baseline) : 0;
  const current = Math.abs(segment.fittedLatest - (Number.isFinite(base) ? base : 0));
  const perDay = Math.abs(segment.driftPerDay);
  const headingOut =
    perDay > 0 &&
    Math.sign(segment.fittedLatest - (Number.isFinite(base) ? base : 0)) === Math.sign(segment.driftPerDay);

  const daysToTolerance =
    headingOut && perDay > 0 && current < test.toleranceAbs
      ? (test.toleranceAbs - current) / perDay
      : null;

  const drifting = perDay > 0 && segment.measurements.length >= 3 && perDay * 30 > test.toleranceAbs * 0.25;

  const parts = [
    `Deriva de ${segment.driftPerDay.toFixed(4)} ${test.unit}/dia, dispersão ${segment.scatter.toFixed(3)} ${test.unit}.`,
  ];
  if (daysToTolerance !== null && daysToTolerance < 180) {
    parts.push(
      `Nesse ritmo cruza a tolerância em cerca de ${Math.round(daysToTolerance)} dias. ` +
        'Duas máquinas com o mesmo valor de hoje não estão na mesma condição se uma está parada nele e a outra chegando.'
    );
  }
  if (segment.scatter > test.toleranceAbs / 2 && perDay * 30 < test.toleranceAbs * 0.1) {
    parts.push(
      'A dispersão é grande e a deriva não: o problema é reprodutibilidade da medida, e não adianta ajustar a máquina.'
    );
  }

  return { segment, daysToTolerance, drifting, message: parts.join(' ') };
}

export interface Baseline {
  testId: string;
  energy?: string;
  value: number;
  establishedAt: number;
  establishedBy: string;
  reason: string;
  /** Baseline this one replaced, kept so the drift does not disappear. */
  previous?: Omit<Baseline, 'previous'>;
}

export interface RebaselineResult {
  baseline: Baseline | null;
  ok: boolean;
  reason?: string;
  /** How much of the apparent drift the new baseline absorbs. */
  absorbedDrift: number;
  message: string;
}

/**
 * Establishes a new baseline without losing the old one.
 *
 * When a machine drifts and the baseline moves after it, every future reading is in
 * tolerance again and the drift is **gone from the history — not marked, gone**. The old
 * baseline stays, the reason is required, and the amount of drift the change absorbs is
 * stated in the record so nobody has to reconstruct it later.
 */
export function rebaseline(input: {
  testId: string;
  energy?: string;
  value: number;
  establishedAt: number;
  establishedBy: string;
  reason: string;
  current?: Baseline;
}): RebaselineResult {
  const value = num(input?.value);
  if (!Number.isFinite(value)) {
    return { baseline: null, ok: false, reason: 'Nova linha de base sem valor.', absorbedDrift: NaN, message: '' };
  }
  if (!text(input?.establishedBy)) {
    return { baseline: null, ok: false, reason: 'Nova linha de base sem responsável.', absorbedDrift: NaN, message: '' };
  }
  if (!text(input?.reason)) {
    return {
      baseline: null,
      ok: false,
      reason:
        'Nova linha de base exige motivo. Quando a linha de base anda atrás da deriva, toda leitura futura volta a estar em tolerância ' +
        'e a deriva desaparece do histórico — não marcada, desaparecida.',
      absorbedDrift: NaN,
      message: '',
    };
  }

  const previousValue = num(input.current?.value);
  const absorbedDrift = Number.isFinite(previousValue) ? value - previousValue : 0;

  const { current, ...rest } = input;
  const previous = current
    ? {
        testId: current.testId,
        energy: current.energy,
        value: current.value,
        establishedAt: current.establishedAt,
        establishedBy: current.establishedBy,
        reason: current.reason,
      }
    : undefined;

  return {
    ok: true,
    absorbedDrift,
    baseline: {
      testId: text(rest.testId),
      energy: text(rest.energy) || undefined,
      value,
      establishedAt: num(rest.establishedAt),
      establishedBy: text(rest.establishedBy),
      reason: text(rest.reason),
      previous,
    },
    message: Number.isFinite(previousValue)
      ? `Linha de base de ${previousValue} para ${value}: a mudança absorve ${absorbedDrift.toFixed(3)} de deriva aparente. ` +
        'A anterior fica registrada, para a deriva não sumir do histórico.'
      : 'Primeira linha de base registrada.',
  };
}

export type WlAxis = 'gantry' | 'collimator' | 'couch';

export const AXIS_LABELS: Record<WlAxis, string> = {
  gantry: 'gantry',
  collimator: 'colimador',
  couch: 'mesa',
};

export interface WlReading {
  axis: WlAxis;
  angleDeg: number;
  /** Ball-to-field-centre offset in the image, millimetres. */
  offsetMm: [number, number];
}

export interface WlComponent {
  axis: WlAxis;
  /** Peak-to-peak variation with that axis, millimetres. */
  walkoutMm: number;
  correctable: boolean;
}

export interface WlDecomposition {
  components: WlComponent[];
  /** Mean offset across every reading, millimetres. */
  meanOffsetMm: number;
  /** Largest single offset, the number usually quoted. */
  maxOffsetMm: number;
  warnings: string[];
  message: string;
}

/**
 * Separates a Winston-Lutz result into what moved.
 *
 * The measured offset combines gantry sag, collimator walkout, couch walkout, the imaging
 * panel's own offset **and where the technologist put the ball**. Only the axis walkouts are
 * correctable by adjusting the machine; the mean offset is dominated by the two that are
 * not, and it is the number usually quoted as "isocentre size".
 *
 * Quoting it alone blames the linac for the phantom setup, and sends a physicist to adjust
 * something that was never out.
 */
export function winstonLutzComponents(readings: WlReading[]): WlDecomposition {
  const list = (readings ?? []).filter(
    r => r && AXIS_LABELS[r.axis] && Array.isArray(r.offsetMm) && r.offsetMm.every(v => Number.isFinite(num(v)))
  );
  const warnings: string[] = [];

  if (!list.length) {
    return {
      components: [],
      meanOffsetMm: NaN,
      maxOffsetMm: NaN,
      warnings,
      message: 'Sem leituras de Winston-Lutz.',
    };
  }

  const magnitudes = list.map(r => Math.hypot(num(r.offsetMm[0]), num(r.offsetMm[1])));
  const meanOffsetMm = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
  const maxOffsetMm = Math.max(...magnitudes);

  const components: WlComponent[] = [];
  for (const axis of ['gantry', 'collimator', 'couch'] as WlAxis[]) {
    const axisReadings = list.filter(r => r.axis === axis);
    if (axisReadings.length < 2) {
      warnings.push(`Menos de duas leituras variando o ${AXIS_LABELS[axis]} — o walkout desse eixo não pode ser separado.`);
      continue;
    }
    const xs = axisReadings.map(r => num(r.offsetMm[0]));
    const ys = axisReadings.map(r => num(r.offsetMm[1]));
    const walkoutMm = Math.hypot(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys)
    );
    components.push({ axis, walkoutMm, correctable: true });
  }

  warnings.push(
    `Deslocamento médio de ${meanOffsetMm.toFixed(2)} mm inclui o offset do painel de imagem E ONDE A ESFERA FOI COLOCADA. ` +
      'Nenhum dos dois se corrige ajustando a máquina, e é justamente esse número que costuma ser citado como "tamanho do isocentro" — ' +
      'citá-lo sozinho culpa o acelerador pelo posicionamento do fantoma e manda o físico ajustar algo que nunca esteve fora.'
  );

  return {
    components,
    meanOffsetMm,
    maxOffsetMm,
    warnings,
    message:
      components.length
        ? components
            .map(c => `walkout de ${AXIS_LABELS[c.axis]} ${c.walkoutMm.toFixed(2)} mm`)
            .join(', ')
        : 'Nenhum eixo pôde ser separado.',
  };
}

export interface CoverageReport {
  missing: Array<{ testId: string; energy?: string }>;
  complete: boolean;
  message: string;
}

/**
 * Which tests and energies were not done.
 *
 * A test done on 6 MV says nothing about 10 MV, and an energy nobody measured is not an
 * energy that passed.
 */
export function qaCoverage(
  performed: Array<{ testId: string; energy?: string }>,
  required: string[],
  energies: string[]
): CoverageReport {
  const done = new Set(
    (performed ?? []).map(p => `${text(p.testId)}|${text(p.energy)}`)
  );
  const missing: Array<{ testId: string; energy?: string }> = [];

  for (const testId of required ?? []) {
    const test = TG142_TESTS[testId];
    if (!test) {
      continue;
    }
    if (test.perEnergy) {
      for (const energy of energies ?? []) {
        if (!done.has(`${testId}|${energy}`)) {
          missing.push({ testId, energy });
        }
      }
    } else if (!done.has(`${testId}|`)) {
      missing.push({ testId });
    }
  }

  return {
    missing,
    complete: missing.length === 0,
    message: missing.length
      ? `${missing.length} teste(s) não realizado(s): ${missing
          .map(m => `${TG142_TESTS[m.testId]?.name ?? m.testId}${m.energy ? ` @ ${m.energy}` : ''}`)
          .join(', ')}. Energia que ninguém mediu não é energia que passou.`
      : 'Cobertura completa para as energias declaradas.',
  };
}

/** One line for the QA board. */
export function describeQaResult(classification: Classification, trend?: TrendVerdict): string {
  const parts = [`${STATE_LABELS[classification.state]}: ${classification.message}`];
  if (trend?.message) {
    parts.push(trend.message);
  }
  return parts.join(' ');
}
