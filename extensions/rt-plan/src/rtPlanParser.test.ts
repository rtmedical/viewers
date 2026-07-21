import { parseRtPlan, buildRtPlanCsv, RT_PLAN_SOP_CLASS_UID } from './rtPlanParser';

const sampleRtPlan = () => ({
  SOPClassUID: RT_PLAN_SOP_CLASS_UID,
  RTPlanLabel: 'PROST IMRT',
  RTPlanName: 'Prostate',
  ApprovalStatus: 'APPROVED',
  PlanIntent: 'CURATIVE',
  Manufacturer: 'Varian',
  DoseReferenceSequence: [
    {
      DoseReferenceNumber: 1,
      DoseReferenceDescription: 'PTV',
      DoseReferenceStructureType: 'VOLUME',
      DoseReferenceType: 'TARGET',
      TargetPrescriptionDose: '78',
    },
  ],
  BeamSequence: [
    {
      BeamNumber: 1,
      BeamName: 'AP',
      BeamType: 'STATIC',
      RadiationType: 'PHOTON',
      TreatmentMachineName: 'TrueBeam',
      NumberOfControlPoints: 2,
      NumberOfWedges: 0,
      NumberOfBlocks: 0,
      BeamLimitingDeviceSequence: [
        { RTBeamLimitingDeviceType: 'ASYMX', NumberOfLeafJawPairs: 1 },
        { RTBeamLimitingDeviceType: 'ASYMY', NumberOfLeafJawPairs: 1 },
        { RTBeamLimitingDeviceType: 'MLCX', NumberOfLeafJawPairs: 60 },
      ],
      ControlPointSequence: [
        {
          NominalBeamEnergy: '6',
          GantryAngle: '0',
          BeamLimitingDeviceAngle: '0',
          PatientSupportAngle: '0',
          SourceToSurfaceDistance: '905.3',
          IsocenterPosition: ['-12.5', '34', '-105.1'],
          BeamLimitingDevicePositionSequence: [
            { RTBeamLimitingDeviceType: 'ASYMX', LeafJawPositions: ['-43', '46'] },
            { RTBeamLimitingDeviceType: 'ASYMY', LeafJawPositions: ['-57', '44'] },
          ],
        },
      ],
    },
    {
      BeamNumber: 2,
      BeamName: 'PA',
      BeamType: 'STATIC',
      RadiationType: 'PHOTON',
      TreatmentMachineName: 'TrueBeam',
      NumberOfControlPoints: 2,
      ControlPointSequence: [{ NominalBeamEnergy: '10', GantryAngle: '180' }],
    },
  ],
  FractionGroupSequence: [
    {
      FractionGroupNumber: 1,
      NumberOfFractionsPlanned: '39',
      NumberOfBeams: 2,
      ReferencedBeamSequence: [
        { ReferencedBeamNumber: 1, BeamMeterset: '120.5', BeamDose: '1' },
        { ReferencedBeamNumber: 2, BeamMeterset: '100', BeamDose: '1' },
      ],
    },
  ],
});

describe('parseRtPlan', () => {
  it('extracts plan-level identity', () => {
    const p = parseRtPlan(sampleRtPlan());
    expect(p.label).toBe('PROST IMRT');
    expect(p.name).toBe('Prostate');
    expect(p.approvalStatus).toBe('APPROVED');
    expect(p.machine).toBe('TrueBeam');
    expect(p.manufacturer).toBe('Varian');
  });

  it('extracts PlanIntent (300A,000A) for the Course Timeline plan filter (RTV-174)', () => {
    expect(parseRtPlan(sampleRtPlan()).planIntent).toBe('CURATIVE');

    const verification: any = sampleRtPlan();
    verification.PlanIntent = 'VERIFICATION';
    expect(parseRtPlan(verification).planIntent).toBe('VERIFICATION');

    const absent: any = sampleRtPlan();
    delete absent.PlanIntent;
    expect(parseRtPlan(absent).planIntent).toBeUndefined();
  });

  it('parses prescriptions from the dose reference sequence', () => {
    const p = parseRtPlan(sampleRtPlan());
    expect(p.prescriptions).toHaveLength(1);
    expect(p.prescriptions[0]).toMatchObject({
      type: 'TARGET',
      structureType: 'VOLUME',
      targetPrescriptionDoseGy: 78,
    });
  });

  it('parses beams with energy/geometry from the first control point', () => {
    const p = parseRtPlan(sampleRtPlan());
    expect(p.beams).toHaveLength(2);
    expect(p.beams[0]).toMatchObject({
      number: 1,
      name: 'AP',
      energy: '6 MV',
      nominalEnergy: 6,
      gantryAngle: 0,
      collimatorAngle: 0,
    });
    expect(p.beams[1]).toMatchObject({ number: 2, energy: '10 MV', gantryAngle: 180 });
  });

  it('joins meterset (MU) and beam dose from the fraction group onto beams', () => {
    const p = parseRtPlan(sampleRtPlan());
    expect(p.beams[0].meterset).toBe(120.5);
    expect(p.beams[0].beamDoseGy).toBe(1);
    expect(p.beams[1].meterset).toBe(100);
  });

  it('parses Eclipse "Fields" columns: SSD (cm), isocenter, jaws (cm), MLC, group', () => {
    const p = parseRtPlan(sampleRtPlan());
    const b1 = p.beams[0];
    expect(b1.ssdCm).toBeCloseTo(90.53, 2); // 905.3 mm -> cm
    expect(b1.isocenter).toEqual([-12.5, 34, -105.1]); // mm, verbatim
    expect(b1.jawX).toEqual([-4.3, 4.6]); // mm -> cm
    expect(b1.jawY).toEqual([-5.7, 4.4]);
    expect(b1.hasMlc).toBe(true);
    expect(b1.fractionGroupNumber).toBe(1);
    // Beam 2 has no BLD info -> those columns stay undefined, MLC false.
    expect(p.beams[1].ssdCm).toBeUndefined();
    expect(p.beams[1].isocenter).toBeUndefined();
    expect(p.beams[1].jawX).toBeUndefined();
    expect(p.beams[1].hasMlc).toBe(false);
    expect(p.beams[1].fractionGroupNumber).toBe(1);
  });

  it('computes fraction-group fraction dose and plan totals', () => {
    const p = parseRtPlan(sampleRtPlan());
    expect(p.fractionGroups[0]).toMatchObject({ numberOfFractionsPlanned: 39, fractionDoseGy: 2 });
    expect(p.totalMeterset).toBe(220.5);
    expect(p.totalPrescribedDoseGy).toBe(78); // 39 fx × 2 Gy
  });

  it('labels electron energy as MeV', () => {
    const inst: any = sampleRtPlan();
    inst.BeamSequence[0].RadiationType = 'ELECTRON';
    inst.BeamSequence[0].ControlPointSequence[0].NominalBeamEnergy = '12';
    const p = parseRtPlan(inst);
    expect(p.beams[0].energy).toBe('12 MeV');
  });

  it('is defensive about scalar (non-array) sequences and empty input', () => {
    const scalar: any = {
      RTPlanLabel: 'X',
      BeamSequence: { BeamNumber: 1, BeamName: 'Solo', ControlPointSequence: { NominalBeamEnergy: '6', RadiationType: 'PHOTON' } },
      FractionGroupSequence: { NumberOfFractionsPlanned: '5', ReferencedBeamSequence: { ReferencedBeamNumber: 1, BeamMeterset: '50' } },
    };
    const p = parseRtPlan(scalar);
    expect(p.beams).toHaveLength(1);
    expect(p.beams[0].meterset).toBe(50);

    const empty = parseRtPlan(undefined as any);
    expect(empty.beams).toEqual([]);
    expect(empty.prescriptions).toEqual([]);
  });
});

describe('buildRtPlanCsv', () => {
  it('emits a header and one row per beam with MU', () => {
    const csv = buildRtPlanCsv(parseRtPlan(sampleRtPlan()));
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Beam,Name');
    expect(lines).toHaveLength(3); // header + 2 beams
    expect(lines[1]).toContain('120.5');
  });

  it('escapes fields containing commas/quotes', () => {
    const inst: any = sampleRtPlan();
    inst.BeamSequence[0].BeamName = 'AP, boost';
    const csv = buildRtPlanCsv(parseRtPlan(inst));
    expect(csv).toContain('"AP, boost"');
  });
});
