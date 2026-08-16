/**
 * Editing and retiring treatment records, and the log that survives it — pure core
 * (RTV-178).
 *
 * The counterpart to `manualTreatment.ts` (RTV-177): what may be changed after a record
 * exists, and what has to remain visible afterwards.
 *
 * ## Deleting is never deleting
 *
 * A treatment record is a clinical-legal document. Removing one makes the delivered dose
 * lower than it was, and it does so **retroactively and silently**: the course summary
 * simply shows a smaller number, with nothing on the screen indicating that it used to show
 * a larger one. Anybody who acted on the earlier number — a physicist approving a boost, a
 * physician deciding the prescription was complete — did so on a total that no longer
 * exists anywhere.
 *
 * So {@link retireRecord} writes a tombstone. The record stays, marked retired with who,
 * when and why; the totals exclude it and {@link summariseWithAudit} says so out loud.
 *
 * ## Only a manual record may be retired
 *
 * A machine record is evidence that the linac delivered something. A user cannot make that
 * untrue by clicking delete. If it is wrong, that is an equipment or data-transfer fault
 * and belongs to a different conversation — one that starts with the machine, not with the
 * record. {@link retireRecord} refuses.
 *
 * ## "Edited" is not an audit entry
 *
 * A log saying the dose field was edited answers nothing. The question an audit asks is
 * *what did it say before*, because the interesting edits are the ones that changed a
 * number somebody had already acted on. Every amendment carries the old and the new value
 * side by side, and the previous version is kept.
 *
 * ## The summary has to be reconstructible at a past moment
 *
 * "What did the cumulative dose read when the boost was approved?" is the question, and it
 * cannot be answered by a current-state table. {@link stateAt} replays the log.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

import { summariseCourse, TreatmentRecord } from './manualTreatment';

export type AuditAction = 'insert' | 'amend' | 'retire' | 'restore';

export const RETIRE_REASONS = {
  duplicate: 'Duplicata de um registro já existente',
  'superseded-by-machine-record': 'Substituído pelo registro que a máquina enviou depois',
  'wrong-patient': 'Lançado no paciente errado',
  'wrong-course': 'Lançado no curso errado',
  'entered-in-error': 'Lançado por engano',
} as const;

export type RetireReason = keyof typeof RETIRE_REASONS;

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface AuditEntry {
  id: string;
  recordId: string;
  courseId: string;
  action: AuditAction;
  at: number;
  by: string;
  reason: string;
  /** Present on an amendment: old and new, side by side. */
  changes?: FieldChange[];
  /** The record as it stood after this entry. Null after a retire. */
  snapshot: TreatmentRecord | null;
}

const text = (value: unknown): string => String(value ?? '').trim();
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

export interface AuditResult {
  entry: AuditEntry | null;
  record: TreatmentRecord | null;
  ok: boolean;
  reason?: string;
}

/** Field-by-field difference, comparing scalars and stringifying the rest. */
export function diffRecords(before: TreatmentRecord, after: TreatmentRecord): FieldChange[] {
  const changes: FieldChange[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    const a = (before as Record<string, unknown>)?.[key];
    const b = (after as Record<string, unknown>)?.[key];
    const same =
      typeof a === 'object' || typeof b === 'object'
        ? JSON.stringify(a) === JSON.stringify(b)
        : a === b;
    if (!same) {
      changes.push({ field: key, from: a, to: b });
    }
  }
  return changes.sort((x, y) => x.field.localeCompare(y.field));
}

export function insertRecord(
  record: TreatmentRecord,
  by: string,
  at: number,
  entryId: string
): AuditResult {
  if (!record || !text(record.id)) {
    return { entry: null, record: null, ok: false, reason: 'Registro sem identificador.' };
  }
  if (!text(by)) {
    return { entry: null, record: null, ok: false, reason: 'Inserção sem autor.' };
  }
  return {
    ok: true,
    record,
    entry: {
      id: text(entryId),
      recordId: record.id,
      courseId: record.courseId,
      action: 'insert',
      at: Number(at),
      by: text(by),
      reason: 'Inserção',
      snapshot: record,
    },
  };
}

/**
 * Amends a record, keeping both values.
 *
 * A reason is required because the edits that matter are the ones that changed a number
 * somebody had already acted on, and six months later the diff alone will not say whether
 * the original was a typo or a different delivery.
 */
export function amendRecord(
  current: TreatmentRecord,
  patch: Partial<TreatmentRecord>,
  input: { by: string; at: number; reason: string; entryId: string }
): AuditResult {
  if (!current) {
    return { entry: null, record: null, ok: false, reason: 'Registro ausente.' };
  }
  if (!text(input?.by)) {
    return { entry: null, record: null, ok: false, reason: 'Alteração sem autor.' };
  }
  if (!text(input?.reason)) {
    return {
      entry: null,
      record: null,
      ok: false,
      reason:
        'Alteração sem motivo. Daqui a seis meses o diff sozinho não diz se o valor original era erro de digitação ou uma entrega diferente.',
    };
  }

  // Pinned, and refused loudly rather than silently ignored: an operator who asked to move
  // a fraction to another course and got "nothing changed" will try again some other way.
  if (patch && ((patch.id && patch.id !== current.id) || (patch.courseId && patch.courseId !== current.courseId))) {
    return {
      entry: null,
      record: current,
      ok: false,
      reason:
        'Alteração não pode mudar o identificador nem o curso do registro. Lançado no curso errado se resolve baixando o registro e inserindo no curso certo, ' +
        'para que os dois cursos guardem o que aconteceu.',
    };
  }

  const next = { ...current, ...patch, id: current.id, courseId: current.courseId } as TreatmentRecord;
  const changes = diffRecords(current, next);
  if (!changes.length) {
    return { entry: null, record: current, ok: false, reason: 'Nada mudou.' };
  }

  return {
    ok: true,
    record: next,
    entry: {
      id: text(input.entryId),
      recordId: current.id,
      courseId: current.courseId,
      action: 'amend',
      at: Number(input.at),
      by: text(input.by),
      reason: text(input.reason),
      changes,
      snapshot: next,
    },
  };
}

/**
 * Retires a record without removing it.
 *
 * Refuses a machine record: a user cannot make it untrue that the linac delivered something
 * by clicking delete. If the machine record is wrong, that is an equipment or data-transfer
 * fault, and it belongs to a conversation that starts with the machine.
 */
export function retireRecord(
  current: TreatmentRecord,
  input: { by: string; at: number; reason: RetireReason; note?: string; entryId: string }
): AuditResult {
  if (!current) {
    return { entry: null, record: null, ok: false, reason: 'Registro ausente.' };
  }
  if (current.provenance?.origin !== 'manual') {
    return {
      entry: null,
      record: current,
      ok: false,
      reason:
        'Só registro manual pode ser baixado. Um registro de máquina é evidência de que o acelerador entregou algo, ' +
        'e ninguém torna isso falso apagando a linha — se ele está errado, é falha de equipamento ou de transferência de dado, ' +
        'e a conversa começa na máquina.',
    };
  }
  if (!text(input?.by)) {
    return { entry: null, record: current, ok: false, reason: 'Baixa sem autor.' };
  }
  if (!input?.reason || !RETIRE_REASONS[input.reason]) {
    return {
      entry: null,
      record: current,
      ok: false,
      reason: 'Baixa exige um motivo da lista.',
    };
  }

  return {
    ok: true,
    record: null,
    entry: {
      id: text(input.entryId),
      recordId: current.id,
      courseId: current.courseId,
      action: 'retire',
      at: Number(input.at),
      by: text(input.by),
      reason: text(input.note)
        ? `${RETIRE_REASONS[input.reason]} — ${text(input.note)}`
        : RETIRE_REASONS[input.reason],
      snapshot: null,
    },
  };
}

/** Puts a retired record back, with its own entry. */
export function restoreRecord(
  retired: TreatmentRecord,
  input: { by: string; at: number; reason: string; entryId: string }
): AuditResult {
  if (!retired || !text(input?.by) || !text(input?.reason)) {
    return { entry: null, record: null, ok: false, reason: 'Restauração exige registro, autor e motivo.' };
  }
  return {
    ok: true,
    record: retired,
    entry: {
      id: text(input.entryId),
      recordId: retired.id,
      courseId: retired.courseId,
      action: 'restore',
      at: Number(input.at),
      by: text(input.by),
      reason: text(input.reason),
      snapshot: retired,
    },
  };
}

export interface ReplayState {
  /** Records live at the replayed moment. */
  active: TreatmentRecord[];
  /** Records retired at the replayed moment, with their last snapshot. */
  retired: Array<{ record: TreatmentRecord; retiredAt: number; by: string; reason: string }>;
}

/**
 * The state of the course at a moment in the past.
 *
 * A current-state table cannot answer "what did the cumulative dose read when the boost was
 * approved", and that is the question an audit asks.
 */
export function stateAt(log: AuditEntry[], at: number): ReplayState {
  const cutoff = Number(at);
  const entries = (log ?? [])
    .filter(e => e && Number.isFinite(num(e.at)) && e.at <= cutoff)
    .slice()
    .sort((a, b) => a.at - b.at);

  const latest = new Map<string, TreatmentRecord>();
  const tombstones = new Map<string, { record: TreatmentRecord; retiredAt: number; by: string; reason: string }>();

  for (const entry of entries) {
    if (entry.action === 'retire') {
      const record = latest.get(entry.recordId);
      if (record) {
        tombstones.set(entry.recordId, {
          record,
          retiredAt: entry.at,
          by: entry.by,
          reason: entry.reason,
        });
        latest.delete(entry.recordId);
      }
      continue;
    }
    if (entry.snapshot) {
      latest.set(entry.recordId, entry.snapshot);
      tombstones.delete(entry.recordId);
    }
  }

  return { active: [...latest.values()], retired: [...tombstones.values()] };
}

export interface DoseImpact {
  beforeGy: number;
  afterGy: number;
  deltaGy: number;
  changed: boolean;
  message: string;
}

/**
 * What a change did to the cumulative dose.
 *
 * Surfaced explicitly because the failure is silent by nature: the summary simply shows a
 * different number, and nothing on the screen says it used to show another one.
 */
export function doseImpact(before: TreatmentRecord[], after: TreatmentRecord[]): DoseImpact {
  const beforeGy = summariseCourse(before).totalGy;
  const afterGy = summariseCourse(after).totalGy;
  const deltaGy = afterGy - beforeGy;
  const changed = Math.abs(deltaGy) > 1e-9;
  return {
    beforeGy,
    afterGy,
    deltaGy,
    changed,
    message: changed
      ? `Dose acumulada do curso passa de ${beforeGy.toFixed(2)} Gy para ${afterGy.toFixed(2)} Gy (${deltaGy > 0 ? '+' : ''}${deltaGy.toFixed(2)} Gy).`
      : '',
  };
}

export interface AuditedSummary {
  totalGy: number;
  manualGy: number;
  retiredGy: number;
  retiredCount: number;
  message: string;
}

/**
 * The course total with the retired records accounted for out loud.
 *
 * Excluding them silently means the number drops and nobody knows why — which is the exact
 * failure the tombstone exists to prevent, reintroduced at the reporting layer.
 */
export function summariseWithAudit(state: ReplayState): AuditedSummary {
  const base = summariseCourse(state?.active ?? []);
  const retiredGy = (state?.retired ?? []).reduce((sum, t) => sum + (num(t.record?.doseGy) || 0), 0);
  const retiredCount = (state?.retired ?? []).length;

  const parts = [base.message];
  if (retiredCount) {
    parts.push(
      `${retiredCount} registro(s) baixado(s) somando ${retiredGy.toFixed(2)} Gy estão fora deste total. ` +
        'Excluí-los em silêncio faria o número cair sem ninguém saber por quê.'
    );
  }

  return {
    totalGy: base.totalGy,
    manualGy: base.manualGy,
    retiredGy,
    retiredCount,
    message: parts.join(' '),
  };
}

/** One line per audit entry. */
export function describeEntry(entry: AuditEntry): string {
  if (!entry) {
    return '';
  }
  const who = `${entry.by}`;
  if (entry.action === 'amend' && entry.changes?.length) {
    const changes = entry.changes
      .map(c => `${c.field}: ${format(c.from)} -> ${format(c.to)}`)
      .join('; ');
    return `Alterado por ${who} — ${entry.reason}. ${changes}`;
  }
  if (entry.action === 'retire') {
    return `Baixado por ${who} — ${entry.reason}. O registro continua no histórico.`;
  }
  if (entry.action === 'restore') {
    return `Restaurado por ${who} — ${entry.reason}.`;
  }
  return `Inserido por ${who}.`;
}

function format(value: unknown): string {
  if (value === undefined) {
    return '(vazio)';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
