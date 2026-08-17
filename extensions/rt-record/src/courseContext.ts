/**
 * Course selection, reload and dose corrections — pure core (RTV-180).
 *
 * Three header controls that look unrelated and share one hazard: **each of them changes
 * what the numbers on screen are about, without changing how they look.**
 *
 * ## Switching course must clear everything derived from the old one
 *
 * A cumulative dose, a fraction count, a DVH: computed for course A and left on screen under
 * course B, each is a correct number about a different treatment. Nothing about them looks
 * stale — a cumulative dose of 50 Gy is a plausible cumulative dose for either course.
 *
 * The only safe design is to treat derived state as belonging to the course rather than to
 * the session, so {@link switchCourse} returns a context with it dropped and
 * {@link staleDerivations} names anything a caller retained.
 *
 * ## A patient can have more than one course open at once
 *
 * Bilateral treatment, or a palliative course running alongside a curative one. "The active
 * course" is not a single thing, so a UI that picks the most recent picks arbitrarily — and
 * arbitrary is worse than absent, because it looks decided. {@link resolveActiveCourse}
 * refuses to choose.
 *
 * ## A dose correction is a manual write to the delivered dose
 *
 * It is not an edit to a delivered record — that record is what the machine reported and
 * stays as it is (`treatmentAudit.ts`, RTV-178). A correction is a separate, attributable
 * entry that says the accounting was wrong, and it changes the number a physician uses to
 * decide whether the prescription is complete. So it needs a reference point, an amount, a
 * reason, an authoriser, and it has to surface what it did to the total.
 *
 * A correction with no reference point is a number added to nothing in particular: dose at
 * the prescription point and dose at an organ-at-risk point are different quantities, and
 * adding to "the dose" silently picks one.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type CourseIntent = 'curative' | 'palliative' | 'adjuvant' | 'neoadjuvant' | 'unknown';

export const INTENT_LABELS: Record<CourseIntent, string> = {
  curative: 'curativo',
  palliative: 'paliativo',
  adjuvant: 'adjuvante',
  neoadjuvant: 'neoadjuvante',
  unknown: 'intenção não registrada',
};

export interface Course {
  courseId: string;
  patientId: string;
  label: string;
  intent: CourseIntent;
  /** Anatomical site, so two open courses can be told apart. */
  site: string;
  startedAt: number;
  /** Set when the course is finished. */
  completedAt?: number;
}

/** Values computed from a course, which must not outlive a switch. */
export type DerivedKind =
  | 'cumulative-dose'
  | 'fraction-count'
  | 'dvh'
  | 'trend'
  | 'session-list';

export const DERIVED_LABELS: Record<DerivedKind, string> = {
  'cumulative-dose': 'dose acumulada',
  'fraction-count': 'contagem de frações',
  dvh: 'DVH',
  trend: 'tendências',
  'session-list': 'lista de sessões',
};

export interface CourseContext {
  courseId: string | null;
  patientId: string;
  /** Which derived values are currently valid, and for which course. */
  derived: Partial<Record<DerivedKind, { courseId: string; computedAt: number }>>;
  loadedAt: number;
}

const text = (value: unknown): string => String(value ?? '').trim();
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

export interface ActiveCourseResult {
  course: Course | null;
  candidates: Course[];
  ok: boolean;
  message: string;
}

/**
 * The course to show, or a refusal to pick one.
 *
 * More than one open course is normal — bilateral treatment, or a palliative course running
 * alongside a curative one. Choosing the most recent is arbitrary, and arbitrary is worse
 * than absent because it looks decided.
 */
export function resolveActiveCourse(courses: Course[], patientId: string): ActiveCourseResult {
  const id = text(patientId);
  const mine = (courses ?? []).filter(c => c && text(c.patientId) === id);
  const open = mine.filter(c => !Number.isFinite(num(c.completedAt)));

  if (!mine.length) {
    return { course: null, candidates: [], ok: false, message: 'Paciente sem curso registrado.' };
  }
  if (open.length === 1) {
    return { course: open[0], candidates: open, ok: true, message: '' };
  }
  if (open.length > 1) {
    return {
      course: null,
      candidates: open,
      ok: false,
      message:
        `${open.length} cursos abertos (${open.map(c => `${c.label} — ${c.site}, ${INTENT_LABELS[c.intent]}`).join('; ')}). ` +
        'Mais de um curso aberto é normal: tratamento bilateral, ou um paliativo correndo ao lado de um curativo. ' +
        'Escolher o mais recente é arbitrário, e arbitrário é pior que ausente porque parece decidido.',
    };
  }

  const closed = mine.slice().sort((a, b) => num(b.completedAt) - num(a.completedAt));
  return {
    course: null,
    candidates: closed,
    ok: false,
    message: `Nenhum curso aberto. ${closed.length} encerrado(s) — escolha explicitamente qual revisar.`,
  };
}

export function initialContext(patientId: string, loadedAt: number): CourseContext {
  return { courseId: null, patientId: text(patientId), derived: {}, loadedAt: num(loadedAt) };
}

/**
 * Switches course and drops everything derived from the previous one.
 *
 * The drop is unconditional. A cumulative dose of 50 Gy is a plausible cumulative dose for
 * either course, so there is no value that can be inspected and kept.
 */
export function switchCourse(
  context: CourseContext,
  courseId: string,
  at: number
): { context: CourseContext; dropped: DerivedKind[] } {
  const target = text(courseId);
  const dropped = (Object.keys(context?.derived ?? {}) as DerivedKind[]).filter(
    kind => context.derived[kind]?.courseId !== target
  );

  const derived: CourseContext['derived'] = {};
  for (const kind of Object.keys(context?.derived ?? {}) as DerivedKind[]) {
    const entry = context.derived[kind];
    if (entry && entry.courseId === target) {
      derived[kind] = entry;
    }
  }

  return {
    context: { ...context, courseId: target, derived, loadedAt: num(at) },
    dropped,
  };
}

export interface StaleDerivation {
  kind: DerivedKind;
  belongsTo: string;
  message: string;
}

/**
 * Derived values on screen that belong to another course.
 *
 * Exists because the drop can only cover state the context knows about, and a panel that
 * cached its own number is exactly where this failure survives.
 */
export function staleDerivations(context: CourseContext): StaleDerivation[] {
  const current = text(context?.courseId);
  return (Object.keys(context?.derived ?? {}) as DerivedKind[])
    .filter(kind => context.derived[kind]?.courseId !== current)
    .map(kind => ({
      kind,
      belongsTo: context.derived[kind]?.courseId ?? '',
      message:
        `${DERIVED_LABELS[kind]} foi calculada para o curso ${context.derived[kind]?.courseId} e está sendo exibida sob ${current || 'nenhum curso'}. ` +
        'É um número correto sobre outro tratamento, e nada nele parece velho.',
    }));
}

export interface ReloadResult {
  context: CourseContext;
  ok: boolean;
  reason?: string;
  message: string;
}

/**
 * Reloads the patient.
 *
 * Refuses while there is unsaved work. A reload that discards a half-written note is a
 * small loss; one that discards it *and* looks like it succeeded is how the note gets
 * written twice, differently.
 */
export function reloadPatient(
  context: CourseContext,
  input: { at: number; unsavedWork?: string[]; force?: boolean }
): ReloadResult {
  const unsaved = (input?.unsavedWork ?? []).filter(Boolean);
  if (unsaved.length && !input?.force) {
    return {
      context,
      ok: false,
      reason:
        `Há trabalho não salvo: ${unsaved.join(', ')}. Recarregar descartaria — e um descarte que parece bem-sucedido ` +
        'é como a mesma anotação acaba escrita duas vezes, diferente.',
      message: '',
    };
  }

  return {
    ok: true,
    // Everything derived is recomputed after a reload; keeping any of it would mix data from
    // before and after the refetch.
    context: { ...context, derived: {}, loadedAt: num(input.at) },
    message: unsaved.length
      ? `Recarregado descartando ${unsaved.length} item(ns) não salvo(s), a pedido explícito.`
      : 'Recarregado.',
  };
}

export const CORRECTION_REASONS = {
  'accounting-error': 'Erro de contabilização da dose entregue',
  'machine-record-missing': 'Registro de máquina ausente e reconstruído',
  'plan-revision': 'Revisão de plano com recálculo do ponto de referência',
  'external-treatment': 'Dose entregue em outro serviço',
  'transcription-error': 'Erro de transcrição identificado na conferência',
} as const;

export type CorrectionReason = keyof typeof CORRECTION_REASONS;

export interface DoseCorrection {
  id: string;
  courseId: string;
  /** Reference point the correction applies to. */
  referencePointId: string;
  referencePointName: string;
  /** Signed, Gy. Negative removes dose that was counted twice. */
  deltaGy: number;
  reason: CorrectionReason;
  note?: string;
  /** Who entered it. */
  enteredBy: string;
  /** Who authorised it — required, and not the same person. */
  authorisedBy: string;
  at: number;
}

export interface CorrectionResult {
  correction: DoseCorrection | null;
  ok: boolean;
  reason?: string;
  /** What the correction does to the cumulative dose at that point. */
  impact: { beforeGy: number; afterGy: number; deltaGy: number } | null;
  message: string;
}

/**
 * Records a dose correction.
 *
 * A separate, attributable entry rather than an edit to a delivered record: the delivered
 * record is what the machine reported and stays as it is. Requires a reference point,
 * because dose at the prescription point and dose at an organ-at-risk point are different
 * quantities and adding to "the dose" silently picks one.
 *
 * Requires a second person to authorise, because the number it changes is the one a
 * physician uses to decide whether the prescription is complete.
 */
export function recordDoseCorrection(input: {
  id: string;
  courseId: string;
  referencePointId: string;
  referencePointName: string;
  deltaGy: number;
  reason: CorrectionReason;
  note?: string;
  enteredBy: string;
  authorisedBy: string;
  at: number;
  /** Cumulative dose at that reference point before the correction. */
  currentCumulativeGy: number;
}): CorrectionResult {
  const delta = num(input?.deltaGy);
  const current = num(input?.currentCumulativeGy);

  if (!text(input?.courseId)) {
    return { correction: null, ok: false, reason: 'Correção sem curso.', impact: null, message: '' };
  }
  if (!text(input?.referencePointId)) {
    return {
      correction: null,
      ok: false,
      reason:
        'Correção sem ponto de referência. Dose no ponto de prescrição e dose num ponto de órgão de risco são grandezas ' +
        'diferentes, e somar "à dose" escolhe uma em silêncio.',
      impact: null,
      message: '',
    };
  }
  if (!Number.isFinite(delta) || delta === 0) {
    return { correction: null, ok: false, reason: 'Correção sem valor, ou de zero.', impact: null, message: '' };
  }
  if (!input?.reason || !CORRECTION_REASONS[input.reason]) {
    return { correction: null, ok: false, reason: 'Correção exige motivo da lista.', impact: null, message: '' };
  }
  if (!text(input?.enteredBy)) {
    return { correction: null, ok: false, reason: 'Correção sem quem a lançou.', impact: null, message: '' };
  }
  if (!text(input?.authorisedBy)) {
    return {
      correction: null,
      ok: false,
      reason:
        'Correção sem autorização. O número que ela muda é o que um médico usa para decidir se a prescrição está completa.',
      impact: null,
      message: '',
    };
  }
  if (text(input.authorisedBy).toLowerCase() === text(input.enteredBy).toLowerCase()) {
    return {
      correction: null,
      ok: false,
      reason: 'Quem lançou a correção não pode ser quem a autoriza.',
      impact: null,
      message: '',
    };
  }
  if (!Number.isFinite(current)) {
    return {
      correction: null,
      ok: false,
      reason: 'Dose acumulada atual desconhecida — sem ela a correção não pode mostrar o que faz ao total.',
      impact: null,
      message: '',
    };
  }

  const afterGy = current + delta;
  return {
    ok: true,
    impact: { beforeGy: current, afterGy, deltaGy: delta },
    correction: {
      id: text(input.id),
      courseId: text(input.courseId),
      referencePointId: text(input.referencePointId),
      referencePointName: text(input.referencePointName),
      deltaGy: delta,
      reason: input.reason,
      note: text(input.note) || undefined,
      enteredBy: text(input.enteredBy),
      authorisedBy: text(input.authorisedBy),
      at: num(input.at),
    },
    message:
      `${delta > 0 ? '+' : ''}${delta.toFixed(2)} Gy em ${text(input.referencePointName)}: a dose acumulada nesse ponto passa de ` +
      `${current.toFixed(2)} para ${afterGy.toFixed(2)} Gy. ${CORRECTION_REASONS[input.reason]}. ` +
      `Lançado por ${text(input.enteredBy)}, autorizado por ${text(input.authorisedBy)}.`,
  };
}

export interface CorrectedTotal {
  deliveredGy: number;
  correctionGy: number;
  totalGy: number;
  corrections: number;
  message: string;
}

/**
 * The total with corrections kept visible.
 *
 * Folding a correction into the delivered figure produces a number nobody can reconcile
 * against the treatment records — the same reason `manualTreatment.ts` (RTV-177) reports
 * machine and manual doses apart.
 */
export function correctedTotal(
  deliveredGy: number,
  corrections: DoseCorrection[],
  referencePointId: string
): CorrectedTotal {
  const point = text(referencePointId);
  const applicable = (corrections ?? []).filter(c => c && text(c.referencePointId) === point);
  const correctionGy = applicable.reduce((sum, c) => sum + num(c.deltaGy), 0);
  const delivered = num(deliveredGy) || 0;

  return {
    deliveredGy: delivered,
    correctionGy,
    totalGy: delivered + correctionGy,
    corrections: applicable.length,
    message: applicable.length
      ? `${(delivered + correctionGy).toFixed(2)} Gy, dos quais ${correctionGy >= 0 ? '+' : ''}${correctionGy.toFixed(2)} Gy vêm de ` +
        `${applicable.length} correção(ões) manual(is). Dobrar a correção dentro do valor entregue produz um número que ninguém ` +
        'consegue reconciliar contra os registros de tratamento.'
      : `${delivered.toFixed(2)} Gy entregues, sem correções.`,
  };
}

/** One line for the course header. */
export function describeCourseContext(context: CourseContext, courses: Course[]): string {
  const course = (courses ?? []).find(c => c && c.courseId === context.courseId);
  const stale = staleDerivations(context);
  const base = course
    ? `${course.label} — ${course.site}, ${INTENT_LABELS[course.intent]}`
    : 'Nenhum curso selecionado';
  return stale.length ? `${base}. ${stale.map(s => s.message).join(' ')}` : `${base}.`;
}
