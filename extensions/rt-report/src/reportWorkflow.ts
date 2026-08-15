/**
 * Report lifecycle: draft, preliminary, signed, addendum — pure core (RTV-107).
 *
 * The states are easy to list and the transitions are where the whole thing is decided.
 *
 * ## A signed report is immutable. Full stop.
 *
 * This is the load-bearing rule. Once a report is signed it is a legal document: it has
 * been distributed, a clinician has acted on it, and in the target architecture it has a
 * PAdES/ICP-Brasil signature over a PDF/A whose bytes cannot change. A state machine that
 * allows `signed → draft` does not "let the radiologist fix a typo"; it silently
 * invalidates a signature and makes the archived artifact disagree with the live one.
 *
 * So there is no edit path out of `signed`. The way to change a signed report is to
 * **write an addendum**, which is a new document that references the one it amends and
 * goes through its own draft → signed cycle. {@link applyEvent} refuses anything else,
 * and refuses with a reason.
 *
 * ## Preliminary is not "signed, but less"
 *
 * A preliminary report is a resident's or a night-shift read issued before the attending
 * has signed. It is a real clinical communication — somebody will act on it — and it is
 * *also* explicitly not final. Modelling it as a weaker `signed` loses exactly the
 * property that matters, which is that every rendering of it has to say so.
 * {@link requiresPreliminaryBanner} exists so no distribution path can forget.
 *
 * Preliminary text **is** editable, unlike signed: that is the difference between the two,
 * and it is why they cannot be the same state with a flag.
 *
 * ## Versions are monotonic and never reused
 *
 * Every signature mints a version. An addendum does not modify version 1; it creates
 * version 2 which contains version 1 plus the addendum. A reader who was sent version 1
 * has to be able to ask "is what I hold current?" and get a truthful answer, which is
 * impossible if version numbers are recycled or if an addendum edits in place.
 *
 * ## Who may sign is not the same question as what may be signed
 *
 * A resident can produce a preliminary and cannot sign a final; the workflow asks the host
 * through an injected {@link AuthorityCheck} rather than importing a permissions module
 * (the same seam as RTV-190). Capability names are exported so the wiring can be tested.
 *
 * Time is injected. Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type ReportState =
  | 'draft'
  | 'preliminary'
  | 'signed'
  | 'addendumDraft'
  | 'amended';

export type ReportEventType =
  | 'edit'
  | 'issuePreliminary'
  | 'sign'
  | 'startAddendum'
  | 'signAddendum'
  | 'discardAddendum'
  | 'retract';

export const REPORT_CAPABILITIES = [
  'report.edit',
  'report.issuePreliminary',
  'report.sign',
  'report.retract',
] as const;

export type ReportCapability = (typeof REPORT_CAPABILITIES)[number];

/** Answers whether the acting user holds a capability. Absent means "no". */
export type AuthorityCheck = (capability: ReportCapability) => boolean;

export interface ReportAuthor {
  id: string;
  name: string;
  /** CRM or equivalent, carried into the signature block. */
  registration?: string;
}

export interface ReportVersion {
  version: number;
  /** 'report' for the original, 'addendum' for each amendment. */
  kind: 'report' | 'addendum';
  body: string;
  signedBy: ReportAuthor;
  signedAt: number;
  /** Version this addendum amends. Absent on the original. */
  amends?: number;
}

export interface ReportDocument {
  state: ReportState;
  /** Working text: the draft body, or the addendum being written. */
  workingBody: string;
  /** Signed, immutable versions, in order. */
  versions: ReportVersion[];
  /** Author of the current working text. */
  workingAuthor?: ReportAuthor;
  /** Set while a preliminary is outstanding. */
  preliminaryIssuedAt?: number;
  preliminaryBy?: ReportAuthor;
  history: ReportHistoryEntry[];
}

export interface ReportHistoryEntry {
  event: ReportEventType;
  at: number;
  by: string;
  from: ReportState;
  to: ReportState;
  note?: string;
}

export function emptyReport(): ReportDocument {
  return { state: 'draft', workingBody: '', versions: [], history: [] };
}

export interface ReportEvent {
  type: ReportEventType;
  at: number;
  author: ReportAuthor;
  can: AuthorityCheck;
  /** New body text, for `edit`. */
  body?: string;
  /** Reason, for `retract`. */
  reason?: string;
}

export interface TransitionResult {
  document: ReportDocument;
  ok: boolean;
  /** Present when the event was refused. */
  error?: string;
}

const refuse = (document: ReportDocument, error: string): TransitionResult => ({
  document,
  ok: false,
  error,
});

const text = (value: unknown): string => String(value ?? '').trim();

/**
 * Which events are structurally possible from each state.
 *
 * Note what is absent: no event leads out of `signed` except `startAddendum` and
 * `retract`. There is deliberately no `signed → draft`.
 */
const ALLOWED: Record<ReportState, ReportEventType[]> = {
  draft: ['edit', 'issuePreliminary', 'sign'],
  preliminary: ['edit', 'sign'],
  signed: ['startAddendum', 'retract'],
  addendumDraft: ['edit', 'signAddendum', 'discardAddendum'],
  amended: ['startAddendum', 'retract'],
};

const CAPABILITY_OF: Record<ReportEventType, ReportCapability> = {
  edit: 'report.edit',
  issuePreliminary: 'report.issuePreliminary',
  sign: 'report.sign',
  startAddendum: 'report.edit',
  signAddendum: 'report.sign',
  discardAddendum: 'report.edit',
  retract: 'report.retract',
};

export function allowedEvents(state: ReportState): ReportEventType[] {
  return ALLOWED[state] ? [...ALLOWED[state]] : [];
}

export function canApply(document: ReportDocument, type: ReportEventType): boolean {
  return allowedEvents(document?.state).includes(type);
}

/**
 * Applies an event, or refuses with a reason.
 *
 * Refusals are values rather than exceptions: every one of them is a thing the UI has to
 * explain to a radiologist, and an exception here would be caught and turned back into a
 * string somewhere less careful.
 */
export function applyEvent(document: ReportDocument, event: ReportEvent): TransitionResult {
  const current = document ?? emptyReport();
  const type = event?.type;
  const at = Number(event?.at);
  const author = event?.author;

  if (!ALLOWED[current.state]) {
    return refuse(current, 'Estado do laudo inválido.');
  }
  if (!type || !CAPABILITY_OF[type]) {
    return refuse(current, 'Ação desconhecida.');
  }
  if (!author?.id || !text(author.name)) {
    return refuse(current, 'Ação sem autor identificado.');
  }
  if (!Number.isFinite(at)) {
    return refuse(current, 'Ação sem horário.');
  }
  if (!canApply(current, type)) {
    return refuse(current, refusalFor(current.state, type));
  }

  const can = typeof event.can === 'function' ? event.can : () => false;
  if (!can(CAPABILITY_OF[type])) {
    return refuse(current, 'Você não tem permissão para esta ação.');
  }

  switch (type) {
    case 'edit':
      return commit(current, event, current.state, {
        workingBody: String(event.body ?? ''),
        workingAuthor: author,
      });

    case 'issuePreliminary': {
      if (!text(current.workingBody)) {
        return refuse(current, 'Não é possível emitir um laudo preliminar vazio.');
      }
      return commit(current, event, 'preliminary', {
        preliminaryIssuedAt: at,
        preliminaryBy: author,
      });
    }

    case 'sign': {
      if (!text(current.workingBody)) {
        return refuse(current, 'Não é possível assinar um laudo vazio.');
      }
      const version: ReportVersion = {
        version: nextVersion(current),
        kind: 'report',
        body: current.workingBody,
        signedBy: author,
        signedAt: at,
      };
      return commit(current, event, 'signed', {
        versions: [...current.versions, version],
        // The working text is cleared, not kept: leaving an editable copy of a signed
        // body around is how the two drift apart.
        workingBody: '',
        workingAuthor: undefined,
        preliminaryIssuedAt: undefined,
        preliminaryBy: undefined,
      });
    }

    case 'startAddendum':
      return commit(current, event, 'addendumDraft', {
        workingBody: '',
        workingAuthor: author,
      });

    case 'signAddendum': {
      if (!text(current.workingBody)) {
        return refuse(current, 'Não é possível assinar um adendo vazio.');
      }
      const version: ReportVersion = {
        version: nextVersion(current),
        kind: 'addendum',
        body: current.workingBody,
        signedBy: author,
        signedAt: at,
        amends: lastSignedVersion(current)?.version,
      };
      return commit(current, event, 'amended', {
        versions: [...current.versions, version],
        workingBody: '',
        workingAuthor: undefined,
      });
    }

    case 'discardAddendum':
      return commit(current, event, previousSignedState(current), {
        workingBody: '',
        workingAuthor: undefined,
      });

    case 'retract':
      if (!text(event.reason)) {
        return refuse(current, 'Retratação exige um motivo.');
      }
      // Retraction does NOT delete the signed versions. The document goes back to a
      // draft the radiologist can rewrite, and the retracted versions stay in
      // `versions` — a report that was distributed cannot be un-distributed, and the
      // archive has to keep what was sent.
      return commit(
        current,
        event,
        'draft',
        { workingBody: lastSignedVersion(current)?.body ?? '', workingAuthor: author },
        text(event.reason)
      );

    default:
      return refuse(current, 'Ação desconhecida.');
  }
}

function commit(
  current: ReportDocument,
  event: ReportEvent,
  to: ReportState,
  patch: Partial<ReportDocument>,
  note?: string
): TransitionResult {
  const entry: ReportHistoryEntry = {
    event: event.type,
    at: Number(event.at),
    by: event.author.id,
    from: current.state,
    to,
    note,
  };
  return {
    ok: true,
    document: {
      ...current,
      ...patch,
      state: to,
      history: [...current.history, entry],
    },
  };
}

function refusalFor(state: ReportState, type: ReportEventType): string {
  if ((state === 'signed' || state === 'amended') && (type === 'edit' || type === 'sign')) {
    // The message every radiologist will read at some point, so it says what to do.
    return 'Laudo assinado não pode ser editado. Escreva um adendo.';
  }
  if (state === 'addendumDraft' && type === 'sign') {
    return 'Há um adendo em edição — assine o adendo ou descarte-o.';
  }
  if (state === 'draft' && type === 'startAddendum') {
    return 'Não há laudo assinado para complementar.';
  }
  return `Ação não permitida no estado "${STATE_LABELS[state]}".`;
}

function nextVersion(document: ReportDocument): number {
  return (
    document.versions.reduce((max, v) => Math.max(max, Number(v.version) || 0), 0) + 1
  );
}

function lastSignedVersion(document: ReportDocument): ReportVersion | undefined {
  return document.versions.length ? document.versions[document.versions.length - 1] : undefined;
}

function previousSignedState(document: ReportDocument): ReportState {
  return document.versions.some(v => v.kind === 'addendum') ? 'amended' : 'signed';
}

export const STATE_LABELS: Record<ReportState, string> = {
  draft: 'Rascunho',
  preliminary: 'Preliminar',
  signed: 'Assinado',
  addendumDraft: 'Adendo em edição',
  amended: 'Assinado com adendo',
};

/** Whether the body the reader is looking at may still be typed into. */
export function isEditable(document: ReportDocument): boolean {
  return ['draft', 'preliminary', 'addendumDraft'].includes(document?.state);
}

/**
 * Whether any rendering of this report must carry a "preliminary" banner.
 *
 * Exported as its own predicate so a distribution path (PDF, HL7 ORU, portal, print)
 * cannot forget: a preliminary read that reaches a clinician looking like a final report
 * is the failure this state exists to prevent.
 */
export function requiresPreliminaryBanner(document: ReportDocument): boolean {
  return document?.state === 'preliminary';
}

/** Whether the report has ever been signed — i.e. whether anything was distributed. */
export function isSigned(document: ReportDocument): boolean {
  return (document?.versions ?? []).some(v => v.kind === 'report');
}

/** The current version number a recipient should be holding. */
export function currentVersion(document: ReportDocument): number {
  return lastSignedVersion(document)?.version ?? 0;
}

/**
 * The report as it should be read: the signed body plus every addendum, in order.
 *
 * Addenda are appended and labelled, never merged into the original text. A reader has to
 * be able to see what the report said when it was first signed and what was added
 * afterwards — merging them rewrites history in the one document where that is least
 * acceptable.
 */
export function renderFullReport(document: ReportDocument): string {
  const parts: string[] = [];
  for (const version of document?.versions ?? []) {
    const stamp = `${version.signedBy.name}${version.signedBy.registration ? ` (${version.signedBy.registration})` : ''}`;
    if (version.kind === 'addendum') {
      parts.push(`--- ADENDO ${version.version} (complementa a versão ${version.amends ?? '?'}) ---`);
    }
    parts.push(version.body);
    parts.push(`Assinado por ${stamp}.`);
  }
  return parts.join('\n\n');
}

/** One-line status for the panel header. */
export function describeState(document: ReportDocument): string {
  const state = document?.state;
  if (!state) {
    return '';
  }
  const version = currentVersion(document);
  const suffix = version > 0 ? ` · versão ${version}` : '';
  if (state === 'preliminary') {
    return `${STATE_LABELS.preliminary} — NÃO É LAUDO DEFINITIVO${suffix}`;
  }
  return `${STATE_LABELS[state]}${suffix}`;
}
