/**
 * collectOverrideEvents (RTV-168) — honest DICOM-derivable classification of
 * override/exception events from a parsed RT Treatment Record (PS3.3
 * C.8.8.21). Fixtures are inline naturalized objects run through the real
 * parser where sequence placement matters.
 */
import { collectOverrideEvents } from './overrideEvents';
import { parseRtRecord, RtRecord, RT_TREATMENT_RECORD_SOP_CLASS_UIDS } from './rtRecordParser';

const record = (sessions: RtRecord['sessions']): RtRecord => ({
  recordType: 'BEAMS',
  treatmentDate: '20260720',
  treatmentTime: '083000',
  sessions,
});

describe('collectOverrideEvents (RTV-168)', () => {
  it('returns no events for empty/override-free records', () => {
    expect(collectOverrideEvents(undefined)).toEqual([]);
    expect(collectOverrideEvents(null)).toEqual([]);
    expect(
      collectOverrideEvents(
        record([
          {
            beamNumber: 1,
            terminationStatus: 'NORMAL',
            verificationStatus: 'VERIFIED',
            overrides: [],
            corrections: [],
          },
        ])
      )
    ).toEqual([]);
  });

  it('maps OverrideSequence items to machine-override with date/operator (single honest type — ARIA classes are not DICOM-derivable)', () => {
    const events = collectOverrideEvents(
      record([
        {
          beamNumber: 2,
          overrides: [
            {
              parameterPointer: '300A011E',
              reason: 'Couch shift approved',
              operator: 'Doe^Jane',
              controlPointIndex: 1,
            },
          ],
          corrections: [],
        },
      ])
    );
    expect(events).toEqual([
      {
        date: '20260720',
        time: '083000',
        type: 'machine-override',
        beamNumber: 2,
        label: 'Machine override',
        detail: 'Beam 2 · 300A011E · CP 1 · Couch shift approved',
        operator: 'Doe^Jane',
      },
    ]);
  });

  it('maps CorrectedParameterSequence items to parameter-correction', () => {
    const events = collectOverrideEvents(
      record([
        {
          beamNumber: 1,
          overrides: [],
          corrections: [{ parameterPointer: '30080040', value: 0.5 }],
        },
      ])
    );
    expect(events).toEqual([
      expect.objectContaining({
        type: 'parameter-correction',
        beamNumber: 1,
        label: 'Parameter correction',
        detail: 'Beam 1 · 30080040 · Δ 0.5',
      }),
    ]);
  });

  it('maps TreatmentVerificationStatus=VERIFIED_OVR to verify-override (VERIFIED / NOT_VERIFIED are not events)', () => {
    const events = collectOverrideEvents(
      record([
        { beamNumber: 1, verificationStatus: 'VERIFIED', overrides: [], corrections: [] },
        { beamNumber: 2, verificationStatus: 'VERIFIED_OVR', overrides: [], corrections: [] },
        { beamNumber: 3, verificationStatus: 'NOT_VERIFIED', overrides: [], corrections: [] },
      ])
    );
    expect(events).toEqual([
      expect.objectContaining({ type: 'verify-override', beamNumber: 2 }),
    ]);
  });

  it('flags OPERATOR termination WITH partial meterset as manual-treatment (best-effort)', () => {
    const events = collectOverrideEvents(
      record([
        {
          beamNumber: 4,
          terminationStatus: 'OPERATOR',
          specifiedMeterset: 120,
          deliveredMeterset: 80,
          overrides: [],
          corrections: [],
        },
      ])
    );
    expect(events).toEqual([
      expect.objectContaining({
        type: 'manual-treatment',
        beamNumber: 4,
        detail: 'Beam 4 · 80/120 MU · TreatmentTerminationStatus=OPERATOR',
      }),
    ]);
  });

  it('does NOT flag manual-treatment on full delivery or missing metersets (the standard has no manual flag)', () => {
    const full = record([
      {
        beamNumber: 1,
        terminationStatus: 'OPERATOR',
        specifiedMeterset: 100,
        deliveredMeterset: 100,
        overrides: [],
        corrections: [],
      },
    ]);
    const noMeterset = record([
      { beamNumber: 2, terminationStatus: 'OPERATOR', overrides: [], corrections: [] },
    ]);
    const machine = record([
      {
        beamNumber: 3,
        terminationStatus: 'MACHINE',
        specifiedMeterset: 100,
        deliveredMeterset: 50,
        overrides: [],
        corrections: [],
      },
    ]);
    expect(collectOverrideEvents(full)).toEqual([]);
    expect(collectOverrideEvents(noMeterset)).toEqual([]);
    expect(collectOverrideEvents(machine)).toEqual([]);
  });

  it('classifies a naturalized instance end-to-end through parseRtRecord', () => {
    const instance: any = {
      SOPClassUID: RT_TREATMENT_RECORD_SOP_CLASS_UIDS.BEAMS,
      TreatmentDate: '20260721',
      TreatmentTime: '101500',
      TreatmentSessionBeamSequence: [
        {
          ReferencedBeamNumber: 1,
          TreatmentVerificationStatus: 'VERIFIED_OVR',
          TreatmentTerminationStatus: 'OPERATOR',
          SpecifiedPrimaryMeterset: '120',
          DeliveredPrimaryMeterset: '80.5',
          CorrectedParameterSequence: [{ CorrectionValue: '0.5' }],
          ControlPointDeliverySequence: [
            {
              OverrideSequence: [
                { OverrideParameterPointer: '300A011E', OperatorsName: 'Doe^Jane' },
              ],
            },
          ],
        },
      ],
    };
    const events = collectOverrideEvents(parseRtRecord(instance));
    expect(events.map(e => e.type)).toEqual([
      'machine-override',
      'parameter-correction',
      'verify-override',
      'manual-treatment',
    ]);
    expect(events.every(e => e.date === '20260721' && e.time === '101500')).toBe(true);
    expect(events[0].operator).toBe('Doe^Jane');
  });
});
