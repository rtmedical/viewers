/**
 * Session grouping and imaging statistics — pure core (RTV-171).
 *
 * The sub-timeline under a treatment session: every imaging and treatment event of that
 * session, in order, with the tally that sits above it.
 *
 * ## "Pass", "reviewed" and "approved" are three different claims
 *
 * They are routinely added into one number, and the number then answers nothing. A
 * tolerance check passing is the software saying the shift was small. Reviewed is a human
 * having looked. Approved is a human having authorised. A panel reading "8 pass" over a
 * session where nobody opened a single image is technically accurate and completely
 * misleading — and it is the natural output of a `status === 'ok'` count.
 *
 * So {@link STATUS_KIND} separates what the machine asserted from what a person asserted,
 * and {@link sessionStatistics} reports the two totals side by side rather than one.
 *
 * ## An override with no name is not an override
 *
 * Overriding is accepting something outside tolerance. It is a legitimate clinical act and
 * the only thing that makes it accountable is *who*. An override row with an empty
 * attribution is an exception nobody owns, which is the state a QA programme exists to
 * prevent. {@link validateEvent} refuses it.
 *
 * ## A session is a gap in time, not a date
 *
 * Grouping by calendar day gets both common cases wrong: twice-daily hyperfractionation
 * becomes one session that appears to have taken eight hours, and an evening session
 * running past midnight becomes two, the second of which looks like a treatment with no
 * setup imaging. {@link groupSessions} splits on the gap.
 *
 * ## When timestamps tie, imaging comes first
 *
 * Treatment records frequently carry minute precision, so the setup image and the beam that
 * followed it land on the same timestamp. Sorting stably by time alone will sometimes place
 * the beam first, and a sub-timeline showing the beam before the image that authorised it
 * says the therapist treated and then imaged. Nobody reads that as a rendering artefact.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type EventStatus =
  | 'pass'
  | 'warning'
  | 'action-item'
  | 'reviewed'
  | 'approved'
  | 'override'
  | 'manual'
  | 'unknown';

/** What kind of claim each status is. The distinction the tally exists to preserve. */
export const STATUS_KIND: Record<EventStatus, 'automatic' | 'human' | 'exception' | 'provenance'> = {
  pass: 'automatic',
  warning: 'automatic',
  'action-item': 'automatic',
  reviewed: 'human',
  approved: 'human',
  override: 'exception',
  manual: 'provenance',
  unknown: 'automatic',
};

export const STATUS_LABELS: Record<EventStatus, string> = {
  pass: 'dentro da tolerância',
  warning: 'aviso',
  'action-item': 'item de ação',
  reviewed: 'revisado',
  approved: 'aprovado',
  override: 'exceção aceita',
  manual: 'manual',
  unknown: 'sem status',
};

export type EventType = 'imaging' | 'treatment';

export interface SessionEvent {
  id: string;
  /** Epoch ms. */
  at: number;
  type: EventType;
  status: EventStatus;
  /** Required for an override. */
  by?: string;
  /** Imaging kind, from `imagingTimeline.ts`. */
  imagingKind?: string;
  fraction?: number;
  note?: string;
}

/** Two events further apart than this belong to different sessions. */
export const SESSION_GAP_MINUTES = 240;

const text = (value: unknown): string => String(value ?? '').trim();
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

export interface EventValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Whether an event may be recorded.
 *
 * The only rule with teeth is the override attribution: accepting something outside
 * tolerance is a legitimate act, and the name is the entire difference between a decision
 * and an unowned exception.
 */
export function validateEvent(event: SessionEvent): EventValidation {
  if (!event || !text(event.id)) {
    return { ok: false, reason: 'Evento sem identificador.' };
  }
  if (!Number.isFinite(num(event.at))) {
    return { ok: false, reason: 'Evento sem horário.' };
  }
  if (!STATUS_LABELS[event.status]) {
    return { ok: false, reason: `Status desconhecido: ${String(event.status)}.` };
  }
  if (event.status === 'override' && !text(event.by)) {
    return {
      ok: false,
      reason:
        'Exceção aceita sem responsável. Aceitar algo fora da tolerância é ato clínico legítimo, e o nome é a diferença inteira ' +
        'entre uma decisão e uma exceção que ninguém assume.',
    };
  }
  return { ok: true };
}

/**
 * Orders the events of a session.
 *
 * Ties break with imaging before treatment. Minute-precision timestamps put the setup image
 * and the beam that followed it on the same value, and a sub-timeline showing the beam
 * first says the therapist treated and then imaged — which nobody reads as a rendering
 * artefact.
 */
export function orderEvents(events: SessionEvent[]): SessionEvent[] {
  return (events ?? [])
    .filter(e => e && Number.isFinite(num(e.at)))
    .slice()
    .sort((a, b) => {
      if (a.at !== b.at) {
        return a.at - b.at;
      }
      if (a.type !== b.type) {
        return a.type === 'imaging' ? -1 : 1;
      }
      return text(a.id).localeCompare(text(b.id));
    });
}

export interface Session {
  index: number;
  startAt: number;
  endAt: number;
  durationMin: number;
  events: SessionEvent[];
  fractions: number[];
}

/**
 * Splits a course's events into sessions by the gap between them.
 *
 * Calendar-day grouping gets both common cases wrong: twice-daily treatment collapses into
 * one session that looks eight hours long, and an evening session crossing midnight splits
 * into two, the second of which looks like a treatment with no setup imaging.
 */
export function groupSessions(
  events: SessionEvent[],
  gapMinutes = SESSION_GAP_MINUTES
): Session[] {
  const ordered = orderEvents(events);
  if (!ordered.length) {
    return [];
  }
  const gap = Math.max(1, num(gapMinutes) || SESSION_GAP_MINUTES) * 60_000;
  const sessions: Session[] = [];
  let current: SessionEvent[] = [ordered[0]];

  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].at - ordered[i - 1].at > gap) {
      sessions.push(toSession(current, sessions.length));
      current = [];
    }
    current.push(ordered[i]);
  }
  sessions.push(toSession(current, sessions.length));
  return sessions;
}

function toSession(events: SessionEvent[], index: number): Session {
  const startAt = events[0].at;
  const endAt = events[events.length - 1].at;
  const fractions = [...new Set(events.map(e => num(e.fraction)).filter(Number.isFinite))].sort(
    (a, b) => a - b
  );
  return {
    index,
    startAt,
    endAt,
    durationMin: (endAt - startAt) / 60_000,
    events,
    fractions,
  };
}

export interface StatusCount {
  status: EventStatus;
  label: string;
  count: number;
}

export interface SessionStatistics {
  imagingEvents: number;
  treatmentEvents: number;
  /** Counts per status, in a stable order. */
  byStatus: StatusCount[];
  /** What the software asserted. */
  automaticChecks: number;
  /** What a person asserted. */
  humanChecks: number;
  overrides: Array<{ id: string; by: string; note?: string }>;
  manualRecords: number;
  message: string;
}

const STATUS_ORDER: EventStatus[] = [
  'pass',
  'warning',
  'action-item',
  'reviewed',
  'approved',
  'override',
  'manual',
  'unknown',
];

/**
 * The tally above the sub-timeline.
 *
 * Automatic and human checks are reported separately and never summed. "8 pass" over a
 * session where nobody opened an image is accurate and misleading, and it is what a single
 * total produces.
 *
 * Counts only — no percentages. A session has a handful of events, and a rate over three of
 * them is a number with a confidence interval wider than its own value. Rates belong to the
 * course, not the session.
 */
export function sessionStatistics(session: Session): SessionStatistics {
  const events = session?.events ?? [];
  const counts = new Map<EventStatus, number>();
  for (const event of events) {
    counts.set(event.status, (counts.get(event.status) ?? 0) + 1);
  }

  const byStatus = STATUS_ORDER.filter(s => counts.has(s)).map(status => ({
    status,
    label: STATUS_LABELS[status],
    count: counts.get(status) as number,
  }));

  const automaticChecks = events.filter(e => STATUS_KIND[e.status] === 'automatic').length;
  const humanChecks = events.filter(e => STATUS_KIND[e.status] === 'human').length;
  const overrides = events
    .filter(e => e.status === 'override')
    .map(e => ({ id: e.id, by: text(e.by), note: e.note }));
  const manualRecords = events.filter(e => e.status === 'manual').length;

  const parts = [
    `${events.filter(e => e.type === 'imaging').length} imagem(ns), ${events.filter(e => e.type === 'treatment').length} entrega(s).`,
    `${automaticChecks} verificação(ões) automática(s), ${humanChecks} humana(s).`,
  ];
  if (!humanChecks && automaticChecks) {
    parts.push('Nenhum evento revisado ou aprovado por pessoa nesta sessão — o que passou, passou no software.');
  }
  if (overrides.length) {
    parts.push(`${overrides.length} exceção(ões) aceita(s) por ${[...new Set(overrides.map(o => o.by))].join(', ')}.`);
  }
  if (manualRecords) {
    parts.push(`${manualRecords} registro(s) manual(is).`);
  }

  return {
    imagingEvents: events.filter(e => e.type === 'imaging').length,
    treatmentEvents: events.filter(e => e.type === 'treatment').length,
    byStatus,
    automaticChecks,
    humanChecks,
    overrides,
    manualRecords,
    message: parts.join(' '),
  };
}

export interface SessionConcern {
  concerning: boolean;
  reasons: string[];
}

/**
 * Whether a session deserves a second look.
 *
 * Not a score. The three cases worth surfacing are a delivery with no imaging before it, an
 * override, and an action item that was never followed by a human check.
 */
export function sessionConcerns(session: Session): SessionConcern {
  const reasons: string[] = [];
  const events = session?.events ?? [];

  const firstTreatment = events.find(e => e.type === 'treatment');
  const imagingBefore = events.some(e => e.type === 'imaging' && firstTreatment && e.at <= firstTreatment.at);
  if (firstTreatment && !imagingBefore) {
    reasons.push('Entrega sem imagem de verificação antes dela nesta sessão.');
  }

  const overrides = events.filter(e => e.status === 'override');
  for (const override of overrides) {
    reasons.push(`Exceção aceita por ${text(override.by)}${override.note ? ` — ${override.note}` : ''}.`);
  }

  const actionItems = events.filter(e => e.status === 'action-item');
  if (actionItems.length && !events.some(e => STATUS_KIND[e.status] === 'human')) {
    reasons.push('Item de ação sem nenhuma revisão humana na sessão.');
  }

  return { concerning: reasons.length > 0, reasons };
}

/** One line per session for the course list. */
export function describeSession(session: Session): string {
  const stats = sessionStatistics(session);
  const fractions = session.fractions.length ? ` · fração ${session.fractions.join(', ')}` : '';
  return `Sessão ${session.index + 1}${fractions} · ${session.durationMin.toFixed(0)} min — ${stats.message}`;
}
