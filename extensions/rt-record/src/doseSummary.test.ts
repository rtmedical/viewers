import {
  buildSessionDoseRows,
  buildDoseCounters,
  MU_ROUNDING_TOLERANCE,
} from './doseSummary';
import type { RtRecord } from './rtRecordParser';

const rec = (date: string, sessions: RtRecord['sessions']): RtRecord => ({
  recordType: 'BEAMS',
  treatmentDate: date,
  sessions,
});

const records: RtRecord[] = [
  rec('20260101', [
    { beamName: 'F1', specifiedMeterset: 100, deliveredMeterset: 100, currentFraction: 1 },
    { beamName: 'F2', specifiedMeterset: 80, deliveredMeterset: 79.5, currentFraction: 1 },
  ]),
  rec('20260102', [
    { beamName: 'F1', specifiedMeterset: 100, deliveredMeterset: 100, currentFraction: 2 },
    { beamName: 'F2', specifiedMeterset: 80, deliveredMeterset: 80, currentFraction: 2 },
  ]),
];

describe('buildSessionDoseRows', () => {
  it('flattens sessions across records with rounding flags', () => {
    const rows = buildSessionDoseRows(records);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ field: 'F1', fraction: 1, specifiedMU: 100, deliveredMU: 100, muRounded: false });
    // 80 vs 79.5 within 1 MU tolerance → rounding
    expect(rows[1].muRounded).toBe(true);
  });
});

describe('buildDoseCounters', () => {
  it('sums delivered/specified and computes to-be-recorded', () => {
    const c = buildDoseCounters(records);
    expect(c.deliveredFromFractions).toBeCloseTo(359.5); // 100+79.5+100+80
    expect(c.specifiedTotal).toBe(360); // 100+80+100+80
    expect(c.totalCorrections).toBe(0);
    expect(c.deliveredToDate).toBeCloseTo(359.5);
    expect(c.doseToBeRecorded).toBeCloseTo(0.5);
    expect(c.hasMuRounding).toBe(true);
    expect(c.correctionsExcludedFromTotals).toBe(true);
  });

  it('filters by selected date (delivered-to-date)', () => {
    const c = buildDoseCounters(records, { selectedDate: '20260101' });
    expect(c.deliveredFromFractions).toBeCloseTo(179.5); // only first record
  });

  it('adds corrections separately into delivered-to-date but not the fractions counter', () => {
    const c = buildDoseCounters(records, { corrections: [5, 2] });
    expect(c.deliveredFromFractions).toBeCloseTo(359.5);
    expect(c.totalCorrections).toBe(7);
    expect(c.deliveredToDate).toBeCloseTo(366.5);
    expect(c.doseToBeRecorded).toBe(0); // clamped at 0 (over-delivered vs specified)
  });

  it('handles empty input', () => {
    const c = buildDoseCounters([]);
    expect(c).toMatchObject({ deliveredFromFractions: 0, specifiedTotal: 0, doseToBeRecorded: 0, hasMuRounding: false });
  });

  it('exposes the rounding tolerance constant', () => {
    expect(MU_ROUNDING_TOLERANCE).toBe(1);
  });
});
