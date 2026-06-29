import {
  parseRtStruct,
  contourArea,
  approximateVolumeCc,
  buildRtStructCsv,
  rgbToHex,
  RT_STRUCT_SOP_CLASS_UID,
} from './rtStructParser';

// 10×10 mm square at a given z, as flat [x,y,z,...] contour data.
const square = (z: number) => [0, 0, z, 10, 0, z, 10, 10, z, 0, 10, z];

const sampleRtStruct = () => ({
  SOPClassUID: RT_STRUCT_SOP_CLASS_UID,
  StructureSetLabel: 'RS1',
  StructureSetROISequence: [
    { ROINumber: 1, ROIName: 'PTV', ROIGenerationAlgorithm: 'MANUAL' },
    { ROINumber: 2, ROIName: 'BODY', ROIGenerationAlgorithm: 'AUTOMATIC' },
  ],
  ROIContourSequence: [
    {
      ReferencedROINumber: 1,
      ROIDisplayColor: [255, 0, 0],
      ContourSequence: [
        { ContourData: square(0) },
        { ContourData: square(2) },
      ],
    },
  ],
  RTROIObservationsSequence: [{ ReferencedROINumber: 1, RTROIInterpretedType: 'PTV' }],
});

describe('contourArea', () => {
  it('computes the shoelace area of a planar square (mm²)', () => {
    expect(contourArea(square(0))).toBe(100);
  });
  it('returns 0 for degenerate contours', () => {
    expect(contourArea([0, 0, 0, 1, 1, 0])).toBe(0);
  });
});

describe('approximateVolumeCc', () => {
  it('estimates volume as Σarea × slice thickness, in cm³', () => {
    // two 100 mm² slices, 2 mm apart -> 200 × 2 = 400 mm³ = 0.4 cc
    expect(approximateVolumeCc([square(0), square(2)])).toBeCloseTo(0.4, 5);
  });
  it('returns undefined when there are no planar contours', () => {
    expect(approximateVolumeCc([])).toBeUndefined();
  });
});

describe('parseRtStruct', () => {
  it('joins ROI / contour / observation by ROINumber', () => {
    const rs = parseRtStruct(sampleRtStruct());
    expect(rs.label).toBe('RS1');
    expect(rs.structures).toHaveLength(2);

    const ptv = rs.structures[0];
    expect(ptv).toMatchObject({
      roiNumber: 1,
      name: 'PTV',
      interpretedType: 'PTV',
      algorithm: 'MANUAL',
      numContours: 2,
      numPoints: 8,
    });
    expect(ptv.color).toEqual([255, 0, 0]);
    expect(ptv.approxVolumeCc).toBeCloseTo(0.4, 5);
  });

  it('handles a structure with no contours', () => {
    const body = parseRtStruct(sampleRtStruct()).structures[1];
    expect(body).toMatchObject({ roiNumber: 2, name: 'BODY', numContours: 0, numPoints: 0 });
    expect(body.approxVolumeCc).toBeUndefined();
    expect(body.color).toBeUndefined();
  });

  it('is defensive about empty input', () => {
    expect(parseRtStruct(undefined as any).structures).toEqual([]);
  });
});

describe('rgbToHex / buildRtStructCsv', () => {
  it('formats RGB as hex', () => {
    expect(rgbToHex([255, 0, 0])).toBe('#ff0000');
    expect(rgbToHex(undefined)).toBe('#888888');
  });

  it('emits a header and one row per structure', () => {
    const csv = buildRtStructCsv(parseRtStruct(sampleRtStruct()));
    const lines = csv.split('\n');
    expect(lines[0]).toContain('ROI,Name,Type');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('PTV');
  });
});
