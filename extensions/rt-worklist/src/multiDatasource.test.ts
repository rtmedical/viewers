import {
  FIELD_OWNER,
  fieldProvenance,
  isComplete,
  mergeRow,
  mergeWorklists,
  PacsStudy,
  RisStudy,
} from './multiDatasource';

const pacsStudy = (over: Partial<PacsStudy> = {}): PacsStudy => ({
  studyInstanceUid: '1.2.3',
  patientId: 'MRN-1',
  patientName: 'SILVA^JOAO',
  accessionNumber: 'ACC-1',
  studyDate: '20260815',
  modalities: ['CT'],
  numSeries: 4,
  numInstances: 320,
  ...over,
});

const risStudy = (over: Partial<RisStudy> = {}): RisStudy => ({
  accessionNumber: 'ACC-1',
  patientId: 'MRN-1',
  patientName: 'SILVA, JOAO',
  priority: 'urgent',
  assigneeId: 'ana',
  assigneeName: 'Dra. Ana Lima',
  reportStatus: 'draft',
  ...over,
});

const ok = <T>(rows: T[]) => ({ ok: true, rows });
const down = <T>(error = 'timeout') => ({ ok: false, rows: [] as T[], error });

describe('multiDatasource — ownership is per field', () => {
  it('takes the imaging fields from the PACS and the order fields from the RIS', () => {
    const row = mergeRow(pacsStudy(), risStudy());
    expect(row.numSeries).toBe(4);
    expect(row.modalities).toEqual(['CT']);
    expect(row.priority).toBe('urgent');
    expect(row.assigneeName).toBe('Dra. Ana Lima');
    expect(row.sources).toEqual(['pacs', 'ris']);
  });

  // The PACS row has no assignee and would overwrite it with nothing.
  it('the PACS absence of an assignee does NOT wipe the RIS one', () => {
    const row = mergeRow(pacsStudy(), risStudy());
    expect(row.assigneeId).toBe('ana');
    // And re-merging is stable, which is what stops the flip-flop on refresh.
    expect(mergeRow(pacsStudy(), risStudy()).assigneeId).toBe('ana');
  });

  it('the RIS absence of a series count does not wipe the PACS one', () => {
    expect(mergeRow(pacsStudy(), risStudy()).numInstances).toBe(320);
  });

  it('the owner wins when both have a value', () => {
    const row = mergeRow(pacsStudy({ patientName: 'DO PACS' }), risStudy({ patientName: 'DO RIS' }));
    expect(FIELD_OWNER.patientName).toBe('ris');
    expect(row.patientName).toBe('DO RIS');
  });

  it('falls back to the other source when the owner is silent', () => {
    const row = mergeRow(pacsStudy(), risStudy({ patientName: '' }));
    expect(row.patientName).toBe('SILVA^JOAO');
  });

  it('treats an empty array as absent', () => {
    expect(mergeRow(pacsStudy({ modalities: [] }), risStudy()).modalities).toBeUndefined();
  });

  it('reports where every field came from', () => {
    const provenance = fieldProvenance(pacsStudy(), risStudy({ patientName: '' }));
    const patientName = provenance.find(p => p.field === 'patientName')!;
    expect(patientName.owner).toBe('ris');
    expect(patientName.from).toBe('pacs');
    expect(patientName.fellBack).toBe(true);
    expect(provenance.find(p => p.field === 'room')!.from).toBe('none');
  });
});

describe('multiDatasource — a source that is down is not a source saying empty', () => {
  // The symptom — a list with fewer rows — looks like normal operation.
  it('keeps the RIS rows and marks the imaging unconfirmed when the PACS is down', () => {
    const result = mergeWorklists(down<PacsStudy>(), ok([risStudy()]));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].imagingUnconfirmed).toBe(true);
    expect(result.rows[0].priority).toBe('urgent');
    expect(result.degraded).toEqual(['pacs']);
  });

  it('says so in words a UI can show', () => {
    const result = mergeWorklists(down<PacsStudy>(), ok([risStudy()]));
    expect(result.message).toMatch(/a lista NÃO está menor porque há menos exames/);
  });

  it('keeps the PACS rows and marks the order unconfirmed when the RIS is down', () => {
    const result = mergeWorklists(ok([pacsStudy()]), down<RisStudy>());
    expect(result.rows[0].orderUnconfirmed).toBe(true);
    expect(result.rows[0].numSeries).toBe(4);
    expect(result.message).toMatch(/prioridade, responsável e status de laudo/);
  });

  it('does not mark anything unconfirmed when both answered', () => {
    const result = mergeWorklists(ok([pacsStudy()]), ok([risStudy()]));
    expect(result.rows[0].imagingUnconfirmed).toBeUndefined();
    expect(result.rows[0].orderUnconfirmed).toBeUndefined();
    expect(result.degraded).toEqual([]);
  });

  it('a genuinely empty source is not degraded', () => {
    const result = mergeWorklists(ok<PacsStudy>([]), ok([risStudy()]));
    expect(result.degraded).toEqual([]);
    expect(result.rows[0].imagingUnconfirmed).toBeUndefined();
  });

  it('isComplete is false while anything is degraded', () => {
    expect(isComplete(mergeWorklists(ok([pacsStudy()]), ok([risStudy()])))).toBe(true);
    expect(isComplete(mergeWorklists(down<PacsStudy>(), ok([risStudy()])))).toBe(false);
  });
});

describe('multiDatasource — matching', () => {
  it('joins on StudyInstanceUID when the RIS has it', () => {
    const result = mergeWorklists(
      ok([pacsStudy()]),
      ok([risStudy({ studyInstanceUid: '1.2.3', accessionNumber: 'DIFFERENT' })])
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sources).toEqual(['pacs', 'ris']);
  });

  it('falls back to accession plus patient when it does not', () => {
    const result = mergeWorklists(ok([pacsStudy()]), ok([risStudy()]));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].numSeries).toBe(4);
  });

  it('does not join on accession alone across patients', () => {
    const result = mergeWorklists(ok([pacsStudy()]), ok([risStudy({ patientId: 'MRN-9' })]));
    expect(result.rows).toHaveLength(2);
    expect(result.unmatchedRis).toBe(1);
    expect(result.unmatchedPacs).toBe(1);
  });

  // A merged pair of different studies produces a row with one patient's images and
  // another's report status, and nothing about it looks wrong.
  it('REFUSES an ambiguous match and keeps the rows apart', () => {
    const result = mergeWorklists(
      ok([pacsStudy({ studyInstanceUid: 'A' }), pacsStudy({ studyInstanceUid: 'B' })]),
      ok([risStudy()])
    );
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].candidates).toEqual(['A', 'B']);
    expect(result.ambiguous[0].message).toMatch(/status de laudo de outro/);
    expect(result.rows.find(r => r.sources.length === 2)).toBeUndefined();
  });

  it('keeps an unmatched RIS order in the list rather than dropping it', () => {
    const result = mergeWorklists(ok<PacsStudy>([]), ok([risStudy()]));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sources).toEqual(['ris']);
    expect(result.unmatchedRis).toBe(1);
  });

  it('keeps an unmatched PACS study too — imaging with no order is still imaging', () => {
    const result = mergeWorklists(ok([pacsStudy()]), ok<RisStudy>([]));
    expect(result.rows[0].sources).toEqual(['pacs']);
    expect(result.unmatchedPacs).toBe(1);
  });

  it('never uses one PACS study for two RIS orders', () => {
    const result = mergeWorklists(
      ok([pacsStudy()]),
      ok([risStudy({ orderId: 'o1' }), risStudy({ orderId: 'o2' })])
    );
    const merged = result.rows.filter(r => r.sources.length === 2);
    expect(merged).toHaveLength(1);
    expect(result.unmatchedRis).toBe(1);
  });
});

describe('multiDatasource — the summary', () => {
  it('counts the rows', () => {
    expect(mergeWorklists(ok([pacsStudy()]), ok([risStudy()])).message).toMatch(/^1 estudo\(s\)\./);
  });

  it('mentions the ambiguity', () => {
    const result = mergeWorklists(
      ok([pacsStudy({ studyInstanceUid: 'A' }), pacsStudy({ studyInstanceUid: 'B' })]),
      ok([risStudy()])
    );
    expect(result.message).toMatch(/casamento ambíguo/);
  });

  it('survives both sources being down', () => {
    const result = mergeWorklists(down<PacsStudy>(), down<RisStudy>());
    expect(result.rows).toEqual([]);
    expect(result.degraded).toEqual(['pacs', 'ris']);
  });
});
