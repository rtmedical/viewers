/**
 * SLA, priority and report-status indicators — pure core (RTV-188).
 *
 * Hospitals have legal and internal deadlines for a report (CFM 2.218/2018 requires a
 * tele-report within 2 h for urgent cases; the EpacsWeb IFU sets Normal 24 h, Urgent
 * 2 h, Emergency 30 min). The worklist has to make *what is late, and what is about to
 * be* visible without the reader doing arithmetic.
 *
 * This module is pure and time-injectable: every function that needs "now" takes it as
 * an argument. That is not ceremony — an SLA that reads `Date.now()` internally cannot
 * be tested at a boundary, and the boundaries are the whole feature.
 *
 * Framework-free. Zero-fork per RTV-114.
 */

export type StudyPriority = 'normal' | 'urgent' | 'emergency';
export type ReportStatus = 'none' | 'inProgress' | 'preliminary' | 'signed' | 'addendum';

/** Semaphore state for the SLA column. */
export type SlaLevel = 'green' | 'amber' | 'red' | 'unknown';

/**
 * Default turnaround per priority, in minutes.
 *
 * Used only when the backend did not supply a `deadlineAt`. These follow the EpacsWeb
 * IFU / CFM 2.218-2018 conventions, and are deliberately conservative: computing a
 * deadline that is later than the real one would hide a breach.
 */
export const DEFAULT_TURNAROUND_MINUTES: Record<StudyPriority, number> = {
  normal: 24 * 60,
  urgent: 2 * 60,
  emergency: 30,
};

/** Fraction of the window still remaining, above which the SLA is green. */
export const SLA_GREEN_ABOVE = 0.5;
/** Below this fraction the SLA turns red. */
export const SLA_RED_BELOW = 0.1;

export interface SlaInput {
  /** When the study became the reader's responsibility (ISO or epoch ms). */
  createdAt?: string | number;
  /** When the report is due (ISO or epoch ms). */
  deadlineAt?: string | number;
  priority?: string;
  /** Current time, in epoch ms. Injected so the boundaries are testable. */
  now: number;
}

export interface SlaStatus {
  level: SlaLevel;
  /** Fraction of the window remaining, clamped to [0,1]. Null when unknown. */
  remainingFraction: number | null;
  /** Minutes left; negative when overdue. Null when unknown. */
  remainingMinutes: number | null;
  overdue: boolean;
  /** Short label for the cell: "2h 15m", "atrasado 40m", "—". */
  label: string;
  /** True when the deadline was derived from the priority, not supplied. */
  deadlineInferred: boolean;
}

const MINUTE_MS = 60_000;

/** Parses an ISO string or epoch number to epoch ms, or null. */
export function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

export function normalizePriority(value: unknown): StudyPriority {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw.startsWith('emerg')) {
    return 'emergency';
  }
  if (raw.startsWith('urgen')) {
    return 'urgent';
  }
  return 'normal';
}

export function normalizeReportStatus(value: unknown): ReportStatus {
  const raw = String(value ?? '').trim().toLowerCase().replace(/[\s_-]/g, '');
  switch (raw) {
    case 'inprogress':
    case 'draft':
    case 'emlaudo':
      return 'inProgress';
    case 'preliminary':
    case 'preliminar':
      return 'preliminary';
    case 'signed':
    case 'final':
    case 'assinado':
      return 'signed';
    case 'addendum':
    case 'adendo':
      return 'addendum';
    default:
      return 'none';
  }
}

/** Formats a minute count as "2h 15m" / "40m" / "3d 4h". */
export function formatDuration(minutes: number): string {
  const total = Math.abs(Math.round(minutes));
  if (total < 60) {
    return `${total}m`;
  }
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours < 24) {
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

/**
 * Computes the SLA state for one study.
 *
 * The fraction is `(deadline - now) / (deadline - created)` — how much of the *allowed
 * window* is left, not how much wall-clock time. A 30-minute emergency case with 10
 * minutes left is amber on that scale, while a 24-hour routine case with 10 minutes
 * left is deep red; using raw minutes would rank them the other way round.
 *
 * When `deadlineAt` is missing it is derived from `createdAt` plus the priority's
 * default turnaround, and `deadlineInferred` says so — an inferred deadline is a
 * useful hint, not a contractual one, and the UI should not present it as fact.
 */
export function computeSla(input: SlaInput): SlaStatus {
  const now = Number(input?.now);
  const created = toEpochMs(input?.createdAt);
  const priority = normalizePriority(input?.priority);

  let deadline = toEpochMs(input?.deadlineAt);
  let deadlineInferred = false;
  if (deadline == null && created != null) {
    deadline = created + DEFAULT_TURNAROUND_MINUTES[priority] * MINUTE_MS;
    deadlineInferred = true;
  }

  if (!Number.isFinite(now) || deadline == null) {
    return {
      level: 'unknown',
      remainingFraction: null,
      remainingMinutes: null,
      overdue: false,
      label: '—',
      deadlineInferred,
    };
  }

  const remainingMs = deadline - now;
  const remainingMinutes = Math.round(remainingMs / MINUTE_MS);
  const overdue = remainingMs < 0;

  // The window is created -> deadline. Without a creation time there is no window to
  // take a fraction of, so fall back to the priority's nominal turnaround.
  const windowMs =
    created != null && deadline > created
      ? deadline - created
      : DEFAULT_TURNAROUND_MINUTES[priority] * MINUTE_MS;

  const rawFraction = remainingMs / windowMs;
  const remainingFraction = Math.min(1, Math.max(0, rawFraction));

  const level: SlaLevel = overdue
    ? 'red'
    : rawFraction < SLA_RED_BELOW
      ? 'red'
      : rawFraction <= SLA_GREEN_ABOVE
        ? 'amber'
        : 'green';

  return {
    level,
    remainingFraction,
    remainingMinutes,
    overdue,
    label: overdue ? `atrasado ${formatDuration(remainingMinutes)}` : formatDuration(remainingMinutes),
    deadlineInferred,
  };
}

export interface BadgeSpec {
  /** Empty when nothing should be drawn. */
  label: string;
  /** Carbon token name, for the UI to resolve. */
  tone: 'red' | 'yellow' | 'blue' | 'green' | 'purple' | 'grey' | 'none';
  bold?: boolean;
  /** The dot should pulse (work in progress). */
  pulse?: boolean;
  title?: string;
}

/**
 * Priority badge.
 *
 * `normal` renders nothing on purpose. A badge on every row is visual noise, and noise
 * is exactly what stops the emergency badge from being seen.
 */
export function priorityBadge(priority: unknown): BadgeSpec {
  switch (normalizePriority(priority)) {
    case 'emergency':
      return { label: 'EMERGENTE', tone: 'red', bold: true, title: 'Prazo 30 minutos' };
    case 'urgent':
      return { label: 'URGENTE', tone: 'yellow', title: 'Prazo 2 horas' };
    default:
      return { label: '', tone: 'none' };
  }
}

/** Report-status dot. */
export function reportStatusBadge(status: unknown): BadgeSpec {
  switch (normalizeReportStatus(status)) {
    case 'inProgress':
      return { label: 'Em laudo', tone: 'blue', pulse: true };
    case 'preliminary':
      return { label: 'Preliminar', tone: 'yellow' };
    case 'signed':
      return { label: 'Assinado', tone: 'green' };
    case 'addendum':
      return { label: 'Addendum', tone: 'purple' };
    default:
      return { label: 'Sem laudo', tone: 'grey' };
  }
}

/**
 * A faint row tint for priority.
 *
 * Very low alpha on purpose: the tint has to survive next to the zebra stripe and the
 * selection surface without competing with them, and a saturated row makes the text
 * harder to read — which is the opposite of what an urgent case needs.
 */
export function priorityRowTint(priority: unknown): string | undefined {
  switch (normalizePriority(priority)) {
    case 'emergency':
      return 'rgba(250, 77, 86, 0.10)';
    case 'urgent':
      return 'rgba(241, 194, 27, 0.08)';
    default:
      return undefined;
  }
}

/**
 * Sorts rows the way a reading list should default: breaches first, then how close to
 * breaching, with priority breaking ties.
 *
 * Rows with no SLA information sink to the bottom rather than floating to the top —
 * "unknown" is not "urgent", and treating it as urgent would bury the real breaches.
 */
export function compareBySla(
  a: { sla: SlaStatus; priority?: unknown },
  b: { sla: SlaStatus; priority?: unknown }
): number {
  const rank = (s: SlaStatus) => (s.level === 'unknown' ? 2 : s.overdue ? 0 : 1);
  const byRank = rank(a.sla) - rank(b.sla);
  if (byRank !== 0) {
    return byRank;
  }
  const fa = a.sla.remainingFraction;
  const fb = b.sla.remainingFraction;
  if (fa != null && fb != null && fa !== fb) {
    return fa - fb;
  }
  const priorityRank = (p: unknown) =>
    ({ emergency: 0, urgent: 1, normal: 2 })[normalizePriority(p)];
  return priorityRank(a.priority) - priorityRank(b.priority);
}
