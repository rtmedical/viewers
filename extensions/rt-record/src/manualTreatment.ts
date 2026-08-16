/**
 * Manually entered treatment records — pure core (RTV-177).
 *
 * A course sometimes has fractions the record system never received: the linac failed to
 * export, the patient was treated at another facility, brachytherapy was delivered on
 * equipment that speaks no DICOM. The dose was delivered either way, and a course summary
 * that omits it is wrong in the dangerous direction.
 *
 * ## A manual record must never be indistinguishable from a delivered one
 *
 * This is the rule everything else here serves. Once inserted, a manual record flows into
 * the same cumulative dose, the same fraction count and the same course summary as a record
 * the machine produced — and those numbers get used to decide whether the patient has had
 * their prescription. A machine record is evidence that a delivery happened as described. A
 * manual record is somebody's recollection of it, typed later.
 *
 * They are both worth having and they are not the same claim, so
 * {@link markProvenance} is not optional and {@link summariseCourse} reports the two
 * separately rather than adding them into one total.
 *
 * ## Why it is missing changes what it means
 *
 * "Treated at another facility" and "our record system dropped it" produce the same missing
 * fraction and imply completely different follow-up: one is a data transfer to chase, the
 * other is an equipment fault that is probably still happening. {@link MISSING_REASONS} is
 * a closed list for that reason — free text here becomes "n/a" within a month.
 *
 * ## External beam and brachytherapy do not share a shape
 *
 * A brachytherapy delivery has no beams, no monitor units and no gantry; it has sources,
 * dwell positions and dwell times, and its "fraction" is an implantation or an insertion.
 * Forcing both into one record with a `doseGy` and a `fractionNumber` produces fields that
 * are empty for half the cases and, worse, fields that are *filled with the wrong kind of
 * number* for the other half. The two are separate shapes here.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type RecordOrigin = 'delivered' | 'manual';

export const MISSING_REASONS = {
  'external-facility': 'Tratamento realizado em outro serviço',
  'export-failed': 'O acelerador não exportou o registro',
  'equipment-offline': 'Equipamento sem integração DICOM',
  'record-lost': 'Registro perdido na migração ou no arquivo',
  'retrospective-entry': 'Curso iniciado antes da implantação do sistema',
} as const;

export type MissingReason = keyof typeof MISSING_REASONS;

export interface Provenance {
  origin: RecordOrigin;
  /** Required for a manual record. */
  reason?: MissingReason;
  /** Who typed it. */
  enteredBy?: string;
  enteredAt?: number;
  /** Free-text detail, in addition to — never instead of — the coded reason. */
  note?: string;
}

export interface ExternalBeamRecord {
  kind: 'external-beam';
  id: string;
  courseId: string;
  fractionNumber: number;
  /** Epoch ms of delivery, not of data entry. */
  deliveredAt: number;
  /** Dose delivered at the prescription point, Gy. */
  doseGy: number;
  beams: Array<{ name: string; monitorUnits?: number; energyMv?: number }>;
  machine?: string;
  provenance: Provenance;
}

export interface BrachyRecord {
  kind: 'brachy';
  id: string;
  courseId: string;
  /** Insertions are numbered, not fractionated in the external-beam sense. */
  insertionNumber: number;
  deliveredAt: number;
  /** Dose at the prescription point, Gy. */
  doseGy: number;
  /** Radionuclide, e.g. Ir-192. */
  nuclide: string;
  /** Total dwell time across all positions, seconds. */
  totalDwellSec: number;
  /** Source strength at delivery, air kerma rate in µGy·m²/h. */
  sourceStrength?: number;
  applicator?: string;
  provenance: Provenance;
}

export type TreatmentRecord = ExternalBeamRecord | BrachyRecord;

export interface ValidationResult {
  ok: boolean;
  record: TreatmentRecord | null;
  errors: string[];
  warnings: string[];
}

const text = (value: unknown): string => String(value ?? '').trim();
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Stamps a record as manual.
 *
 * Refuses without a coded reason and an author. A manual record with no reason is a number
 * in the cumulative dose that nobody can account for later, and the person who could have
 * explained it has left.
 */
export function markProvenance(input: {
  reason: MissingReason;
  enteredBy: string;
  enteredAt: number;
  note?: string;
}): { provenance: Provenance | null; ok: boolean; reason?: string } {
  const reason = input?.reason;
  if (!reason || !MISSING_REASONS[reason]) {
    return {
      provenance: null,
      ok: false,
      reason:
        'Registro manual exige um motivo da lista. "Tratado em outro serviço" e "nosso sistema perdeu o registro" ' +
        'produzem a mesma fração faltante e pedem providências completamente diferentes — uma é transferência de dado a cobrar, ' +
        'a outra é falha de equipamento que provavelmente continua acontecendo.',
    };
  }
  if (!text(input?.enteredBy)) {
    return { provenance: null, ok: false, reason: 'Registro manual exige quem o inseriu.' };
  }
  if (!Number.isFinite(num(input?.enteredAt))) {
    return { provenance: null, ok: false, reason: 'Registro manual exige a data de inserção.' };
  }
  return {
    ok: true,
    provenance: {
      origin: 'manual',
      reason,
      enteredBy: text(input.enteredBy),
      enteredAt: Number(input.enteredAt),
      note: text(input.note) ? text(input.note) : undefined,
    },
  };
}

function validateCommon(
  record: Partial<TreatmentRecord>,
  now: number,
  errors: string[],
  warnings: string[]
): void {
  if (!text(record?.id)) {
    errors.push('Registro sem identificador.');
  }
  if (!text(record?.courseId)) {
    errors.push('Registro sem curso.');
  }
  const deliveredAt = num(record?.deliveredAt);
  if (!Number.isFinite(deliveredAt)) {
    errors.push('Registro sem data de entrega.');
  } else if (deliveredAt > now) {
    errors.push('Data de entrega no futuro.');
  }
  const dose = num((record as { doseGy?: number })?.doseGy);
  if (!Number.isFinite(dose) || dose <= 0) {
    errors.push('Dose entregue ausente ou não positiva.');
  }
  if (record?.provenance?.origin !== 'manual') {
    errors.push('Inserção manual precisa estar marcada como manual — um registro manual indistinguível de um entregue é o problema, não a solução.');
  } else if (!record.provenance.reason) {
    errors.push('Registro manual sem motivo codificado.');
  }
  const entered = num(record?.provenance?.enteredAt);
  if (Number.isFinite(entered) && Number.isFinite(deliveredAt) && entered < deliveredAt) {
    warnings.push('Inserido antes da data de entrega informada — confira as duas datas.');
  }
}

/** Validates an external-beam fraction typed by hand. */
export function validateExternalBeam(
  record: Partial<ExternalBeamRecord>,
  now: number
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  validateCommon(record, now, errors, warnings);

  const fraction = num(record?.fractionNumber);
  if (!Number.isFinite(fraction) || fraction < 1 || Math.floor(fraction) !== fraction) {
    errors.push('Número de fração ausente ou inválido.');
  }
  const beams = record?.beams ?? [];
  if (!beams.length) {
    warnings.push(
      'Nenhum feixe informado. A dose entra na soma do curso, mas a fração não poderá ser conferida contra o plano feixe a feixe.'
    );
  }
  if (!text(record?.machine)) {
    warnings.push('Sem máquina informada — a estatística por acelerador vai ignorar esta fração.');
  }

  return {
    ok: !errors.length,
    record: errors.length ? null : ({ ...record, kind: 'external-beam' } as ExternalBeamRecord),
    errors,
    warnings,
  };
}

/**
 * Validates a brachytherapy insertion typed by hand.
 *
 * Deliberately a different function with different required fields. A single form with a
 * `fractionNumber` and a `monitorUnits` invites an operator to type a beam count into a
 * dwell record, and the resulting row is not empty — it is wrong.
 */
export function validateBrachy(record: Partial<BrachyRecord>, now: number): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  validateCommon(record, now, errors, warnings);

  const insertion = num(record?.insertionNumber);
  if (!Number.isFinite(insertion) || insertion < 1) {
    errors.push('Número de inserção ausente ou inválido.');
  }
  if (!text(record?.nuclide)) {
    errors.push('Radionuclídeo ausente — sem ele a dose não pode ser conferida contra o tempo de permanência.');
  }
  const dwell = num(record?.totalDwellSec);
  if (!Number.isFinite(dwell) || dwell <= 0) {
    errors.push('Tempo total de permanência ausente ou não positivo.');
  }
  if (!Number.isFinite(num(record?.sourceStrength))) {
    warnings.push(
      'Sem intensidade da fonte. A dose informada não poderá ser conferida contra tempo de permanência e decaimento, ' +
        'que é a única checagem independente disponível num registro digitado.'
    );
  }
  if (!text(record?.applicator)) {
    warnings.push('Sem aplicador informado.');
  }

  return {
    ok: !errors.length,
    record: errors.length ? null : ({ ...record, kind: 'brachy' } as BrachyRecord),
    errors,
    warnings,
  };
}

export interface CourseSummary {
  /** Dose from records the machine produced. */
  deliveredGy: number;
  /** Dose from records somebody typed. */
  manualGy: number;
  totalGy: number;
  deliveredFractions: number;
  manualFractions: number;
  brachyInsertions: number;
  /** Coded reasons present, with counts. */
  manualReasons: Array<{ reason: MissingReason; label: string; count: number }>;
  message: string;
}

/**
 * The course total, with the two kinds of evidence kept apart.
 *
 * Adding them into one number would be convenient and would erase the only thing that
 * distinguishes "the machine says it delivered 50 Gy" from "someone remembers 50 Gy being
 * delivered". Both belong in the summary; only one of them is a measurement.
 */
export function summariseCourse(records: TreatmentRecord[]): CourseSummary {
  const list = (records ?? []).filter(Boolean);
  let deliveredGy = 0;
  let manualGy = 0;
  let deliveredFractions = 0;
  let manualFractions = 0;
  let brachyInsertions = 0;
  const reasons = new Map<MissingReason, number>();

  for (const record of list) {
    const dose = num(record.doseGy);
    const isManual = record.provenance?.origin === 'manual';
    if (Number.isFinite(dose)) {
      if (isManual) {
        manualGy += dose;
      } else {
        deliveredGy += dose;
      }
    }
    if (record.kind === 'brachy') {
      brachyInsertions++;
    }
    if (isManual) {
      manualFractions++;
      const reason = record.provenance?.reason;
      if (reason) {
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
    } else {
      deliveredFractions++;
    }
  }

  const manualReasons = [...reasons.entries()].map(([reason, count]) => ({
    reason,
    label: MISSING_REASONS[reason],
    count,
  }));

  const totalGy = deliveredGy + manualGy;
  const parts = [`${totalGy.toFixed(2)} Gy no total.`];
  if (manualGy > 0) {
    parts.push(
      `${manualGy.toFixed(2)} Gy vêm de ${manualFractions} registro(s) digitado(s) — ` +
        'um registro de máquina é evidência de que a entrega aconteceu como descrita; um registro manual é a lembrança de alguém, digitada depois. ' +
        `Motivos: ${manualReasons.map(r => `${r.label} (${r.count})`).join(', ')}.`
    );
  }

  return {
    deliveredGy,
    manualGy,
    totalGy,
    deliveredFractions,
    manualFractions,
    brachyInsertions,
    manualReasons,
    message: parts.join(' '),
  };
}

export interface DuplicateCheck {
  duplicate: boolean;
  conflicting: TreatmentRecord[];
  message: string;
}

/**
 * Whether this insertion collides with something already recorded.
 *
 * The likely mistake is entering a fraction that arrived late by machine after being typed
 * by hand: the course then counts it twice and the cumulative dose crosses the prescription
 * without anything looking wrong.
 */
export function findDuplicates(
  candidate: TreatmentRecord,
  existing: TreatmentRecord[],
  windowHours = 12
): DuplicateCheck {
  const window = Math.max(0, num(windowHours) || 0) * 3_600_000;
  const conflicting = (existing ?? []).filter(record => {
    if (!record || record.id === candidate?.id || record.courseId !== candidate?.courseId) {
      return false;
    }
    if (record.kind !== candidate.kind) {
      return false;
    }
    const sameIndex =
      record.kind === 'brachy' && candidate.kind === 'brachy'
        ? record.insertionNumber === candidate.insertionNumber
        : (record as ExternalBeamRecord).fractionNumber ===
          (candidate as ExternalBeamRecord).fractionNumber;
    const closeInTime = Math.abs(num(record.deliveredAt) - num(candidate.deliveredAt)) <= window;
    return sameIndex || closeInTime;
  });

  return {
    duplicate: conflicting.length > 0,
    conflicting,
    message: conflicting.length
      ? `${conflicting.length} registro(s) já cobrem esta entrega. Contar duas vezes faz a dose acumulada passar da prescrição sem nada parecer errado.`
      : '',
  };
}

/** One line per record for the treatment list. */
export function describeRecord(record: TreatmentRecord): string {
  const manual =
    record.provenance?.origin === 'manual'
      ? ` · manual (${MISSING_REASONS[record.provenance.reason as MissingReason] ?? 'motivo não informado'})`
      : '';
  if (record.kind === 'brachy') {
    return `Inserção ${record.insertionNumber} · ${record.doseGy} Gy · ${record.nuclide} · ${record.totalDwellSec}s${manual}`;
  }
  return `Fração ${record.fractionNumber} · ${record.doseGy} Gy · ${record.beams.length} feixe(s)${manual}`;
}
