/**
 * The embedded Orthanc as a third source — pure core (RTV-194).
 *
 * `multiDatasource.ts` (RTV-183) merges the PACS and the RIS field by field. The desktop
 * adds a source with a property neither of those has: **the study is only here**.
 *
 * ## A local study exists in one place
 *
 * It has not been sent to the PACS, so it is not backed up, no colleague can see it, and it
 * will not be in the patient's history tomorrow. A worklist that renders it identically to
 * a PACS study invites a report to be issued against images that vanish with the laptop.
 *
 * That is why origin is structural here rather than a badge: {@link mergeByOrigin} puts it
 * on the row, {@link localOnlyRisk} states the consequence, and a filter can hide the chip
 * but not the fact.
 *
 * ## A study received by C-STORE has no order
 *
 * Nobody requested it in the RIS. It cannot be assigned, prioritised or billed, and a
 * report written against it has no order to attach to. It is a legitimate state — that is
 * how a study arrives from a clinic with a CD — and it has to be visible as a state rather
 * than as an empty column. {@link reconcileWithOrder} matches it to an order when the
 * evidence is unambiguous and **refuses when it is not**, for the same reason RTV-183
 * refuses: joining the wrong pair produces one row with one patient's images and another
 * patient's order.
 *
 * ## The same study can be in two places
 *
 * After a send, the local copy and the remote copy share a StudyInstanceUID. Two rows is
 * two patients as far as a tired eye is concerned, so they merge into one row carrying both
 * origins — and only then is the local copy safe to delete, which is a decision someone
 * makes rather than a cleanup that happens.
 *
 * ## Credentials never reach the page
 *
 * The local Orthanc has a password. The descriptor here carries an opaque handle the host
 * resolves; there is no field for a credential, so there is nowhere for one to be put by
 * accident.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type Origin = 'local' | 'pacs' | 'ris';

export const ORIGIN_LABELS: Record<Origin, string> = {
  local: 'Local',
  pacs: 'Remoto',
  ris: 'RIS',
};

export interface SourceRow {
  studyInstanceUid: string;
  origin: Origin;
  patientName?: string;
  patientId?: string;
  accessionNumber?: string;
  studyDescription?: string;
  modality?: string;
  studyDate?: string;
  /** Local rows only: when C-STORE delivered it. */
  receivedAt?: number;
  /** Local rows only: how it got here. */
  arrival?: 'c-store' | 'import';
}

export interface WorklistRow {
  studyInstanceUid: string;
  origins: Origin[];
  patientName?: string;
  patientId?: string;
  accessionNumber?: string;
  studyDescription?: string;
  modality?: string;
  studyDate?: string;
  receivedAt?: number;
  arrival?: 'c-store' | 'import';
  /** True when the images exist only on this machine. */
  localOnly: boolean;
  /** True when no RIS order was matched. */
  unordered: boolean;
}

const text = (value: unknown): string => String(value ?? '').trim();

/**
 * One row per study, carrying every origin it was seen in.
 *
 * Two rows for one study is two patients as far as a tired eye at 3am is concerned, and the
 * duplicate appears exactly when a send succeeds — the moment things are going right.
 */
export function mergeByOrigin(rows: SourceRow[]): WorklistRow[] {
  const byUid = new Map<string, WorklistRow>();

  for (const row of rows ?? []) {
    const uid = text(row?.studyInstanceUid);
    if (!uid) {
      continue;
    }
    const existing = byUid.get(uid);
    if (!existing) {
      byUid.set(uid, {
        studyInstanceUid: uid,
        origins: [row.origin],
        patientName: row.patientName,
        patientId: row.patientId,
        accessionNumber: row.accessionNumber,
        studyDescription: row.studyDescription,
        modality: row.modality,
        studyDate: row.studyDate,
        receivedAt: row.receivedAt,
        arrival: row.arrival,
        localOnly: row.origin === 'local',
        unordered: row.origin !== 'ris',
      });
      continue;
    }
    if (!existing.origins.includes(row.origin)) {
      existing.origins.push(row.origin);
    }
    // A field only fills in where it was empty; the same rule as RTV-183, so a source
    // that knows nothing about a field cannot blank it.
    existing.patientName = existing.patientName || row.patientName;
    existing.patientId = existing.patientId || row.patientId;
    existing.accessionNumber = existing.accessionNumber || row.accessionNumber;
    existing.studyDescription = existing.studyDescription || row.studyDescription;
    existing.modality = existing.modality || row.modality;
    existing.studyDate = existing.studyDate || row.studyDate;
    existing.receivedAt = existing.receivedAt ?? row.receivedAt;
    existing.arrival = existing.arrival || row.arrival;
    existing.localOnly = existing.origins.length === 1 && existing.origins[0] === 'local';
    existing.unordered = !existing.origins.includes('ris');
  }

  for (const row of byUid.values()) {
    row.origins.sort();
  }
  return [...byUid.values()];
}

export interface LocalRisk {
  atRisk: boolean;
  reasons: string[];
  message: string;
}

/**
 * What being local-only costs.
 *
 * Stated rather than implied, because the study looks exactly like any other in the list
 * and the consequences only arrive later.
 */
export function localOnlyRisk(row: WorklistRow): LocalRisk {
  const reasons: string[] = [];
  if (row?.localOnly) {
    reasons.push(
      'Imagens só nesta máquina: não estão em backup, nenhum colega as enxerga, e amanhã não estarão no histórico do paciente.'
    );
  }
  if (row?.unordered) {
    reasons.push(
      'Sem pedido no RIS: não dá para atribuir, priorizar nem faturar, e um laudo escrito aqui não tem pedido a que se prender.'
    );
  }
  return {
    atRisk: reasons.length > 0,
    reasons,
    message: reasons.join(' '),
  };
}

export interface OrderCandidate {
  accessionNumber: string;
  patientId: string;
  patientName: string;
  studyDate?: string;
  modality?: string;
}

export interface Reconciliation {
  matched: OrderCandidate | null;
  ok: boolean;
  ambiguous: boolean;
  message: string;
}

/**
 * Matches a locally received study to a RIS order.
 *
 * Accession plus patient identifier is a match. Name alone is not: a study imported from a
 * CD may be anonymised, may spell the name differently, or may come from another
 * institution entirely, and two candidates for one study means **neither** is used —
 * joining the wrong pair produces a row with one patient's images and another patient's
 * order, and nothing about it looks wrong.
 */
export function reconcileWithOrder(row: WorklistRow, candidates: OrderCandidate[]): Reconciliation {
  const list = (candidates ?? []).filter(Boolean);
  const accession = text(row?.accessionNumber);
  const patientId = text(row?.patientId);

  if (accession && patientId) {
    const exact = list.filter(
      c => text(c.accessionNumber) === accession && text(c.patientId) === patientId
    );
    if (exact.length === 1) {
      return {
        matched: exact[0],
        ok: true,
        ambiguous: false,
        message: 'Casado por accession e identificador do paciente.',
      };
    }
    if (exact.length > 1) {
      return {
        matched: null,
        ok: false,
        ambiguous: true,
        message:
          `${exact.length} pedidos com o mesmo accession e paciente — nenhum foi usado. ` +
          'Juntar o par errado produz uma linha com as imagens de um paciente e o pedido de outro, e nada nela parece errado.',
      };
    }
  }

  const byName = list.filter(
    c => text(c.patientName).toLowerCase() === text(row?.patientName).toLowerCase() && text(row?.patientName)
  );
  if (byName.length === 1) {
    return {
      matched: null,
      ok: false,
      ambiguous: false,
      message:
        'Só o nome bate. Estudo importado de mídia pode estar anonimizado, grafado diferente ou vir de outra instituição — ' +
        'nome sozinho não identifica paciente. Confirme manualmente.',
    };
  }
  if (byName.length > 1) {
    return {
      matched: null,
      ok: false,
      ambiguous: true,
      message: `${byName.length} pedidos com o mesmo nome — nenhum foi usado.`,
    };
  }

  return { matched: null, ok: false, ambiguous: false, message: 'Nenhum pedido correspondente.' };
}

export type LocalAction = 'send-to-pacs' | 'delete-local' | 'reconcile' | 'open';

export interface ActionAvailability {
  available: LocalAction[];
  blocked: Array<{ action: LocalAction; reason: string }>;
}

/**
 * Which actions a row offers.
 *
 * `delete-local` only appears once the study is also in the PACS. Deleting the only copy is
 * not an action the list should make easy, and "I sent it" is not the same fact as "it is
 * there".
 */
export function availableActions(row: WorklistRow): ActionAvailability {
  const available: LocalAction[] = ['open'];
  const blocked: Array<{ action: LocalAction; reason: string }> = [];
  const isLocal = row?.origins?.includes('local');

  if (isLocal && !row.origins.includes('pacs')) {
    available.push('send-to-pacs');
    blocked.push({
      action: 'delete-local',
      reason:
        'Este estudo só existe aqui. Apagar a única cópia não é uma ação que a lista deva facilitar — envie ao PACS e confirme a chegada primeiro.',
    });
  } else if (isLocal) {
    available.push('delete-local');
  } else {
    blocked.push({ action: 'send-to-pacs', reason: 'Estudo não está na máquina local.' });
    blocked.push({ action: 'delete-local', reason: 'Estudo não está na máquina local.' });
  }

  if (row?.unordered) {
    available.push('reconcile');
  }

  return { available, blocked };
}

export interface DatasourceDescriptor {
  id: string;
  origin: Origin;
  /** DICOMweb root, e.g. http://localhost:8042/dicom-web. */
  baseUrl: string;
  /**
   * Opaque handle the host resolves into credentials.
   *
   * There is deliberately no field for a user or a password: a credential that has nowhere
   * to be put cannot be put in the page by accident, and the webview is the wrong side of
   * the boundary for the local Orthanc's password.
   */
  credentialHandle?: string;
}

export interface DescriptorCheck {
  ok: boolean;
  reason?: string;
}

/** Rejects a descriptor that carries a credential in the URL. */
export function checkDescriptor(descriptor: DatasourceDescriptor): DescriptorCheck {
  const url = text(descriptor?.baseUrl);
  if (!url) {
    return { ok: false, reason: 'Datasource sem URL.' };
  }
  if (/^[a-z]+:\/\/[^/@]*@/i.test(url)) {
    return {
      ok: false,
      reason:
        'Credencial embutida na URL. A senha do Orthanc local não pertence ao webview — passe um handle que o host resolve.',
    };
  }
  return { ok: true };
}

/** One line per row for the origin column. */
export function describeOrigin(row: WorklistRow): string {
  const origins = row.origins.map(o => ORIGIN_LABELS[o]).join(' + ');
  const received =
    row.arrival === 'c-store'
      ? ' · recebido por C-STORE local'
      : row.arrival === 'import'
        ? ' · importado de arquivo'
        : '';
  const risk = localOnlyRisk(row);
  return `${origins}${received}${risk.atRisk ? ` · ${risk.message}` : ''}`;
}
