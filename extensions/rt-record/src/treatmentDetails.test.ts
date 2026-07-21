/**
 * buildTreatmentDetails (RTV-173) — pure view model over a parsed RtRecord:
 * per-beam MU delta, termination/verification status, override/correction
 * counts and MU totals, all tolerant of missing attributes.
 */
import { buildTreatmentDetails } from './treatmentDetails';
import type { RtRecord } from './rtRecordParser';

const fullRecord: RtRecord = {
  recordType: 'BEAMS',
  treatmentDate: '20260110',
  treatmentTime: '101530',
  machine: 'TrueBeam-1',
  fractionNumber: 7,
  sessions: [
    {
      beamNumber: 1,
      beamName: 'AP',
      currentFraction: 7,
      terminationStatus: 'NORMAL',
      verificationStatus: 'VERIFIED',
      specifiedMeterset: 120,
      deliveredMeterset: 120.4,
      overrides: [],
      corrections: [],
    },
    {
      beamNumber: 2,
      beamName: 'PA',
      currentFraction: 7,
      terminationStatus: 'OPERATOR',
      verificationStatus: 'VERIFIED_OVR',
      specifiedMeterset: 100,
      deliveredMeterset: 60,
      overrides: [
        { parameterPointer: '300A011E', reason: 'Gantry tolerance', operator: 'Doe^Jane' },
        { parameterPointer: '300A011E', controlPointIndex: 3 },
      ],
      corrections: [{ value: -0.5, parameterPointer: '3008002B' }],
    },
  ],
  totalDeliveredMeterset: 180.4,
};

describe('buildTreatmentDetails', () => {
  it('maps record header fields (machine/date/time/fraction)', () => {
    const d = buildTreatmentDetails(fullRecord);
    expect(d.machine).toBe('TrueBeam-1');
    expect(d.date).toBe('20260110');
    expect(d.time).toBe('101530');
    expect(d.fraction).toBe(7);
  });

  it('builds one row per beam with MU delta and status fields', () => {
    const d = buildTreatmentDetails(fullRecord);
    expect(d.beams).toHaveLength(2);

    expect(d.beams[0]).toEqual({
      beamNumber: 1,
      name: 'AP',
      specifiedMu: 120,
      deliveredMu: 120.4,
      deltaMu: expect.closeTo(0.4, 6),
      terminationStatus: 'NORMAL',
      verificationStatus: 'VERIFIED',
      overrideCount: 0,
      correctionCount: 0,
    });

    expect(d.beams[1].deltaMu).toBe(-40);
    expect(d.beams[1].terminationStatus).toBe('OPERATOR');
    expect(d.beams[1].verificationStatus).toBe('VERIFIED_OVR');
    expect(d.beams[1].overrideCount).toBe(2);
    expect(d.beams[1].correctionCount).toBe(1);
  });

  it('sums MU totals over the beams that carry them', () => {
    const d = buildTreatmentDetails(fullRecord);
    expect(d.totals.specified).toBe(220);
    expect(d.totals.delivered).toBeCloseTo(180.4, 6);
  });

  it('tolerates missing per-beam fields (no delta, undefined statuses, zero counts)', () => {
    const d = buildTreatmentDetails({
      recordType: 'BEAMS',
      sessions: [
        // Pre-RTV-168 session shape without overrides/corrections arrays.
        { beamNumber: 3, specifiedMeterset: 50 } as any,
        {} as any,
      ],
    });
    expect(d.beams[0]).toMatchObject({
      beamNumber: 3,
      specifiedMu: 50,
      deliveredMu: undefined,
      deltaMu: undefined,
      overrideCount: 0,
      correctionCount: 0,
    });
    expect(d.beams[1].verificationStatus).toBeUndefined();
    // Only beam 0 carries a specified MU; nothing carries a delivered MU.
    expect(d.totals).toEqual({ specified: 50, delivered: undefined });
  });

  it('returns an empty model for null/undefined records', () => {
    expect(buildTreatmentDetails(null)).toEqual({
      machine: undefined,
      date: undefined,
      time: undefined,
      fraction: undefined,
      beams: [],
      totals: {},
    });
    expect(buildTreatmentDetails(undefined).beams).toEqual([]);
  });

  it('handles a record without sessions', () => {
    const d = buildTreatmentDetails({ recordType: 'SUMMARY', sessions: undefined as any });
    expect(d.beams).toEqual([]);
    expect(d.totals).toEqual({ specified: undefined, delivered: undefined });
  });
});
