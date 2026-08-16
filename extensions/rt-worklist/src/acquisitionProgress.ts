/**
 * Studies that are still arriving — pure core (RTV-20).
 *
 * Viewing a series during acquisition is the feature. The part that needs writing down is
 * what must **not** be done to a series that is not all there yet, because the incomplete
 * series is the one that looks fine.
 *
 * ## A series that is still arriving looks like a series that is finished
 *
 * Nothing in a stack of images says how many there were supposed to be. The reader scrolls
 * from the first slice to the last and sees a whole examination; the anatomy that has not
 * arrived reads as anatomy that was not imaged. That is the failure, and it is silent by
 * construction.
 *
 * ## A gap in the middle is far worse than a short tail
 *
 * A truncated series is visibly truncated: the volume ends somewhere anatomically odd and
 * the reader notices. A **missing slice in the middle** is invisible — the viewer scrolls
 * straight past it, and if the missing slice held the lesion, nothing anywhere indicates
 * that anything is absent. {@link detectGaps} looks at the slice positions rather than the
 * count, because the count cannot tell the two apart.
 *
 * ## "Finished" and "stalled" are the same thing from here
 *
 * Without an expected instance count, a series that stopped arriving because it is complete
 * and one that stopped because the sender died look identical. The same shape as the silent
 * channel in `realtimeSync.ts` (RTV-189), one level down: elapsed time is not evidence.
 *
 * ## Looking is allowed, measuring is not
 *
 * The point of the feature is to look early, so viewing is never blocked. Measurement,
 * reformatting and reporting are, because each of them produces something that carries no
 * mark of the incompleteness: a MIP over half a lung is a perfectly normal-looking MIP, and
 * a volume computed from a truncated stack is a number.
 *
 * Framework-free, no `@ohif/*`, no timers — the clock is a parameter.
 */

export type Completeness = 'complete' | 'arriving' | 'stalled' | 'gapped' | 'unknown';

export const COMPLETENESS_LABELS: Record<Completeness, string> = {
  complete: 'completa',
  arriving: 'chegando',
  stalled: 'parada',
  gapped: 'com falha no meio',
  unknown: 'estado desconhecido',
};

export interface SeriesArrival {
  seriesInstanceUid: string;
  modality: string;
  /** Instances received so far. */
  receivedInstances: number;
  /**
   * Instances the source says there should be, when it says.
   *
   * Absent far more often than one would like, which is why it cannot be the only signal.
   */
  expectedInstances?: number;
  /** Slice positions along the normal, millimetres, in any order. */
  slicePositionsMm?: number[];
  firstInstanceAt: number;
  lastInstanceAt: number;
}

export interface ProgressConfig {
  /** No new instance for this long means it is no longer arriving. */
  quietMs: number;
  /** A spacing this many times the median counts as a gap. */
  gapFactor: number;
}

export const DEFAULT_PROGRESS: ProgressConfig = { quietMs: 30_000, gapFactor: 1.5 };

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

export interface Gap {
  /** Position before the gap, millimetres. */
  fromMm: number;
  toMm: number;
  /** How many slices are missing, by the median spacing. */
  missingSlices: number;
}

/**
 * Missing slice positions.
 *
 * Works on positions rather than on the count, because a count of ninety when a hundred
 * were expected cannot say whether the ten are at the end — where a reader will notice — or
 * in the middle, where nobody will.
 */
export function detectGaps(
  positionsMm: number[],
  gapFactor = DEFAULT_PROGRESS.gapFactor
): { gaps: Gap[]; medianSpacingMm: number } {
  const positions = (positionsMm ?? [])
    .map(num)
    .filter(Number.isFinite)
    .slice()
    .sort((a, b) => a - b);

  if (positions.length < 3) {
    return { gaps: [], medianSpacingMm: NaN };
  }

  const spacings: number[] = [];
  for (let i = 1; i < positions.length; i++) {
    spacings.push(positions[i] - positions[i - 1]);
  }
  const sorted = spacings.slice().sort((a, b) => a - b);
  const medianSpacingMm = sorted[Math.floor(sorted.length / 2)];
  if (!(medianSpacingMm > 0)) {
    return { gaps: [], medianSpacingMm };
  }

  const factor = Number.isFinite(num(gapFactor)) ? num(gapFactor) : DEFAULT_PROGRESS.gapFactor;
  const gaps: Gap[] = [];
  for (let i = 1; i < positions.length; i++) {
    const spacing = positions[i] - positions[i - 1];
    if (spacing > medianSpacingMm * factor) {
      gaps.push({
        fromMm: positions[i - 1],
        toMm: positions[i],
        missingSlices: Math.max(1, Math.round(spacing / medianSpacingMm) - 1),
      });
    }
  }
  return { gaps, medianSpacingMm };
}

export interface ProgressAssessment {
  completeness: Completeness;
  receivedInstances: number;
  expectedInstances: number | null;
  gaps: Gap[];
  /** Milliseconds since the last instance arrived. */
  quietMs: number;
  warnings: string[];
  message: string;
}

/**
 * Where a series is in its arrival.
 *
 * Gaps outrank everything: a series can have every instance the source promised and still
 * be missing a slice, if an instance was rejected on ingestion and the count was taken from
 * the sender.
 */
export function assessSeries(
  arrival: SeriesArrival,
  now: number,
  config: ProgressConfig = DEFAULT_PROGRESS
): ProgressAssessment {
  const received = Math.max(0, Math.floor(num(arrival?.receivedInstances) || 0));
  const expectedRaw = num(arrival?.expectedInstances);
  const expectedInstances = Number.isFinite(expectedRaw) && expectedRaw > 0 ? expectedRaw : null;
  const quietMs = Math.max(0, num(now) - num(arrival?.lastInstanceAt));
  const { gaps } = detectGaps(arrival?.slicePositionsMm ?? [], config.gapFactor);
  const warnings: string[] = [];

  let completeness: Completeness;
  if (gaps.length) {
    completeness = 'gapped';
  } else if (expectedInstances !== null) {
    completeness = received >= expectedInstances ? 'complete' : quietMs > config.quietMs ? 'stalled' : 'arriving';
  } else if (quietMs > config.quietMs) {
    completeness = 'unknown';
  } else {
    completeness = 'arriving';
  }

  if (expectedInstances === null) {
    warnings.push(
      'A origem não informou quantas instâncias eram esperadas. Sem isso, uma série que parou porque terminou e uma que parou ' +
        'porque o emissor caiu são indistinguíveis daqui — tempo decorrido não é evidência.'
    );
  }
  if (gaps.length) {
    const missing = gaps.reduce((sum, g) => sum + g.missingSlices, 0);
    warnings.push(
      `${missing} corte(s) faltando no meio da série, em ${gaps.length} lacuna(s). ` +
        'Série truncada acaba num lugar anatomicamente estranho e o leitor percebe; corte faltando no meio é invisível — ' +
        'o viewer passa reto, e se a lesão estava ali nada indica que falta alguma coisa.'
    );
  }
  if (expectedInstances !== null && received > expectedInstances) {
    warnings.push(
      `${received} instâncias recebidas contra ${expectedInstances} esperadas — série duplicada ou contagem da origem desatualizada.`
    );
  }

  const parts = [`${received}${expectedInstances !== null ? `/${expectedInstances}` : ''} instância(s), ${COMPLETENESS_LABELS[completeness]}.`];
  return {
    completeness,
    receivedInstances: received,
    expectedInstances,
    gaps,
    quietMs,
    warnings,
    message: parts.concat(warnings).join(' '),
  };
}

export type Operation = 'view' | 'measure' | 'reformat' | 'segment' | 'report';

export const OPERATION_LABELS: Record<Operation, string> = {
  view: 'visualizar',
  measure: 'medir',
  reformat: 'reformatar (MPR/MIP)',
  segment: 'segmentar',
  report: 'laudar',
};

export interface OperationPermission {
  allowed: Operation[];
  blocked: Array<{ operation: Operation; reason: string }>;
}

/**
 * What may be done to a series in this state.
 *
 * Viewing is never blocked — looking early is the entire feature. Everything else is,
 * because each of them produces an artefact that carries no mark of the incompleteness: a
 * MIP over half a lung is a perfectly normal-looking MIP, and a volume from a truncated
 * stack is a number.
 */
export function allowedOperations(assessment: ProgressAssessment): OperationPermission {
  const allowed: Operation[] = ['view'];
  const blocked: Array<{ operation: Operation; reason: string }> = [];

  if (assessment.completeness === 'complete') {
    return { allowed: ['view', 'measure', 'reformat', 'segment', 'report'], blocked };
  }

  const reason =
    assessment.completeness === 'gapped'
      ? 'A série tem cortes faltando no meio. Qualquer coisa derivada dela herda o buraco sem mostrá-lo.'
      : assessment.completeness === 'arriving'
        ? 'A série ainda está chegando. O que já veio é olhável; o que for derivado dela sai com cara de completo.'
        : assessment.completeness === 'stalled'
          ? 'A série parou de chegar antes do esperado.'
          : 'Não se sabe se a série está completa, porque a origem não disse quantas instâncias eram esperadas.';

  for (const operation of ['measure', 'reformat', 'segment', 'report'] as Operation[]) {
    blocked.push({ operation, reason });
  }
  return { allowed, blocked };
}

export interface DerivedArtefactWarning {
  safe: boolean;
  message: string;
}

/**
 * The warning that has to travel with anything derived from an incomplete series.
 *
 * Separate from the permission check because a derived artefact outlives the state it was
 * made in: a MIP saved as a secondary capture from a half-arrived study is a normal MIP
 * forever afterwards, and no rule about the live viewport reaches it.
 */
export function derivedArtefactWarning(
  assessment: ProgressAssessment,
  operation: Operation
): DerivedArtefactWarning {
  if (assessment.completeness === 'complete') {
    return { safe: true, message: '' };
  }
  return {
    safe: false,
    message:
      `${OPERATION_LABELS[operation]} sobre série ${COMPLETENESS_LABELS[assessment.completeness]}. ` +
      'O artefato derivado sobrevive ao estado em que foi feito: um MIP salvo de um estudo pela metade é um MIP normal para sempre, ' +
      'e nenhuma regra sobre o viewport ao vivo alcança ele. Se for salvo, precisa carregar essa marca.',
  };
}

/** One line for the arrival indicator. */
export function describeProgress(assessment: ProgressAssessment): string {
  return assessment.message;
}
