/**
 * Phase B pure-helper tests: the affine-from-3-probes builder the overlay uses
 * to map image px → canvas CSS px, and the RTIMAGE instance → geometry /
 * ReferencedBeamNumber extraction (real Eclipse DRR fixture).
 */
import { buildAffine2D, isocenterMmToImagePx } from './bevGeometry';
import { parseRtImageBevGeometry, referencedBeamNumber } from './rtBevParser';
import { rtImageGeometry, rtImageInstance } from './__fixtures__/rtplanBevFixture';

describe('buildAffine2D — affine map from 3 probe points', () => {
  it('reproduces the identity', () => {
    const affine = buildAffine2D([0, 0], [1, 0], [0, 1]);
    expect(affine.apply([12.5, -3])).toEqual([12.5, -3]);
  });

  it('reproduces scale + translation (zoomed/panned canvas)', () => {
    // canvas = image * 2 + (100, 50)
    const affine = buildAffine2D([100, 50], [102, 50], [100, 52]);
    expect(affine.apply([0, 0])).toEqual([100, 50]);
    expect(affine.apply([10, 20])).toEqual([120, 90]);
    expect(affine.basisX).toEqual([2, 0]);
    expect(affine.basisY).toEqual([0, 2]);
  });

  it('reproduces a 90° rotation (rotated canvas)', () => {
    // (x, y) → (-y, x): probes (0,0)→(0,0), (1,0)→(0,1), (0,1)→(-1,0)
    const affine = buildAffine2D([0, 0], [0, 1], [-1, 0]);
    const [x, y] = affine.apply([3, 4]);
    expect(x).toBeCloseTo(-4, 12);
    expect(y).toBeCloseTo(3, 12);
  });

  it('reproduces a flip (mirrored canvas)', () => {
    // horizontal flip about x=256: (x, y) → (512 - x, y)
    const affine = buildAffine2D([512, 0], [511, 0], [512, 1]);
    expect(affine.apply([100, 42])).toEqual([412, 42]);
  });
});

describe('parseRtImageBevGeometry — naturalized RTIMAGE → BEV geometry', () => {
  it('extracts the real DRR geometry (swapping [row,col] spacing to [x,y])', () => {
    const geom = parseRtImageBevGeometry(rtImageInstance);
    expect(geom).toEqual(rtImageGeometry);
  });

  it('feeds isocenterMmToImagePx identically to the hand-built geometry', () => {
    const geom = parseRtImageBevGeometry(rtImageInstance)!;
    expect(isocenterMmToImagePx([0, 0], geom)).toEqual(
      isocenterMmToImagePx([0, 0], rtImageGeometry)
    );
    expect(isocenterMmToImagePx([48, -182], geom)).toEqual(
      isocenterMmToImagePx([48, -182], rtImageGeometry)
    );
  });

  it('swaps non-square [row,col] spacing into [x,y] = [col,row]', () => {
    const geom = parseRtImageBevGeometry({
      RTImagePosition: ['-100', '100'],
      ImagePlanePixelSpacing: ['2', '0.5'], // row 2 mm, col 0.5 mm
    })!;
    expect(geom.pixelSpacingMm).toEqual([0.5, 2]);
  });

  it('returns undefined when position or spacing is missing/invalid', () => {
    expect(parseRtImageBevGeometry({})).toBeUndefined();
    expect(parseRtImageBevGeometry({ RTImagePosition: ['-100', '100'] })).toBeUndefined();
    expect(
      parseRtImageBevGeometry({
        RTImagePosition: ['-100', '100'],
        ImagePlanePixelSpacing: ['0', '0'],
      })
    ).toBeUndefined();
  });
});

describe('referencedBeamNumber — top-level first, then sequences', () => {
  it('reads the top-level ReferencedBeamNumber of the real DRR', () => {
    expect(referencedBeamNumber(rtImageInstance)).toBe(1);
  });

  it('falls back to ReferencedRTPlanSequence / ExposureSequence items', () => {
    expect(
      referencedBeamNumber({
        ReferencedRTPlanSequence: [{ ReferencedBeamNumber: '7' }],
      })
    ).toBe(7);
    expect(
      referencedBeamNumber({
        ExposureSequence: [{ ReferencedBeamNumber: 3 }],
      })
    ).toBe(3);
  });

  it('returns undefined when absent', () => {
    expect(referencedBeamNumber({})).toBeUndefined();
  });
});
