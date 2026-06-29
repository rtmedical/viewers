import {
  parseRtRecord,
  recordTypeFromSopClass,
  buildRtRecordCsv,
  RT_TREATMENT_RECORD_SOP_CLASS_UIDS,
} from './rtRecordParser';

const sampleBeamsRecord = () => ({
  SOPClassUID: RT_TREATMENT_RECORD_SOP_CLASS_UIDS.BEAMS,
  TreatmentDate: '20260115',
  TreatmentTime: '101500',
  Manufacturer: 'Varian',
  ReferencedRTPlanSequence: [{ ReferencedSOPInstanceUID: '1.2.plan' }],
  TreatmentSessionBeamSequence: [
    {
      ReferencedBeamNumber: 1,
      BeamName: 'AP',
      CurrentFractionNumber: 5,
      TreatmentTerminationStatus: 'NORMAL',
      SpecifiedPrimaryMeterset: '120',
      DeliveredPrimaryMeterset: '119.8',
      TreatmentMachineName: 'TrueBeam',
      ControlPointDeliverySequence: [{ NominalBeamEnergy: '6', GantryAngle: '0' }],
    },
    {
      ReferencedBeamNumber: 2,
      BeamName: 'PA',
      CurrentFractionNumber: 5,
      TreatmentTerminationStatus: 'NORMAL',
      SpecifiedPrimaryMeterset: '100',
      DeliveredPrimaryMeterset: '100',
      ControlPointDeliverySequence: [{ NominalBeamEnergy: '6', GantryAngle: '180' }],
    },
  ],
});

describe('recordTypeFromSopClass', () => {
  it('maps each of the 4 RT Treatment Record SOP classes', () => {
    expect(recordTypeFromSopClass(RT_TREATMENT_RECORD_SOP_CLASS_UIDS.BEAMS)).toBe('BEAMS');
    expect(recordTypeFromSopClass(RT_TREATMENT_RECORD_SOP_CLASS_UIDS.BRACHY)).toBe('BRACHY');
    expect(recordTypeFromSopClass(RT_TREATMENT_RECORD_SOP_CLASS_UIDS.SUMMARY)).toBe('SUMMARY');
    expect(recordTypeFromSopClass(RT_TREATMENT_RECORD_SOP_CLASS_UIDS.ION_BEAMS)).toBe('ION_BEAMS');
    expect(recordTypeFromSopClass('1.2.3')).toBe('UNKNOWN');
  });
});

describe('parseRtRecord', () => {
  it('parses record-level identity', () => {
    const r = parseRtRecord(sampleBeamsRecord());
    expect(r.recordType).toBe('BEAMS');
    expect(r.treatmentDate).toBe('20260115');
    expect(r.machine).toBe('TrueBeam');
    expect(r.referencedRtPlanUid).toBe('1.2.plan');
  });

  it('parses beam sessions with delivered vs specified meterset', () => {
    const r = parseRtRecord(sampleBeamsRecord());
    expect(r.sessions).toHaveLength(2);
    expect(r.sessions[0]).toMatchObject({
      beamNumber: 1,
      beamName: 'AP',
      currentFraction: 5,
      terminationStatus: 'NORMAL',
      specifiedMeterset: 120,
      deliveredMeterset: 119.8,
      nominalEnergy: 6,
      gantryAngle: 0,
    });
  });

  it('aggregates total delivered meterset and fraction number', () => {
    const r = parseRtRecord(sampleBeamsRecord());
    expect(r.totalDeliveredMeterset).toBeCloseTo(219.8, 5);
    expect(r.fractionNumber).toBe(5);
  });

  it('handles ion beam records via TreatmentSessionIonBeamSequence', () => {
    const inst: any = {
      SOPClassUID: RT_TREATMENT_RECORD_SOP_CLASS_UIDS.ION_BEAMS,
      TreatmentSessionIonBeamSequence: [
        { BeamName: 'Spot1', DeliveredPrimaryMeterset: '50', CurrentFractionNumber: 1 },
      ],
    };
    const r = parseRtRecord(inst);
    expect(r.recordType).toBe('ION_BEAMS');
    expect(r.sessions[0].beamName).toBe('Spot1');
    expect(r.totalDeliveredMeterset).toBe(50);
  });

  it('is defensive about empty/summary records with no beam sequence', () => {
    expect(parseRtRecord(undefined as any).sessions).toEqual([]);
    const summary = parseRtRecord({ SOPClassUID: RT_TREATMENT_RECORD_SOP_CLASS_UIDS.SUMMARY });
    expect(summary.recordType).toBe('SUMMARY');
    expect(summary.sessions).toEqual([]);
    expect(summary.totalDeliveredMeterset).toBeUndefined();
  });
});

describe('buildRtRecordCsv', () => {
  it('emits a header and one row per session', () => {
    const csv = buildRtRecordCsv(parseRtRecord(sampleBeamsRecord()));
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Beam,Name,Fraction');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('119.8');
  });
});
