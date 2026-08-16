import {
  availableActions,
  checkDescriptor,
  describeOrigin,
  localOnlyRisk,
  mergeByOrigin,
  OrderCandidate,
  ORIGIN_LABELS,
  reconcileWithOrder,
  SourceRow,
  WorklistRow,
} from './localDatasource';

const T0 = 1_700_000_000_000;

const row = (over: Partial<SourceRow> = {}): SourceRow => ({
  studyInstanceUid: '1.2.3',
  origin: 'local',
  patientName: 'Maria Souza',
  patientId: 'P-1',
  accessionNumber: 'A-1',
  modality: 'CT',
  receivedAt: T0,
  arrival: 'c-store',
  ...over,
});

const merged = (rows: SourceRow[]): WorklistRow => mergeByOrigin(rows)[0];

describe('localDatasource — the same study can be in two places', () => {
  // Two rows is two patients as far as a tired eye at 3am is concerned.
  it('merges a local and a remote copy into one row with both origins', () => {
    const rows = mergeByOrigin([row(), row({ origin: 'pacs', arrival: undefined, receivedAt: undefined })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].origins).toEqual(['local', 'pacs']);
  });

  // The duplicate appears exactly when a send succeeds.
  it('stops calling it local-only once the PACS has it', () => {
    expect(merged([row()]).localOnly).toBe(true);
    expect(merged([row(), row({ origin: 'pacs' })]).localOnly).toBe(false);
  });

  it('fills a field only where it was empty, never blanking it', () => {
    const result = merged([
      row({ patientName: 'Maria Souza', accessionNumber: '' }),
      row({ origin: 'pacs', patientName: '', accessionNumber: 'A-9' }),
    ]);
    expect(result.patientName).toBe('Maria Souza');
    expect(result.accessionNumber).toBe('A-9');
  });

  it('keeps how it arrived', () => {
    expect(merged([row({ arrival: 'import' })]).arrival).toBe('import');
  });

  it('skips rows with no study UID', () => {
    expect(mergeByOrigin([row({ studyInstanceUid: '' })])).toEqual([]);
  });
});

describe('localDatasource — a local study exists in one place', () => {
  // The study looks exactly like any other, and the consequences arrive later.
  it('states what being local-only costs', () => {
    const risk = localOnlyRisk(merged([row()]));
    expect(risk.atRisk).toBe(true);
    expect(risk.message).toMatch(/não estão em backup, nenhum colega as enxerga/);
    expect(risk.message).toMatch(/amanhã não estarão no histórico do paciente/);
  });

  it('states what having no order costs', () => {
    expect(localOnlyRisk(merged([row()])).message).toMatch(
      /um laudo escrito aqui não tem pedido a que se prender/
    );
  });

  it('is quiet for a study that is in the PACS and has an order', () => {
    const result = merged([row(), row({ origin: 'pacs' }), row({ origin: 'ris' })]);
    expect(localOnlyRisk(result).atRisk).toBe(false);
  });
});

describe('localDatasource — reconciling with an order', () => {
  const candidates: OrderCandidate[] = [
    { accessionNumber: 'A-1', patientId: 'P-1', patientName: 'Maria Souza' },
    { accessionNumber: 'A-2', patientId: 'P-2', patientName: 'Maria Souza' },
  ];

  it('matches on accession plus patient identifier', () => {
    const result = reconcileWithOrder(merged([row()]), candidates);
    expect(result.ok).toBe(true);
    expect(result.matched!.accessionNumber).toBe('A-1');
  });

  // A study from a CD may be anonymised, spelled differently, or from another institution.
  it('refuses a name-only match', () => {
    const result = reconcileWithOrder(
      merged([row({ accessionNumber: '', patientId: '' })]),
      [candidates[0]]
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/nome sozinho não identifica paciente/);
  });

  // One row with one patient's images and another patient's order.
  it('refuses when two orders match the same name', () => {
    const result = reconcileWithOrder(merged([row({ accessionNumber: '', patientId: '' })]), candidates);
    expect(result.ambiguous).toBe(true);
    expect(result.matched).toBeNull();
  });

  it('refuses when two orders share the accession and the patient', () => {
    const duplicated = [candidates[0], { ...candidates[0] }];
    const result = reconcileWithOrder(merged([row()]), duplicated);
    expect(result.ambiguous).toBe(true);
    expect(result.message).toMatch(/nada nela parece errado/);
  });

  it('says so when nothing matched', () => {
    expect(reconcileWithOrder(merged([row({ accessionNumber: 'Z', patientId: 'Z', patientName: 'X' })]), candidates).message).toMatch(
      /Nenhum pedido correspondente/
    );
  });
});

describe('localDatasource — which actions a row offers', () => {
  // "I sent it" is not the same fact as "it is there".
  it('does not offer to delete the only copy', () => {
    const actions = availableActions(merged([row()]));
    expect(actions.available).toContain('send-to-pacs');
    expect(actions.available).not.toContain('delete-local');
    expect(actions.blocked.find(b => b.action === 'delete-local')!.reason).toMatch(
      /Apagar a única cópia não é uma ação que a lista deva facilitar/
    );
  });

  it('offers the delete once the PACS also has it', () => {
    const actions = availableActions(merged([row(), row({ origin: 'pacs' })]));
    expect(actions.available).toContain('delete-local');
    expect(actions.available).not.toContain('send-to-pacs');
  });

  it('offers neither for a study that is not local', () => {
    const actions = availableActions(merged([row({ origin: 'pacs' })]));
    expect(actions.available).toEqual(expect.arrayContaining(['open']));
    expect(actions.blocked.map(b => b.action)).toEqual(['send-to-pacs', 'delete-local']);
  });

  it('offers reconciliation while there is no order', () => {
    expect(availableActions(merged([row()])).available).toContain('reconcile');
    expect(availableActions(merged([row(), row({ origin: 'ris' })])).available).not.toContain('reconcile');
  });
});

describe('localDatasource — credentials never reach the page', () => {
  it('accepts a plain local URL', () => {
    expect(checkDescriptor({ id: 'local', origin: 'local', baseUrl: 'http://localhost:8042/dicom-web' }).ok).toBe(
      true
    );
  });

  // A credential that has nowhere to be put cannot be put in the page by accident.
  it('rejects a credential embedded in the URL', () => {
    const result = checkDescriptor({
      id: 'local',
      origin: 'local',
      baseUrl: 'http://orthanc:orthanc@localhost:8042/dicom-web',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/não pertence ao webview — passe um handle que o host resolve/);
  });

  it('rejects a descriptor with no URL', () => {
    expect(checkDescriptor({ id: 'x', origin: 'local', baseUrl: '' }).ok).toBe(false);
  });
});

describe('localDatasource — the origin column', () => {
  it('names the origins, how it arrived and the risk', () => {
    const line = describeOrigin(merged([row()]));
    expect(line).toMatch(new RegExp(`^${ORIGIN_LABELS.local} · recebido por C-STORE local · `));
    expect(line).toMatch(/não estão em backup/);
  });

  it('is short for a study that is everywhere', () => {
    expect(describeOrigin(merged([row(), row({ origin: 'pacs' }), row({ origin: 'ris' })]))).toBe(
      'Local + Remoto + RIS · recebido por C-STORE local'
    );
  });
});
