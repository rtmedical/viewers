import {
  isocenterMmToImagePx,
  leafApertureRects,
  rotateAboutDeg,
  RtImageGeometry,
} from './bevGeometry';
import parseRtPlanBev, { BevBeam } from './rtBevParser';
import { rtPlanInstance, rtImageGeometry } from './__fixtures__/rtplanBevFixture';

describe('isocenterMmToImagePx — real Eclipse DRR geometry (512×512)', () => {
  it('maps the isocenter (0,0) exactly onto the beam-axis pixel [255.5, 255.5]', () => {
    // xc = -(-249.51171875)/0.9765625 = 255.5, yc = 249.51171875/0.9765625 = 255.5
    const [px, py] = isocenterMmToImagePx([0, 0], rtImageGeometry);
    expect(px).toBe(255.5);
    expect(py).toBe(255.5);
  });

  it('maps +x right and +y UP-screen (pixel y decreases)', () => {
    const [px, py] = isocenterMmToImagePx([10, 20], rtImageGeometry);
    expect(px).toBeCloseTo(255.5 + 10 / 0.9765625, 9); // 265.74
    expect(py).toBeCloseTo(255.5 - 20 / 0.9765625, 9); // 235.02
    expect(px).toBeCloseTo(265.74, 9);
    expect(py).toBeCloseTo(235.02, 9);
  });

  it('maps the real jaw edges with the legacy sign convention', () => {
    // Y2 = 0 (top jaw at the axis) → exactly yc; Y1 = -182 → BELOW the axis.
    const [, pyY2] = isocenterMmToImagePx([0, 0], rtImageGeometry);
    const [, pyY1] = isocenterMmToImagePx([0, -182], rtImageGeometry);
    expect(pyY2).toBe(255.5);
    expect(pyY1).toBeCloseTo(255.5 + 182 / 0.9765625, 9); // 441.868
    expect(pyY1).toBeGreaterThan(pyY2); // y1 (negative jaw) renders lower

    const [pxX1] = isocenterMmToImagePx([-93, 0], rtImageGeometry);
    const [pxX2] = isocenterMmToImagePx([48, 0], rtImageGeometry);
    expect(pxX1).toBeCloseTo(255.5 - 93 / 0.9765625, 9); // 160.268
    expect(pxX2).toBeCloseTo(255.5 + 48 / 0.9765625, 9); // 304.652
  });

  it('applies sid/sad magnification (SID 1500 / SAD 1000 → factor 1.5)', () => {
    // DICOM PS3.3 C.8.8.2: spacing/position live at the RT image plane (SID)
    // while LeafJawPositions are at the isocenter plane (SAD) — divergent-beam
    // projection MAGNIFIES isocenter-plane mm by SID/SAD at the detector.
    const geom: RtImageGeometry = { ...rtImageGeometry, sadMm: 1000, sidMm: 1500 };
    const [px, py] = isocenterMmToImagePx([30, -30], geom);
    const mag = 1500 / 1000;
    expect(px).toBeCloseTo(255.5 + (30 * mag) / 0.9765625, 9); // 301.58
    expect(py).toBeCloseTo(255.5 + (30 * mag) / 0.9765625, 9);
    expect(px).toBeCloseTo(301.58, 6);
  });

  it('defaults magnification to 1 when SID or SAD is missing/zero', () => {
    const base = isocenterMmToImagePx([25, -40], rtImageGeometry);
    const noSid: RtImageGeometry = {
      rtImagePositionMm: rtImageGeometry.rtImagePositionMm,
      pixelSpacingMm: rtImageGeometry.pixelSpacingMm,
      sadMm: 1000,
    };
    const zeroSid: RtImageGeometry = { ...noSid, sidMm: 0 };
    expect(isocenterMmToImagePx([25, -40], noSid)).toEqual(base);
    expect(isocenterMmToImagePx([25, -40], zeroSid)).toEqual(base);
  });
});

describe('rotateAboutDeg', () => {
  it('rotates 90° about the origin', () => {
    const [x, y] = rotateAboutDeg([1, 0], [0, 0], 90);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(1, 12);
  });

  it('rotates about an arbitrary center (the beam-axis pixel)', () => {
    const [x, y] = rotateAboutDeg([265.5, 255.5], [255.5, 255.5], 90);
    expect(x).toBeCloseTo(255.5, 9);
    expect(y).toBeCloseTo(265.5, 9);
  });

  it('negative angle mirrors the legacy -collimatorAngle convention', () => {
    const [x, y] = rotateAboutDeg([1, 0], [0, 0], -90);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(-1, 12);
  });

  it('0° and 360° are identities', () => {
    expect(rotateAboutDeg([3, 4], [1, 1], 0)).toEqual([3, 4]);
    const [x, y] = rotateAboutDeg([3, 4], [1, 1], 360);
    expect(x).toBeCloseTo(3, 9);
    expect(y).toBeCloseTo(4, 9);
  });
});

describe('leafApertureRects — real beam 1 "1int" (MLCX, 29 pairs)', () => {
  let beam: BevBeam;

  beforeAll(() => {
    beam = parseRtPlanBev(rtPlanInstance)[0];
  });

  it('emits ≤ 29 rects per bank; only the 15 pairs inside the Y jaw survive', () => {
    const rects = leafApertureRects(beam, 0);
    const bankA = rects.filter(r => r.bank === 'A');
    const bankB = rects.filter(r => r.bank === 'B');
    expect(bankA.length).toBeLessThanOrEqual(29);
    expect(bankB.length).toBeLessThanOrEqual(29);
    // Y jaw [-182, 0] exposes pairs 0..14 (boundaries -200 … -5..5 straddles 0).
    expect(bankA).toHaveLength(15);
    expect(bankB).toHaveLength(15);
    // Pairs 15..28 sit entirely above Y=0 → fully clipped.
    expect(rects.every(r => r.leafIndex <= 14)).toBe(true);
  });

  it('clips every rect to the jaw window [-93,48] × [-182,0]', () => {
    const rects = leafApertureRects(beam, 0);
    for (const r of rects) {
      expect(r.xMm1).toBeGreaterThanOrEqual(-93);
      expect(r.xMm2).toBeLessThanOrEqual(48);
      expect(r.yMm1).toBeGreaterThanOrEqual(-182);
      expect(r.yMm2).toBeLessThanOrEqual(0);
      expect(r.xMm2).toBeGreaterThan(r.xMm1);
      expect(r.yMm2).toBeGreaterThan(r.yMm1);
    }
  });

  it('MLCX orientation: leaves travel along X, boundaries span Y', () => {
    const rects = leafApertureRects(beam, 0);
    // Leaf 0 (span [-200,-135] clipped to [-182,-135] by Y1):
    const a0 = rects.find(r => r.bank === 'A' && r.leafIndex === 0)!;
    expect(a0).toMatchObject({ xMm1: -93, xMm2: -90.69, yMm1: -182, yMm2: -135 });
    const b0 = rects.find(r => r.bank === 'B' && r.leafIndex === 0)!;
    expect(b0).toMatchObject({ xMm1: 3.1, xMm2: 48, yMm1: -182, yMm2: -135 });
    // Leaf 14 (span [-5,5] clipped to [-5,0] by Y2), bank A tip -92.39:
    const a14 = rects.find(r => r.bank === 'A' && r.leafIndex === 14)!;
    expect(a14).toMatchObject({ xMm1: -93, xMm2: -92.39, yMm1: -5, yMm2: 0 });
    const b14 = rects.find(r => r.bank === 'B' && r.leafIndex === 14)!;
    expect(b14).toMatchObject({ xMm1: 47.51, xMm2: 48, yMm1: -5, yMm2: 0 });
  });

  it('sparse CP1 (inherited state) produces the same rects as CP0', () => {
    expect(leafApertureRects(beam, 1)).toEqual(leafApertureRects(beam, 0));
  });

  it('returns [] for an out-of-range control point or a beam without MLC', () => {
    expect(leafApertureRects(beam, 2)).toEqual([]);
    expect(leafApertureRects(beam, -1)).toEqual([]);
    const jawOnly: BevBeam = {
      beamNumber: 7,
      controlPoints: [
        { index: 0, jawXmm: [-50, 50], jawYmm: [-50, 50], bankA: [], bankB: [] },
      ],
    };
    expect(leafApertureRects(jawOnly, 0)).toEqual([]);
  });
});

describe('leafApertureRects — MLCY axis swap and jaw fallbacks', () => {
  const mlcyBeam: BevBeam = {
    beamNumber: 2,
    mlcType: 'MLCY',
    numberOfLeafPairs: 2,
    leafBoundariesMm: [-10, 0, 10],
    controlPoints: [
      {
        index: 0,
        jawXmm: [-10, 10],
        jawYmm: [-8, 8],
        bankA: [-5, -4],
        bankB: [5, 4],
      },
    ],
  };

  it('MLCY: leaves travel along Y, boundaries span X', () => {
    const rects = leafApertureRects(mlcyBeam, 0);
    expect(rects).toHaveLength(4);
    const a0 = rects.find(r => r.bank === 'A' && r.leafIndex === 0)!;
    // Span (X) = boundaries[0..1] = [-10, 0]; travel (Y) = jawY1 -8 → tip -5.
    expect(a0).toMatchObject({ xMm1: -10, xMm2: 0, yMm1: -8, yMm2: -5 });
    const b1 = rects.find(r => r.bank === 'B' && r.leafIndex === 1)!;
    // Leaf 1 span (X) = [0, 10]; travel (Y) = tip 4 → jawY2 8.
    expect(b1).toMatchObject({ xMm1: 0, xMm2: 10, yMm1: 4, yMm2: 8 });
  });

  it('falls back to a padded bank extent / boundary extent when jaws are missing', () => {
    const noJaws: BevBeam = {
      beamNumber: 3,
      mlcType: 'MLCX',
      numberOfLeafPairs: 2,
      leafBoundariesMm: [-10, 0, 10],
      controlPoints: [{ index: 0, bankA: [-5, -4], bankB: [5, 4] }],
    };
    const rects = leafApertureRects(noJaws, 0);
    // Travel window falls back to [min(bankA), max(bankB)] PADDED by
    // TRAVEL_FALLBACK_PAD_MM (10) → [-15, 15]: EVERY leaf renders a
    // non-degenerate body, including the most-open leaf of each bank (whose
    // tip is the extremum and would otherwise clip to zero width).
    expect(rects).toHaveLength(4);
    const a0 = rects.find(r => r.bank === 'A' && r.leafIndex === 0)!;
    expect(a0).toMatchObject({ xMm1: -15, xMm2: -5, yMm1: -10, yMm2: 0 });
    const a1 = rects.find(r => r.bank === 'A' && r.leafIndex === 1)!;
    expect(a1).toMatchObject({ xMm1: -15, xMm2: -4, yMm1: 0, yMm2: 10 });
    const b0 = rects.find(r => r.bank === 'B' && r.leafIndex === 0)!;
    expect(b0).toMatchObject({ xMm1: 5, xMm2: 15, yMm1: -10, yMm2: 0 });
    const b1 = rects.find(r => r.bank === 'B' && r.leafIndex === 1)!;
    expect(b1).toMatchObject({ xMm1: 4, xMm2: 15, yMm1: 0, yMm2: 10 });
  });
});
