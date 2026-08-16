/**
 * Portal correction attached to a fusion record — pure core (RTV-144).
 *
 * A portal or CBCT image is matched against the planning reference; the match yields a
 * displacement; somebody decides what to do about it. The three are separate facts and the
 * record has to keep them separate.
 *
 * ## The fusion shift and the couch shift point in opposite directions
 *
 * The registration answers "how must the acquired image move to land on the reference".
 * The couch answers "how must the patient move to land on the plan". They are the same
 * magnitude with opposite signs, and storing one where the other is expected does not
 * produce a small error: it **doubles** the displacement, because the couch moves the
 * patient the wrong way by exactly the amount it should have moved them the right way.
 *
 * Nothing about the resulting number looks wrong — it is the right size. So
 * {@link couchShiftFromFusion} exists as the only conversion, it is explicit about which
 * direction it takes and which it returns, and `couchShiftMm` and `fusionShiftMm` are
 * different fields on the record rather than one field with a convention in a comment.
 *
 * This is the same failure family as `couchShifts.ts` (RTV-208), one layer earlier.
 *
 * ## Recorded is not applied
 *
 * The match produces a suggestion. Whether the couch actually moved is a different fact,
 * established by a different person at a different moment. A record that stores only the
 * displacement reads, months later, as though the patient was corrected — and if the
 * therapist decided not to move, the course summary is quietly wrong about every fraction
 * it happened on. {@link CorrectionDecision} is required, and "applied" carries who and
 * when.
 *
 * ## Correcting inside the noise makes the treatment worse
 *
 * A 1 mm shift measured on a system with 1.5 mm reproducibility is mostly measurement
 * error. Applying it moves the patient by a random amount every day: it does nothing to the
 * systematic component, which is the one the margin recipe weights three and a half times
 * as heavily (`setupStatistics.ts`, RTV-208), and it **adds** to the random one.
 * {@link belowActionThreshold} says so rather than leaving the therapist to decide alone at
 * the console.
 *
 * ## The reference decides what the number means
 *
 * A correction computed against yesterday's portal measures drift since yesterday. Against
 * the DRR it measures displacement from the plan. Both are useful and only one of them
 * belongs in a systematic-error analysis.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

/** IEC 61217 patient support axes, millimetres. */
export interface Shift3D {
  lateralMm: number;
  longitudinalMm: number;
  verticalMm: number;
}

export type ReferenceKind = 'drr' | 'planning-ct' | 'previous-portal' | 'reference-portal';

export const REFERENCE_LABELS: Record<ReferenceKind, string> = {
  drr: 'DRR do plano',
  'planning-ct': 'CT de planejamento',
  'previous-portal': 'imagem portal anterior',
  'reference-portal': 'imagem portal de referência',
};

/** Only these measure displacement from the plan. */
export const PLAN_REFERENCES: ReferenceKind[] = ['drr', 'planning-ct'];

export type DecisionKind = 'applied' | 'declined' | 'pending';

export interface CorrectionDecision {
  kind: DecisionKind;
  /** Required when applied or declined. */
  by?: string;
  at?: number;
  /** Required when declined — a refusal with no reason is indistinguishable from an oversight. */
  reason?: string;
}

export interface PortalCorrection {
  id: string;
  fusionId: string;
  courseId: string;
  fraction: number;
  acquiredAt: number;
  reference: ReferenceKind;
  /** How the acquired image must move to land on the reference. */
  fusionShiftMm: Shift3D;
  /** How the patient must move to land on the plan. Opposite sign. */
  couchShiftMm: Shift3D;
  rotationDeg?: { pitch: number; roll: number; yaw: number };
  decision: CorrectionDecision;
  matchedBy?: string;
  note?: string;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};
const text = (value: unknown): string => String(value ?? '').trim();

/**
 * The only conversion between the two conventions.
 *
 * A negation, and worth being a named function anyway: the mistake this prevents does not
 * produce an implausible number, it produces one of exactly the right magnitude pointing
 * the wrong way, which doubles the residual displacement instead of removing it.
 */
export function couchShiftFromFusion(fusion: Shift3D): Shift3D {
  return {
    lateralMm: -num(fusion?.lateralMm),
    longitudinalMm: -num(fusion?.longitudinalMm),
    verticalMm: -num(fusion?.verticalMm),
  };
}

/** Magnitude of a shift, millimetres. */
export function shiftMagnitudeMm(shift: Shift3D): number {
  return Math.hypot(num(shift?.lateralMm), num(shift?.longitudinalMm), num(shift?.verticalMm));
}

export interface CorrectionValidation {
  ok: boolean;
  correction: PortalCorrection | null;
  errors: string[];
  warnings: string[];
}

/**
 * Builds a correction record.
 *
 * Derives the couch shift rather than accepting it, so the two fields cannot disagree. A
 * record whose two conventions contradict each other is worse than one that carries only
 * the raw fusion result.
 */
export function recordCorrection(input: {
  id: string;
  fusionId: string;
  courseId: string;
  fraction: number;
  acquiredAt: number;
  reference: ReferenceKind;
  fusionShiftMm: Shift3D;
  rotationDeg?: { pitch: number; roll: number; yaw: number };
  decision: CorrectionDecision;
  matchedBy?: string;
  note?: string;
}): CorrectionValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!text(input?.id) || !text(input?.fusionId) || !text(input?.courseId)) {
    errors.push('Correção sem identificador, fusão ou curso.');
  }
  const fraction = num(input?.fraction);
  if (!Number.isFinite(fraction) || fraction < 1) {
    errors.push('Correção sem número de fração.');
  }
  if (!REFERENCE_LABELS[input?.reference]) {
    errors.push('Referência do casamento não informada.');
  }
  const shift = input?.fusionShiftMm;
  if (
    !shift ||
    !Number.isFinite(num(shift.lateralMm)) ||
    !Number.isFinite(num(shift.longitudinalMm)) ||
    !Number.isFinite(num(shift.verticalMm))
  ) {
    errors.push('Deslocamento da fusão incompleto.');
  }

  const decision = input?.decision;
  if (!decision || !['applied', 'declined', 'pending'].includes(decision.kind)) {
    errors.push('Correção sem decisão. Deslocamento medido não é deslocamento aplicado.');
  } else {
    if (decision.kind !== 'pending' && !text(decision.by)) {
      errors.push('Decisão sem responsável.');
    }
    if (decision.kind === 'declined' && !text(decision.reason)) {
      errors.push(
        'Correção recusada sem motivo. Uma recusa sem justificativa é indistinguível de um esquecimento no registro.'
      );
    }
  }

  if (input?.reference && !PLAN_REFERENCES.includes(input.reference)) {
    warnings.push(
      `Casamento contra ${REFERENCE_LABELS[input.reference]}: isso mede a deriva desde aquela imagem, não o deslocamento em relação ao plano. ` +
        'Não serve para a estatística de erro sistemático.'
    );
  }

  if (errors.length) {
    return { ok: false, correction: null, errors, warnings };
  }

  return {
    ok: true,
    errors,
    warnings,
    correction: {
      id: text(input.id),
      fusionId: text(input.fusionId),
      courseId: text(input.courseId),
      fraction,
      acquiredAt: num(input.acquiredAt),
      reference: input.reference,
      fusionShiftMm: {
        lateralMm: num(shift.lateralMm),
        longitudinalMm: num(shift.longitudinalMm),
        verticalMm: num(shift.verticalMm),
      },
      couchShiftMm: couchShiftFromFusion(shift),
      rotationDeg: input.rotationDeg,
      decision: input.decision,
      matchedBy: text(input.matchedBy) || undefined,
      note: text(input.note) || undefined,
    },
  };
}

export interface ThresholdNote {
  below: boolean;
  magnitudeMm: number;
  message: string;
}

/** Default action threshold, millimetres. Below it, moving is usually not an improvement. */
export const ACTION_THRESHOLD_MM = 3;

/**
 * Whether the measured shift is inside the noise.
 *
 * Applying a displacement that is mostly measurement error moves the patient by a random
 * amount every day: it leaves the systematic component untouched — the one the margin
 * recipe weights three and a half times as heavily — and adds to the random one. Stating it
 * here is better than leaving the therapist to reason about it alone at the console.
 */
export function belowActionThreshold(
  correction: PortalCorrection,
  thresholdMm = ACTION_THRESHOLD_MM
): ThresholdNote {
  const magnitudeMm = shiftMagnitudeMm(correction?.couchShiftMm);
  const limit = Math.max(0, num(thresholdMm) || ACTION_THRESHOLD_MM);
  if (!(magnitudeMm < limit)) {
    return { below: false, magnitudeMm, message: '' };
  }
  return {
    below: true,
    magnitudeMm,
    message:
      `Deslocamento de ${magnitudeMm.toFixed(1)} mm, abaixo do limiar de ação de ${limit} mm. ` +
      'Corrigir dentro do ruído move o paciente por uma quantidade aleatória a cada dia: não reduz o erro sistemático, que é o que a receita de margem pesa três vezes e meia mais, e soma ao aleatório.',
  };
}

export interface AppliedSummary {
  fractions: number;
  applied: number;
  declined: number;
  pending: number;
  /** Mean couch shift over the fractions where it was actually applied. */
  appliedMeanMm: Shift3D | null;
  /** Mean measured shift over all fractions, applied or not. */
  measuredMeanMm: Shift3D | null;
  message: string;
}

/**
 * The course view, with measured and applied kept apart.
 *
 * A summary built from the measured displacements describes a treatment that did not
 * happen wherever the therapist declined to move. Both means are reported because the
 * difference between them is the residual the patient actually received.
 */
export function summariseCorrections(corrections: PortalCorrection[]): AppliedSummary {
  const list = (corrections ?? []).filter(Boolean);
  const applied = list.filter(c => c.decision.kind === 'applied');
  const declined = list.filter(c => c.decision.kind === 'declined');
  const pending = list.filter(c => c.decision.kind === 'pending');

  const mean = (items: PortalCorrection[]): Shift3D | null => {
    if (!items.length) {
      return null;
    }
    return {
      lateralMm: items.reduce((s, c) => s + num(c.couchShiftMm.lateralMm), 0) / items.length,
      longitudinalMm: items.reduce((s, c) => s + num(c.couchShiftMm.longitudinalMm), 0) / items.length,
      verticalMm: items.reduce((s, c) => s + num(c.couchShiftMm.verticalMm), 0) / items.length,
    };
  };

  const parts = [`${list.length} fração(ões) com imagem: ${applied.length} corrigida(s), ${declined.length} recusada(s), ${pending.length} pendente(s).`];
  if (declined.length) {
    parts.push(
      'A média medida inclui frações em que ninguém moveu a mesa — um resumo feito só dela descreve um tratamento que não aconteceu.'
    );
  }

  return {
    fractions: list.length,
    applied: applied.length,
    declined: declined.length,
    pending: pending.length,
    appliedMeanMm: mean(applied),
    measuredMeanMm: mean(list),
    message: parts.join(' '),
  };
}

export interface CorrectionAmendment {
  correction: PortalCorrection | null;
  ok: boolean;
  reason?: string;
  changes: Array<{ field: string; from: unknown; to: unknown }>;
}

/**
 * Changes the decision on a correction.
 *
 * The displacement itself is not editable: it is what the match produced, and editing it
 * turns a measurement into an opinion with no record of which it was. A different match
 * is a new correction.
 */
export function amendDecision(
  current: PortalCorrection,
  decision: CorrectionDecision
): CorrectionAmendment {
  if (!current) {
    return { correction: null, ok: false, reason: 'Correção ausente.', changes: [] };
  }
  if (!decision || !['applied', 'declined', 'pending'].includes(decision.kind)) {
    return { correction: current, ok: false, reason: 'Decisão inválida.', changes: [] };
  }
  if (decision.kind !== 'pending' && !text(decision.by)) {
    return { correction: current, ok: false, reason: 'Decisão sem responsável.', changes: [] };
  }
  if (decision.kind === 'declined' && !text(decision.reason)) {
    return { correction: current, ok: false, reason: 'Recusa sem motivo.', changes: [] };
  }

  return {
    ok: true,
    correction: { ...current, decision },
    changes: [
      { field: 'decision.kind', from: current.decision.kind, to: decision.kind },
      { field: 'decision.by', from: current.decision.by, to: decision.by },
    ],
  };
}

/** One line per correction for the fusion timeline. */
export function describeCorrection(correction: PortalCorrection): string {
  const shift = correction.couchShiftMm;
  const magnitude = shiftMagnitudeMm(shift).toFixed(1);
  const decision =
    correction.decision.kind === 'applied'
      ? `aplicada por ${correction.decision.by}`
      : correction.decision.kind === 'declined'
        ? `recusada por ${correction.decision.by} — ${correction.decision.reason}`
        : 'pendente';
  return (
    `Fração ${correction.fraction} · mesa ${shift.lateralMm.toFixed(1)}/${shift.longitudinalMm.toFixed(1)}/${shift.verticalMm.toFixed(1)} mm ` +
    `(${magnitude} mm) vs ${REFERENCE_LABELS[correction.reference]} · ${decision}`
  );
}
