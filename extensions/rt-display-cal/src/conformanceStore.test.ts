/**
 * Unit tests for the conformance audit-trail store (RTV-211) — fake storage,
 * injected timestamps, no DOM.
 */
import {
  ConformanceStore,
  MemoryStorage,
  CONFORMANCE_STORE_KEY,
  exportCsv,
  ConformanceRecord,
} from './conformanceStore';

const baseInput = {
  station: 'ws-01 (2560x1440)',
  user: 'dr.silva',
  answers: { corner5: true, corner95: true, patches18: true, rampSmooth: true },
  passed: true,
  notes: '',
  now: '2026-07-20T10:00:00.000Z',
};

describe('ConformanceStore', () => {
  it('starts empty and appends records in order with sequential ids', () => {
    const store = new ConformanceStore({ storage: new MemoryStorage() });
    expect(store.listRecords()).toEqual([]);

    const first = store.recordConformanceCheck(baseInput);
    const second = store.recordConformanceCheck({
      ...baseInput,
      user: 'fisica.medica',
      answers: { ...baseInput.answers, rampSmooth: false },
      passed: false,
      notes: 'banding on the lower ramp',
      now: '2026-07-21T08:30:00.000Z',
    });

    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
    const records = store.listRecords();
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(first);
    expect(records[1]).toEqual(second);
  });

  it('uses the injected timestamp verbatim (pure, no Date.now)', () => {
    const store = new ConformanceStore({ storage: new MemoryStorage() });
    const record = store.recordConformanceCheck({ ...baseInput, now: '1999-12-31T23:59:59Z' });
    expect(record.recordedAt).toBe('1999-12-31T23:59:59Z');
  });

  it('persists under the shared key so a new instance sees prior records', () => {
    const storage = new MemoryStorage();
    new ConformanceStore({ storage }).recordConformanceCheck(baseInput);
    expect(storage.getItem(CONFORMANCE_STORE_KEY)).toBeTruthy();
    expect(new ConformanceStore({ storage }).listRecords()).toHaveLength(1);
  });

  it('degrades corrupted storage to an empty list instead of throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem(CONFORMANCE_STORE_KEY, '{not json');
    const store = new ConformanceStore({ storage });
    expect(store.listRecords()).toEqual([]);
    storage.setItem(CONFORMANCE_STORE_KEY, '{"an":"object"}');
    expect(store.listRecords()).toEqual([]);
    // and it can still record on top of the corrupted value
    expect(store.recordConformanceCheck(baseInput).id).toBe(1);
  });

  it('copies answers so later caller mutation cannot rewrite the audit trail', () => {
    const store = new ConformanceStore({ storage: new MemoryStorage() });
    const answers = { corner5: true };
    store.recordConformanceCheck({ ...baseInput, answers });
    answers.corner5 = false;
    expect(store.listRecords()[0].answers.corner5).toBe(true);
  });
});

describe('exportCsv', () => {
  const records: ConformanceRecord[] = [
    {
      id: 1,
      station: 'ws-01',
      user: 'dr.silva',
      answers: { corner5: true, rampSmooth: true },
      passed: true,
      notes: '',
      recordedAt: '2026-07-20T10:00:00.000Z',
    },
    {
      id: 2,
      station: 'ws-02',
      user: 'fisica, medica',
      answers: { corner5: false, patches18: true },
      passed: false,
      notes: 'said "banding", lower ramp',
      recordedAt: '2026-07-21T08:30:00.000Z',
    },
  ];

  it('emits a header with the sorted union of answer ids plus one row per record', () => {
    const lines = exportCsv(records).split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('recordedAt,station,user,passed,corner5,patches18,rampSmooth,notes');
    expect(lines[1]).toBe('2026-07-20T10:00:00.000Z,ws-01,dr.silva,PASS,yes,,yes,');
  });

  it('escapes commas and quotes RFC-4180 style', () => {
    const lines = exportCsv(records).split('\r\n');
    expect(lines[2]).toContain('"fisica, medica"');
    expect(lines[2]).toContain('"said ""banding"", lower ramp"');
    expect(lines[2]).toContain('FAIL,no,yes,');
  });

  it('handles an empty record list', () => {
    expect(exportCsv([])).toBe('recordedAt,station,user,passed,notes');
  });
});
