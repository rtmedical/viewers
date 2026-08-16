/**
 * The modality worklist and the scheduled procedure step — pure core (RTV-99).
 *
 * The C-FIND against the MWL SCP is an adapter. What is here is the model the console picks
 * from, and the reason picking from it is the highest-consequence click in the department.
 *
 * ## Selecting the wrong worklist entry writes another patient's name into the study
 *
 * The images inherit their demographics from the entry the technologist selected. Pick the
 * line above the intended one and the study is created, stored, indexed and reported under
 * a different patient — and **nothing downstream can detect it**, because every field is
 * internally consistent. The name matches the ID, the ID matches the accession, the
 * accession matches the order. There is no contradiction anywhere for a validator to find.
 *
 * The only defences are before the click: a list narrow enough that the intended entry is
 * obvious, and a confirmation that shows what is about to be inherited.
 * {@link selectionGuard} produces that, and {@link ambiguousEntries} finds the pairs a
 * tired eye conflates.
 *
 * ## Querying without the station filter puts the whole department on one console
 *
 * MWL is queried by modality, scheduled station AE title and date. Drop the AE title and
 * the CT console lists the MR room's work as well. The exam then gets performed on the
 * wrong machine, and the only trace is a station name in the images that nobody reads
 * until the physicist asks why a protocol ran somewhere it does not exist.
 *
 * ## An unscheduled examination is a real thing, not a missing row
 *
 * Trauma and walk-ins arrive without an order. Forcing a fake worklist entry to make the
 * software happy produces an order that billing and the RIS will both treat as real.
 * {@link unscheduledStep} marks it instead.
 *
 * ## One requested procedure is not one step
 *
 * A CT of chest and abdomen is commonly two scheduled steps under one requested procedure,
 * and one step can produce several series. Collapsing steps into procedures mis-bills;
 * collapsing series into steps loses which protocol actually ran.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export interface PatientIdentity {
  patientId: string;
  patientName: string;
  /** YYYYMMDD. */
  birthDate?: string;
  sex?: 'M' | 'F' | 'O';
}

export interface ScheduledProcedureStep {
  /** Scheduled Procedure Step ID (0040,0009). */
  spsId: string;
  /** Accession Number (0008,0050) of the requested procedure this step belongs to. */
  accessionNumber: string;
  /** Requested Procedure ID (0040,1001). One procedure may have several steps. */
  requestedProcedureId: string;
  /** Study Instance UID (0020,000D) allocated by the RIS. */
  studyInstanceUid: string;
  modality: string;
  /** Scheduled Station AE Title (0040,0001). */
  stationAeTitle: string;
  /** Epoch ms of the scheduled start. */
  scheduledAt: number;
  description: string;
  patient: PatientIdentity;
  /** True for a step created at the console because no order existed. */
  unscheduled?: boolean;
  unscheduledReason?: string;
}

export interface WorklistQuery {
  modality?: string;
  stationAeTitle?: string;
  /** Epoch ms bounds. */
  fromAt?: number;
  toAt?: number;
  patientId?: string;
  accessionNumber?: string;
}

const text = (value: unknown): string => String(value ?? '').trim();
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

export interface QueryCheck {
  ok: boolean;
  warnings: string[];
  /** Estimated breadth: how many of the narrowing keys were supplied. */
  narrowingKeys: number;
}

/** A query returning more than this is too broad to pick from safely. */
export const SAFE_LIST_LENGTH = 40;

/**
 * Whether a worklist query is narrow enough to pick from.
 *
 * The station filter is the one that matters. Without it the CT console lists the MR room's
 * work, the exam gets performed on the wrong machine, and the only trace is a station name
 * in the images that nobody reads until the physicist asks why a protocol ran somewhere it
 * does not exist.
 */
export function checkQuery(query: WorklistQuery): QueryCheck {
  const warnings: string[] = [];
  const keys = [
    text(query?.modality),
    text(query?.stationAeTitle),
    text(query?.patientId),
    text(query?.accessionNumber),
  ].filter(Boolean).length;

  const bounded = Number.isFinite(num(query?.fromAt)) && Number.isFinite(num(query?.toAt));

  if (!text(query?.stationAeTitle) && !text(query?.patientId) && !text(query?.accessionNumber)) {
    warnings.push(
      'Consulta sem AE da estação. O console de uma sala passa a listar o trabalho das outras, e o exame acaba feito na ' +
        'máquina errada — o único rastro é o nome da estação nas imagens, que ninguém lê até a física perguntar por que um protocolo rodou onde ele não existe.'
    );
  }
  if (!text(query?.modality) && !text(query?.patientId) && !text(query?.accessionNumber)) {
    warnings.push('Consulta sem modalidade.');
  }
  if (!bounded && !text(query?.patientId) && !text(query?.accessionNumber)) {
    warnings.push('Consulta sem janela de data — a lista cresce com o histórico inteiro.');
  }

  return { ok: warnings.length === 0, warnings, narrowingKeys: keys + (bounded ? 1 : 0) };
}

export interface AmbiguousPair {
  a: ScheduledProcedureStep;
  b: ScheduledProcedureStep;
  reason: string;
}

/**
 * Splits a patient name into family and given parts.
 *
 * DICOM PN is `family^given^middle^prefix^suffix`, but names typed at a console arrive as
 * plain text, where the family name is the last token by local convention.
 */
export function splitPatientName(name: string): { family: string; given: string } {
  const clean = String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  if (clean.includes('^')) {
    const [family, given = ''] = clean.split('^');
    return { family: family.replace(/[^A-Z]/g, ''), given: given.replace(/[^A-Z]/g, '') };
  }
  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return { family: (tokens[0] ?? '').replace(/[^A-Z]/g, ''), given: '' };
  }
  return {
    family: tokens[tokens.length - 1].replace(/[^A-Z]/g, ''),
    given: tokens.slice(0, -1).join('').replace(/[^A-Z]/g, ''),
  };
}

/**
 * Names this close are conflated at a glance.
 *
 * Compares the family name as a TOKEN rather than the last few characters of the whole
 * string. "Maria Souza" and "Mario Souza" share a surname and a first initial and are the
 * canonical dangerous pair -- and a trailing-character comparison misses them, because the
 * last letter of the given name sits inside the window.
 */
function similarName(a: string, b: string): boolean {
  const x = splitPatientName(a);
  const y = splitPatientName(b);
  if (!x.family || !y.family) {
    return false;
  }
  if (x.family !== y.family) {
    return false;
  }
  // Same surname: dangerous when the given names also start alike.
  return x.given.slice(0, 1) === y.given.slice(0, 1) || x.given === y.given;
}

/**
 * Pairs of entries a tired eye conflates.
 *
 * The defence has to be before the click, because after it there is no contradiction for
 * anything downstream to notice.
 */
export function ambiguousEntries(steps: ScheduledProcedureStep[]): AmbiguousPair[] {
  const list = (steps ?? []).filter(Boolean);
  const pairs: AmbiguousPair[] = [];

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.patient.patientId === b.patient.patientId) {
        if (a.description === b.description && a.modality === b.modality) {
          pairs.push({
            a,
            b,
            reason: 'Mesmo paciente com dois passos idênticos — só o horário distingue.',
          });
        }
        continue;
      }
      if (similarName(a.patient.patientName, b.patient.patientName)) {
        pairs.push({
          a,
          b,
          reason: `Nomes parecidos de pacientes diferentes: "${a.patient.patientName}" e "${b.patient.patientName}".`,
        });
      }
    }
  }
  return pairs;
}

export interface SelectionGuard {
  step: ScheduledProcedureStep;
  /** Exactly what the study will inherit. */
  inherits: { patientId: string; patientName: string; accessionNumber: string; studyInstanceUid: string };
  /** Entries that look like this one in the same list. */
  lookalikes: ScheduledProcedureStep[];
  requiresConfirmation: boolean;
  message: string;
}

/**
 * What the technologist is about to commit to.
 *
 * States the inherited identity explicitly rather than assuming the highlighted row was
 * read. A mis-click produces a study that is internally consistent in every field, so this
 * confirmation is the last point at which the error is detectable at all.
 */
export function selectionGuard(
  step: ScheduledProcedureStep,
  list: ScheduledProcedureStep[]
): SelectionGuard {
  const lookalikes = ambiguousEntries(list)
    .filter(p => p.a.spsId === step.spsId || p.b.spsId === step.spsId)
    .map(p => (p.a.spsId === step.spsId ? p.b : p.a));

  return {
    step,
    inherits: {
      patientId: step.patient.patientId,
      patientName: step.patient.patientName,
      accessionNumber: step.accessionNumber,
      studyInstanceUid: step.studyInstanceUid,
    },
    lookalikes,
    requiresConfirmation: lookalikes.length > 0,
    message:
      `As imagens vão herdar: ${step.patient.patientName} (${step.patient.patientId}), accession ${step.accessionNumber}.` +
      (lookalikes.length
        ? ` ATENÇÃO: ${lookalikes.length} entrada(s) parecida(s) nesta lista. Selecionar a linha errada cria o estudo sob outro paciente, ` +
          'e nada depois consegue detectar — todos os campos ficam internamente consistentes entre si.'
        : ''),
  };
}

export interface UnscheduledResult {
  step: ScheduledProcedureStep | null;
  ok: boolean;
  reason?: string;
}

/**
 * A step for an examination that had no order.
 *
 * Marked as unscheduled rather than dressed as a real worklist entry: a fabricated order is
 * one that billing and the RIS will both treat as genuine, and the reconciliation that
 * should have happened never does.
 */
export function unscheduledStep(input: {
  spsId: string;
  studyInstanceUid: string;
  modality: string;
  stationAeTitle: string;
  startedAt: number;
  patient: PatientIdentity;
  reason: string;
  description?: string;
}): UnscheduledResult {
  if (!text(input?.patient?.patientId) || !text(input?.patient?.patientName)) {
    return {
      step: null,
      ok: false,
      reason: 'Exame não agendado ainda exige identificação do paciente — o que falta é o pedido, não o paciente.',
    };
  }
  if (!text(input?.reason)) {
    return {
      step: null,
      ok: false,
      reason:
        'Exame não agendado exige motivo. Sem ele ninguém depois distingue um trauma de um erro de fluxo, e a reconciliação com o RIS não acontece.',
    };
  }
  if (!text(input?.studyInstanceUid)) {
    return { step: null, ok: false, reason: 'Exame não agendado sem Study Instance UID.' };
  }

  return {
    ok: true,
    step: {
      spsId: text(input.spsId),
      // No accession: inventing one produces an order the RIS never issued.
      accessionNumber: '',
      requestedProcedureId: '',
      studyInstanceUid: text(input.studyInstanceUid),
      modality: text(input.modality),
      stationAeTitle: text(input.stationAeTitle),
      scheduledAt: num(input.startedAt),
      description: text(input.description) || 'Exame não agendado',
      patient: input.patient,
      unscheduled: true,
      unscheduledReason: text(input.reason),
    },
  };
}

export interface ProcedureGrouping {
  requestedProcedureId: string;
  accessionNumber: string;
  steps: ScheduledProcedureStep[];
}

/**
 * Steps grouped by the procedure that requested them.
 *
 * A CT of chest and abdomen is commonly two steps under one procedure. Collapsing them into
 * one bills for one; treating the procedure as the step loses which protocol actually ran.
 */
export function groupByProcedure(steps: ScheduledProcedureStep[]): ProcedureGrouping[] {
  const byProcedure = new Map<string, ProcedureGrouping>();
  for (const step of steps ?? []) {
    if (!step || step.unscheduled) {
      continue;
    }
    const key = `${text(step.accessionNumber)}|${text(step.requestedProcedureId)}`;
    const existing = byProcedure.get(key);
    if (existing) {
      existing.steps.push(step);
    } else {
      byProcedure.set(key, {
        requestedProcedureId: text(step.requestedProcedureId),
        accessionNumber: text(step.accessionNumber),
        steps: [step],
      });
    }
  }
  return [...byProcedure.values()];
}

export interface StudyMatch {
  step: ScheduledProcedureStep | null;
  ok: boolean;
  ambiguous: boolean;
  message: string;
}

/**
 * Matches an arriving study back to the step it was performed under.
 *
 * Study Instance UID first, because the RIS allocated it and it is unambiguous. Accession
 * plus patient second. Never on demographics alone: two entries for the same patient on the
 * same day are the normal case, not the exception.
 */
export function matchStudyToStep(
  study: { studyInstanceUid?: string; accessionNumber?: string; patientId?: string },
  steps: ScheduledProcedureStep[]
): StudyMatch {
  const list = (steps ?? []).filter(Boolean);
  const uid = text(study?.studyInstanceUid);

  if (uid) {
    const byUid = list.filter(s => s.studyInstanceUid === uid);
    if (byUid.length === 1) {
      return { step: byUid[0], ok: true, ambiguous: false, message: 'Casado pelo Study Instance UID.' };
    }
    if (byUid.length > 1) {
      return {
        step: null,
        ok: false,
        ambiguous: true,
        message: 'Mais de um passo com o mesmo Study Instance UID — a lista de trabalho está inconsistente.',
      };
    }
  }

  const accession = text(study?.accessionNumber);
  const patientId = text(study?.patientId);
  if (accession && patientId) {
    const byAccession = list.filter(
      s => s.accessionNumber === accession && s.patient.patientId === patientId
    );
    if (byAccession.length === 1) {
      return { step: byAccession[0], ok: true, ambiguous: false, message: 'Casado por accession e paciente.' };
    }
    if (byAccession.length > 1) {
      return {
        step: null,
        ok: false,
        ambiguous: true,
        message:
          `${byAccession.length} passos sob o mesmo accession para este paciente — é o caso normal de um procedimento com vários passos, ` +
          'e escolher um por conta própria atribui as imagens ao passo errado.',
      };
    }
  }

  return {
    step: null,
    ok: false,
    ambiguous: false,
    message:
      'Nenhum passo corresponde. Estudo sem pedido é estado legítimo (trauma, exame de fora) e precisa aparecer como tal, não como linha vazia.',
  };
}

/** One line per worklist row. */
export function describeStep(step: ScheduledProcedureStep): string {
  const when = new Date(step.scheduledAt).toISOString().slice(11, 16);
  const unscheduled = step.unscheduled ? ` · NÃO AGENDADO (${step.unscheduledReason})` : '';
  return `${when} · ${step.patient.patientName} (${step.patient.patientId}) · ${step.modality} ${step.description} · ${step.stationAeTitle}${unscheduled}`;
}
