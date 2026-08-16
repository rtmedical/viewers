/**
 * Merging a PACS worklist with a RIS worklist — pure core (RTV-183).
 *
 * QIDO-RS knows what images exist. The Connect RIS knows what was ordered, how urgent it is,
 * who it is assigned to and whether it has been reported. Neither is authoritative for the
 * other's half, and the worklist needs both.
 *
 * ## Ownership is per field, not per record
 *
 * The obvious merge — take whichever record arrived last — flips the assignee back and forth
 * every refresh, because the PACS row has no assignee and overwrites it with nothing. Or it
 * loses the series count, because the RIS row has none.
 *
 * So each field has an owner. {@link FIELD_OWNER} is the whole design: `numSeries` comes from
 * the PACS whatever the RIS says, `priority` comes from the RIS whatever the PACS says, and
 * a field only falls through to the other source when its owner has nothing.
 *
 * ## A source that is down is not a source that says "empty"
 *
 * If QIDO times out and the merge treats the empty result as truth, every study loses its
 * imaging and half of them vanish from the list. The radiologist sees a shorter worklist and
 * concludes the morning is quiet.
 *
 * This is the classic distributed-systems failure and it is worth spelling out here because
 * the symptom — a list with fewer rows — looks like normal operation. {@link mergeWorklists}
 * takes a *result* per source, not a list, and a failed source contributes nothing while
 * marking the rows it could not confirm.
 *
 * ## Matching across sources, and refusing to guess
 *
 * StudyInstanceUID is the join key when the RIS carries it. Often it does not — the RIS
 * knows the accession number — so the fallback is accession plus patient. When two candidates
 * match one row, neither is used: a merged pair of *different* studies produces a row with
 * one patient's images and another's report status, and nothing about it looks wrong.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type SourceKind = 'pacs' | 'ris';

export interface PacsStudy {
  studyInstanceUid: string;
  patientId?: string;
  patientName?: string;
  accessionNumber?: string;
  studyDate?: string;
  studyTime?: string;
  modalities?: string[];
  description?: string;
  numSeries?: number;
  numInstances?: number;
}

export interface RisStudy {
  /** Present when the RIS was told the UID. Often it was not. */
  studyInstanceUid?: string;
  accessionNumber?: string;
  patientId?: string;
  patientName?: string;
  priority?: string;
  assigneeId?: string;
  assigneeName?: string;
  referrerName?: string;
  reportStatus?: string;
  scheduledAt?: string;
  room?: string;
  orderId?: string;
}

export interface MergedStudy {
  studyInstanceUid?: string;
  accessionNumber?: string;
  patientId?: string;
  patientName?: string;
  studyDate?: string;
  studyTime?: string;
  modalities?: string[];
  description?: string;
  numSeries?: number;
  numInstances?: number;
  priority?: string;
  assigneeId?: string;
  assigneeName?: string;
  referrerName?: string;
  reportStatus?: string;
  scheduledAt?: string;
  room?: string;
  orderId?: string;
  /** Which sources contributed. */
  sources: SourceKind[];
  /** True when the imaging half could not be confirmed because the PACS did not answer. */
  imagingUnconfirmed?: boolean;
  /** True when the RIS half could not be confirmed. */
  orderUnconfirmed?: boolean;
}

/**
 * Which source owns each field.
 *
 * The whole design is here. A field only falls through to the other source when its owner
 * has nothing for it.
 */
export const FIELD_OWNER: Record<string, SourceKind> = {
  studyInstanceUid: 'pacs',
  studyDate: 'pacs',
  studyTime: 'pacs',
  modalities: 'pacs',
  description: 'pacs',
  numSeries: 'pacs',
  numInstances: 'pacs',
  accessionNumber: 'ris',
  patientId: 'ris',
  patientName: 'ris',
  priority: 'ris',
  assigneeId: 'ris',
  assigneeName: 'ris',
  referrerName: 'ris',
  reportStatus: 'ris',
  scheduledAt: 'ris',
  room: 'ris',
  orderId: 'ris',
};

const text = (v: unknown): string => String(v ?? '').trim();

const present = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
};

export interface SourceResult<T> {
  ok: boolean;
  rows: T[];
  /** Why it failed, when it did. */
  error?: string;
}

export interface MatchIssue {
  accessionNumber?: string;
  patientId?: string;
  candidates: string[];
  message: string;
}

export interface MergeResult {
  rows: MergedStudy[];
  /** Rows a source could not be matched to, kept rather than dropped. */
  unmatchedRis: number;
  unmatchedPacs: number;
  ambiguous: MatchIssue[];
  /** Sources that failed, so the UI can say the list is partial. */
  degraded: SourceKind[];
  message: string;
}

const joinKey = (patientId: unknown, accession: unknown): string =>
  `${text(patientId).toLowerCase()}|${text(accession).toLowerCase()}`;

/**
 * Merges the two worklists.
 *
 * Takes a *result* per source rather than a list, so a source that failed contributes
 * nothing and says so — instead of contributing an empty list that reads as "there is
 * nothing here".
 */
export function mergeWorklists(
  pacs: SourceResult<PacsStudy>,
  ris: SourceResult<RisStudy>
): MergeResult {
  const degraded: SourceKind[] = [];
  if (!pacs?.ok) {
    degraded.push('pacs');
  }
  if (!ris?.ok) {
    degraded.push('ris');
  }

  const pacsRows = pacs?.ok ? (pacs.rows ?? []) : [];
  const risRows = ris?.ok ? (ris.rows ?? []) : [];

  const byUid = new Map<string, PacsStudy>();
  const byAccession = new Map<string, PacsStudy[]>();
  for (const study of pacsRows) {
    const uid = text(study?.studyInstanceUid);
    if (uid) {
      byUid.set(uid, study);
    }
    const key = joinKey(study?.patientId, study?.accessionNumber);
    if (text(study?.accessionNumber)) {
      byAccession.set(key, [...(byAccession.get(key) ?? []), study]);
    }
  }

  const rows: MergedStudy[] = [];
  const ambiguous: MatchIssue[] = [];
  const usedPacs = new Set<PacsStudy>();
  let unmatchedRis = 0;

  for (const order of risRows) {
    let match: PacsStudy | undefined;

    const uid = text(order?.studyInstanceUid);
    if (uid) {
      match = byUid.get(uid);
    }
    if (!match && text(order?.accessionNumber)) {
      const candidates = (byAccession.get(joinKey(order?.patientId, order?.accessionNumber)) ?? [])
        .filter(c => !usedPacs.has(c));
      if (candidates.length > 1) {
        // A merged pair of DIFFERENT studies produces a row with one patient's images and
        // another's report status, and nothing about it looks wrong.
        ambiguous.push({
          accessionNumber: text(order.accessionNumber),
          patientId: text(order.patientId),
          candidates: candidates.map(c => text(c.studyInstanceUid)),
          message:
            `Accession ${text(order.accessionNumber)} casa com ${candidates.length} estudos no PACS — ` +
            'nenhum foi usado, porque juntar os errados produz uma linha com as imagens de um paciente e o status de laudo de outro.',
        });
      } else {
        match = candidates[0];
      }
    }

    if (match) {
      usedPacs.add(match);
      rows.push(mergeRow(match, order, degraded));
    } else {
      unmatchedRis += 1;
      rows.push(mergeRow(undefined, order, degraded));
    }
  }

  let unmatchedPacs = 0;
  for (const study of pacsRows) {
    if (!usedPacs.has(study)) {
      unmatchedPacs += 1;
      rows.push(mergeRow(study, undefined, degraded));
    }
  }

  return {
    rows,
    unmatchedRis,
    unmatchedPacs,
    ambiguous,
    degraded,
    message: buildMessage(rows.length, degraded, ambiguous.length),
  };
}

/**
 * Combines one pair of rows, field by field.
 *
 * The owner wins when it has a value; the other source fills in only where the owner is
 * silent. That is what stops a refresh from wiping the assignee with the PACS's absence of
 * one.
 */
export function mergeRow(
  pacsStudy: PacsStudy | undefined,
  risStudy: RisStudy | undefined,
  degraded: SourceKind[] = []
): MergedStudy {
  const sources: SourceKind[] = [];
  if (pacsStudy) {
    sources.push('pacs');
  }
  if (risStudy) {
    sources.push('ris');
  }

  const out: Record<string, unknown> = {};
  const source: Record<SourceKind, Record<string, unknown>> = {
    pacs: (pacsStudy ?? {}) as Record<string, unknown>,
    ris: (risStudy ?? {}) as Record<string, unknown>,
  };

  for (const [field, owner] of Object.entries(FIELD_OWNER)) {
    const other: SourceKind = owner === 'pacs' ? 'ris' : 'pacs';
    if (present(source[owner][field])) {
      out[field] = source[owner][field];
    } else if (present(source[other][field])) {
      out[field] = source[other][field];
    }
  }

  return {
    ...(out as Omit<MergedStudy, 'sources'>),
    sources,
    // A row with no PACS half while the PACS is down is not a row with no images.
    imagingUnconfirmed: !pacsStudy && degraded.includes('pacs') ? true : undefined,
    orderUnconfirmed: !risStudy && degraded.includes('ris') ? true : undefined,
  };
}

function buildMessage(rows: number, degraded: SourceKind[], ambiguous: number): string {
  const parts = [`${rows} estudo(s).`];
  if (degraded.includes('pacs')) {
    parts.push('PACS indisponível — a informação de imagem não pôde ser confirmada; a lista NÃO está menor porque há menos exames.');
  }
  if (degraded.includes('ris')) {
    parts.push('RIS indisponível — prioridade, responsável e status de laudo não puderam ser confirmados.');
  }
  if (ambiguous) {
    parts.push(`${ambiguous} accession(s) com casamento ambíguo, não unificado(s).`);
  }
  return parts.join(' ');
}

export interface FieldProvenance {
  field: string;
  owner: SourceKind;
  /** Which source actually supplied the value. */
  from: SourceKind | 'none';
  fellBack: boolean;
}

/**
 * Where each field of a merged row came from.
 *
 * Exists so a support conversation about "the priority is wrong" can be answered by
 * pointing at the source, rather than by guessing which system to blame.
 */
export function fieldProvenance(
  pacsStudy: PacsStudy | undefined,
  risStudy: RisStudy | undefined
): FieldProvenance[] {
  const source: Record<SourceKind, Record<string, unknown>> = {
    pacs: (pacsStudy ?? {}) as Record<string, unknown>,
    ris: (risStudy ?? {}) as Record<string, unknown>,
  };

  return Object.entries(FIELD_OWNER).map(([field, owner]) => {
    const other: SourceKind = owner === 'pacs' ? 'ris' : 'pacs';
    if (present(source[owner][field])) {
      return { field, owner, from: owner, fellBack: false };
    }
    if (present(source[other][field])) {
      return { field, owner, from: other, fellBack: true };
    }
    return { field, owner, from: 'none' as const, fellBack: false };
  });
}

/** Whether the merged list can be presented as complete. */
export function isComplete(result: MergeResult): boolean {
  return !!result && result.degraded.length === 0 && result.ambiguous.length === 0;
}
