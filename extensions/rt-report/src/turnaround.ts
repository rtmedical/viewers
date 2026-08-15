/**
 * Report turnaround: the deadline clock and what stops it — pure core (RTV-109).
 *
 * The worklist already has an SLA per study (RTV-188). This is the other half: the clock on
 * the *report*, which is what the deadline is actually about, and which behaves differently
 * in three ways that matter.
 *
 * ## The clinically meaningful endpoint is the first actionable report, not the signature
 *
 * A preliminary read at 20 minutes and a signed report at four hours is a stroke protocol
 * working correctly. Measuring only to the signature calls that a four-hour turnaround and
 * hides the thing that mattered. {@link turnaroundState} tracks both — time to first
 * communication and time to final — and the deadline is checked against the first.
 *
 * ## The clock must not run while the radiologist cannot act
 *
 * Time spent awaiting peer review is on the reviewer. Time spent waiting for a prior study
 * to arrive is on the system. Charging either to the radiologist makes the metric a lie —
 * and worse, it makes people avoid asking for review, which is the opposite of what the
 * peer review programme is for.
 *
 * So the clock is computed from a list of intervals with the pauses removed, not from
 * `now − created`. This is the whole reason the module exists rather than being a
 * subtraction at the call site.
 *
 * ## Escalation happens before the breach, not after
 *
 * A notification at the deadline is a notification that the deadline was missed. The
 * warning threshold is a fraction of the allowance, and it is deliberately a *fraction*
 * rather than a fixed number of minutes: 15 minutes' notice is generous on a 24-hour
 * routine report and useless on a 60-minute emergency one.
 *
 * Time is injected. Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type ReportPriority = 'routine' | 'urgent' | 'emergency';

/** Allowance to the first actionable report, in minutes. */
export const DEFAULT_ALLOWANCE_MIN: Record<ReportPriority, number> = {
  emergency: 60,
  urgent: 240,
  routine: 1440,
};

export const PRIORITY_LABELS: Record<ReportPriority, string> = {
  routine: 'Normal',
  urgent: 'Urgente',
  emergency: 'Emergente',
};

/**
 * Fraction of the allowance at which to warn.
 *
 * A fraction rather than a fixed number of minutes: 15 minutes' notice is generous on a
 * 24-hour routine report and useless on a 60-minute emergency one.
 */
export const WARNING_FRACTION = 0.75;

export const MINUTE_MS = 60_000;

/** Reasons the clock stops. Each is a period the radiologist could not act. */
export type PauseReason = 'awaitingReview' | 'awaitingPrior' | 'awaitingConsult' | 'systemOutage';

export const PAUSE_LABELS: Record<PauseReason, string> = {
  awaitingReview: 'aguardando revisão por pares',
  awaitingPrior: 'aguardando exame prévio',
  awaitingConsult: 'aguardando consultoria',
  systemOutage: 'indisponibilidade de sistema',
};

export interface Pause {
  reason: PauseReason;
  from: number;
  /** Open-ended when absent — the pause is still running. */
  to?: number;
}

export interface TurnaroundInput {
  /** When the study became available to report. */
  startedAt: number;
  priority: ReportPriority;
  /** First actionable communication: preliminary, or the signature if there was none. */
  firstActionableAt?: number;
  /** Final signature. */
  signedAt?: number;
  pauses?: Pause[];
  now: number;
  allowanceMin?: Partial<Record<ReportPriority, number>>;
  warningFraction?: number;
}

export type TurnaroundStatus = 'onTime' | 'warning' | 'breached' | 'metOnTime' | 'metLate';

export const STATUS_LABELS: Record<TurnaroundStatus, string> = {
  onTime: 'Dentro do prazo',
  warning: 'Prazo se aproximando',
  breached: 'Prazo estourado',
  metOnTime: 'Cumprido no prazo',
  metLate: 'Cumprido fora do prazo',
};

export interface TurnaroundState {
  status: TurnaroundStatus;
  priority: ReportPriority;
  /** Allowance in minutes. */
  allowanceMin: number;
  /** Minutes the radiologist has actually been holding it. */
  activeMin: number;
  /** Minutes removed by pauses. */
  pausedMin: number;
  /** Minutes left before the deadline; negative once breached. */
  remainingMin: number;
  /** Active minutes to the first actionable report, once there was one. */
  timeToFirstMin: number | null;
  /** Active minutes to the signature. */
  timeToFinalMin: number | null;
  /** True while a pause is open. */
  paused: boolean;
  pauseReasons: PauseReason[];
  message: string;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Milliseconds of pause between `from` and `to`.
 *
 * Overlapping pauses are merged rather than summed: two reasons running at once is one
 * period of not being able to act, and adding them would credit the radiologist twice for
 * the same wait.
 */
export function pausedMsBetween(pauses: Pause[], from: number, to: number): number {
  const windows = (pauses ?? [])
    .map(p => ({
      start: Math.max(num(p?.from), from),
      end: Math.min(Number.isFinite(num(p?.to)) ? num(p!.to as number) : to, to),
    }))
    .filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start);

  let total = 0;
  let cursor = -Infinity;
  for (const window of windows) {
    const start = Math.max(window.start, cursor);
    if (window.end > start) {
      total += window.end - start;
      cursor = window.end;
    }
  }
  return total;
}

/** Active (unpaused) minutes between two instants. */
export function activeMinutes(from: number, to: number, pauses: Pause[] = []): number {
  const a = num(from);
  const b = num(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
    return 0;
  }
  return Math.max(0, (b - a - pausedMsBetween(pauses, a, b)) / MINUTE_MS);
}

/**
 * Where this report stands against its deadline.
 *
 * The deadline is measured against the **first actionable** report, not the signature —
 * see the module note. Once that has happened the state is terminal (`metOnTime` or
 * `metLate`) and the clock stops mattering, even if the signature comes much later.
 */
export function turnaroundState(input: TurnaroundInput): TurnaroundState {
  const priority: ReportPriority = ['routine', 'urgent', 'emergency'].includes(
    input?.priority as string
  )
    ? input.priority
    : 'routine';

  const allowanceMin =
    positiveOr(input?.allowanceMin?.[priority], DEFAULT_ALLOWANCE_MIN[priority]);
  const warningFraction = fractionOr(input?.warningFraction, WARNING_FRACTION);

  const startedAt = num(input?.startedAt);
  const now = num(input?.now);
  const pauses = input?.pauses ?? [];

  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) {
    return {
      status: 'onTime',
      priority,
      allowanceMin,
      activeMin: 0,
      pausedMin: 0,
      remainingMin: allowanceMin,
      timeToFirstMin: null,
      timeToFinalMin: null,
      paused: false,
      pauseReasons: [],
      message: 'Sem horário de início — prazo não avaliável.',
    };
  }

  const firstActionableAt = num(input?.firstActionableAt);
  const signedAt = num(input?.signedAt);
  const endpoint = Number.isFinite(firstActionableAt) ? firstActionableAt : now;

  const activeMin = activeMinutes(startedAt, endpoint, pauses);
  const pausedMin = pausedMsBetween(pauses, startedAt, endpoint) / MINUTE_MS;
  const remainingMin = allowanceMin - activeMin;

  const openPauses = pauses.filter(
    p => Number.isFinite(num(p?.from)) && num(p.from) <= now && !Number.isFinite(num(p?.to))
  );
  const pauseReasons = Array.from(new Set(openPauses.map(p => p.reason)));

  const timeToFirstMin = Number.isFinite(firstActionableAt)
    ? activeMinutes(startedAt, firstActionableAt, pauses)
    : null;
  const timeToFinalMin = Number.isFinite(signedAt)
    ? activeMinutes(startedAt, signedAt, pauses)
    : null;

  let status: TurnaroundStatus;
  if (Number.isFinite(firstActionableAt)) {
    status = activeMin <= allowanceMin ? 'metOnTime' : 'metLate';
  } else if (activeMin > allowanceMin) {
    status = 'breached';
  } else if (activeMin >= allowanceMin * warningFraction) {
    status = 'warning';
  } else {
    status = 'onTime';
  }

  return {
    status,
    priority,
    allowanceMin,
    activeMin,
    pausedMin,
    remainingMin,
    timeToFirstMin,
    timeToFinalMin,
    paused: pauseReasons.length > 0,
    pauseReasons,
    message: buildMessage(status, priority, remainingMin, pauseReasons, timeToFirstMin),
  };
}

function positiveOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function fractionOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
}

function buildMessage(
  status: TurnaroundStatus,
  priority: ReportPriority,
  remainingMin: number,
  pauseReasons: PauseReason[],
  timeToFirstMin: number | null
): string {
  const label = PRIORITY_LABELS[priority];
  const paused = pauseReasons.length
    ? ` Relógio parado: ${pauseReasons.map(r => PAUSE_LABELS[r]).join(', ')}.`
    : '';

  switch (status) {
    case 'metOnTime':
      return `${label}: primeiro laudo em ${Math.round(timeToFirstMin ?? 0)} min, dentro do prazo.`;
    case 'metLate':
      return `${label}: primeiro laudo em ${Math.round(timeToFirstMin ?? 0)} min, ${Math.round(
        -remainingMin
      )} min além do prazo.`;
    case 'breached':
      return `${label}: prazo estourado há ${Math.round(-remainingMin)} min.${paused}`;
    case 'warning':
      return `${label}: ${Math.round(remainingMin)} min restantes.${paused}`;
    default:
      return `${label}: ${Math.round(remainingMin)} min restantes.${paused}`;
  }
}

export interface TurnaroundStatistics {
  count: number;
  /** Median active minutes to the first actionable report. */
  medianMin: number;
  /** 90th percentile — the number that describes the bad days. */
  p90Min: number;
  /** Fraction met within the allowance. */
  compliance: number;
  /** Reports still open. */
  open: number;
}

/**
 * Turnaround statistics over a set of reports.
 *
 * Median and p90 rather than the mean: turnaround distributions have a long tail, and the
 * mean sits between the typical case and the tail while describing neither. The p90 is the
 * number a service-level conversation is actually about.
 *
 * Open reports are counted separately and excluded from the percentiles — including them
 * at their current elapsed time makes a backlog look like fast service, because the
 * longest-running ones have not finished yet.
 */
export function turnaroundStatistics(states: TurnaroundState[]): TurnaroundStatistics {
  const list = (states ?? []).filter(Boolean);
  const completed = list.filter(s => s.timeToFirstMin !== null);
  const open = list.length - completed.length;

  if (!completed.length) {
    return { count: 0, medianMin: 0, p90Min: 0, compliance: 0, open };
  }

  const times = completed.map(s => s.timeToFirstMin as number).sort((a, b) => a - b);
  const met = completed.filter(s => s.status === 'metOnTime').length;

  return {
    count: completed.length,
    medianMin: percentile(times, 0.5),
    p90Min: percentile(times, 0.9),
    compliance: met / completed.length,
    open,
  };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

/** Readout for the deadline badge. */
export function describeTurnaround(state: TurnaroundState): string {
  return state?.message ?? '';
}
