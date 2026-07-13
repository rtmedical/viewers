import parseRtPlanBev, { BevBeam } from './rtBevParser';
import {
  rtPlanInstance,
  CP0_MLCX_LEAF_JAW_POSITIONS,
  LEAF_POSITION_BOUNDARIES,
} from './__fixtures__/rtplanBevFixture';

const clone = (o: any) => JSON.parse(JSON.stringify(o));

describe('parseRtPlanBev — real Siemens Primus plan, beam 1 "1int"', () => {
  let beam: BevBeam;

  beforeAll(() => {
    const beams = parseRtPlanBev(rtPlanInstance);
    expect(beams).toHaveLength(1);
    beam = beams[0];
  });

  it('parses beam identity and machine geometry (DS strings → numbers)', () => {
    expect(beam.beamNumber).toBe(1);
    expect(beam.name).toBe('1int');
    expect(beam.sadMm).toBe(1000); // SourceAxisDistance arrives as '1000'
    expect(beam.mlcType).toBe('MLCX');
    expect(beam.controlPoints).toHaveLength(2);
  });

  it('parses 30 leaf boundaries for 29 pairs (pairs + 1)', () => {
    expect(beam.numberOfLeafPairs).toBe(29);
    expect(beam.leafBoundariesMm).toHaveLength(30);
    expect(beam.leafBoundariesMm).toHaveLength(LEAF_POSITION_BOUNDARIES.length);
    expect(beam.leafBoundariesMm![0]).toBe(-200);
    expect(beam.leafBoundariesMm![1]).toBe(-135);
    expect(beam.leafBoundariesMm![29]).toBe(200);
    beam.leafBoundariesMm!.forEach(b => expect(typeof b).toBe('number'));
  });

  it('splits the 58 MLCX LeafJawPositions at the midpoint into 29 + 29 banks', () => {
    const cp0 = beam.controlPoints[0];
    expect(CP0_MLCX_LEAF_JAW_POSITIONS).toHaveLength(58);
    expect(cp0.bankA).toHaveLength(29);
    expect(cp0.bankB).toHaveLength(29);
    // Bank A (first half): 14× -90.69, then -92.39, then 14× parked 47.51.
    expect(cp0.bankA[0]).toBe(-90.69);
    expect(cp0.bankA[13]).toBe(-90.69);
    expect(cp0.bankA[14]).toBe(-92.39);
    expect(cp0.bankA[15]).toBe(47.51);
    expect(cp0.bankA[28]).toBe(47.51);
    // Bank B (second half): 3.1 rising to 47.6, then parked 47.51.
    expect(cp0.bankB[0]).toBe(3.1);
    expect(cp0.bankB[13]).toBe(47.6);
    expect(cp0.bankB[14]).toBe(47.51);
    expect(cp0.bankB[28]).toBe(47.51);
    // Everything numeric (strings coerced), closed pairs meet exactly.
    [...cp0.bankA, ...cp0.bankB].forEach(v => expect(Number.isFinite(v)).toBe(true));
    for (let i = 15; i < 29; i++) {
      expect(cp0.bankA[i]).toBe(cp0.bankB[i]); // parked closed at +47.51
    }
  });

  it('parses jaws in signed mm from ASYMX/ASYMY', () => {
    const cp0 = beam.controlPoints[0];
    expect(cp0.jawXmm).toEqual([-93, 48]);
    expect(cp0.jawYmm).toEqual([-182, 0]);
  });

  it('parses CP0 angles and beam isocenter', () => {
    const cp0 = beam.controlPoints[0];
    expect(cp0.index).toBe(0);
    expect(cp0.gantryAngle).toBe(40);
    expect(cp0.collimatorAngleDeg).toBe(0);
    expect(beam.isocenterMm).toEqual([
      -108.463541543, 42.604166796, 349.699981838349,
    ]);
  });

  it('carries gantry/collimator/jaws/leaves forward into the sparse CP1', () => {
    const [cp0, cp1] = beam.controlPoints;
    expect(cp1.index).toBe(1);
    expect(cp1.gantryAngle).toBe(40);
    expect(cp1.collimatorAngleDeg).toBe(0);
    expect(cp1.jawXmm).toEqual([-93, 48]);
    expect(cp1.jawYmm).toEqual([-182, 0]);
    expect(cp1.bankA).toEqual(cp0.bankA);
    expect(cp1.bankB).toEqual(cp0.bankB);
    // Inherited state is copied, not aliased.
    expect(cp1.bankA).not.toBe(cp0.bankA);
    expect(cp1.jawXmm).not.toBe(cp0.jawXmm);
  });

  it('lets a later CP override inherited values without losing the rest', () => {
    const instance = clone(rtPlanInstance);
    Object.assign(instance.BeamSequence[0].ControlPointSequence[1], {
      GantryAngle: '220',
      BeamLimitingDevicePositionSequence: [
        { RTBeamLimitingDeviceType: 'ASYMX', LeafJawPositions: ['-50', '50'] },
      ],
    });
    const cp1 = parseRtPlanBev(instance)[0].controlPoints[1];
    expect(cp1.gantryAngle).toBe(220); // overridden
    expect(cp1.jawXmm).toEqual([-50, 50]); // overridden
    expect(cp1.jawYmm).toEqual([-182, 0]); // still inherited
    expect(cp1.collimatorAngleDeg).toBe(0); // still inherited
    expect(cp1.bankA[0]).toBe(-90.69); // still inherited
  });
});

describe('parseRtPlanBev — robustness', () => {
  it('skips beams without any BeamLimitingDevicePositionSequence', () => {
    const instance = clone(rtPlanInstance);
    instance.BeamSequence.push({
      BeamNumber: 99,
      BeamName: 'SETUP',
      TreatmentDeliveryType: 'SETUP',
      NumberOfControlPoints: 1,
      ControlPointSequence: [{ ControlPointIndex: 0, GantryAngle: '0' }],
    });
    const beams = parseRtPlanBev(instance);
    expect(beams).toHaveLength(1);
    expect(beams[0].beamNumber).toBe(1);
  });

  it('returns [] for empty or beam-less instances', () => {
    expect(parseRtPlanBev({})).toEqual([]);
    expect(parseRtPlanBev(undefined as any)).toEqual([]);
    expect(parseRtPlanBev({ BeamSequence: [] })).toEqual([]);
  });

  it('handles a naturalized scalar BeamSequence (single item, not array)', () => {
    const instance = { BeamSequence: clone(rtPlanInstance).BeamSequence[0] };
    const beams = parseRtPlanBev(instance);
    expect(beams).toHaveLength(1);
    expect(beams[0].controlPoints[0].bankA).toHaveLength(29);
  });

  it('parses wedge orientation and block points when present', () => {
    const instance = clone(rtPlanInstance);
    Object.assign(instance.BeamSequence[0], {
      NumberOfWedges: 1,
      WedgeSequence: [{ WedgeNumber: 1, WedgeOrientation: '90' }],
      NumberOfBlocks: 1,
      BlockSequence: [
        {
          BlockType: 'APERTURE',
          BlockNumberOfPoints: 3,
          BlockData: ['-10', '0', '10', '0', '0', '20'],
        },
      ],
    });
    const beam = parseRtPlanBev(instance)[0];
    expect(beam.wedgeOrientationDeg).toBe(90);
    expect(beam.blocks).toHaveLength(1);
    expect(beam.blocks![0].type).toBe('APERTURE');
    expect(beam.blocks![0].pointsMm).toEqual([
      [-10, 0],
      [10, 0],
      [0, 20],
    ]);
  });

  it('yields empty banks for a jaw-only beam (no MLC device)', () => {
    const instance = clone(rtPlanInstance);
    const b = instance.BeamSequence[0];
    b.BeamLimitingDeviceSequence = b.BeamLimitingDeviceSequence.slice(0, 2);
    b.ControlPointSequence[0].BeamLimitingDevicePositionSequence =
      b.ControlPointSequence[0].BeamLimitingDevicePositionSequence.slice(0, 2);
    const beam = parseRtPlanBev(instance)[0];
    expect(beam.mlcType).toBeUndefined();
    expect(beam.leafBoundariesMm).toBeUndefined();
    expect(beam.controlPoints[0].bankA).toEqual([]);
    expect(beam.controlPoints[0].bankB).toEqual([]);
    expect(beam.controlPoints[0].jawXmm).toEqual([-93, 48]);
  });
});
