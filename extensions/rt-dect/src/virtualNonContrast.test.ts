import { BASIS_80_140, decompose, muToHu } from './dectDecomposition';
import {
  AGATSTON_THRESHOLD_HU,
  compareToThreshold,
  describeVnc,
  isValidForCalciumScoring,
  STONE_VISIBILITY_LIMIT_MM,
  stoneVisibilityWarning,
  VNC_SOFT_TISSUE_UNCERTAINTY_HU,
  vncHu,
  vncSeriesDescription,
} from './virtualNonContrast';

const WATER = BASIS_80_140.water;
const IODINE = BASIS_80_140.iodine;
const CALCIUM = BASIS_80_140.calcium;

/** HU pair for a water + iodine mixture, plus the enhanced HU it presents as. */
const enhanced = (waterHu: number, iodineDensity: number) => {
  const waterDensity = 1 + waterHu / 1000;
  const huLow = muToHu(waterDensity * WATER.muLow + iodineDensity * IODINE.muLow);
  const huHigh = muToHu(waterDensity * WATER.muHigh + iodineDensity * IODINE.muHigh);
  return { huLow, huHigh };
};

const vnc = (waterHu: number, iodineDensity: number, options = {}) => {
  const pair = enhanced(waterHu, iodineDensity);
  return vncHu(
    decompose({ ...pair, basisA: WATER, basisB: IODINE }),
    (pair.huLow + pair.huHigh) / 2,
    options
  );
};

describe('virtualNonContrast — the subtraction itself', () => {
  it('recovers the unenhanced HU that went in', () => {
    expect(vnc(30, 0.004).hu).toBeCloseTo(30, 5);
  });

  it('leaves a truly unenhanced voxel alone', () => {
    expect(vnc(45, 0).hu).toBeCloseTo(45, 5);
    expect(vnc(45, 0).removedIodineHu).toBeCloseTo(0, 5);
  });

  it('reports how much iodine it took out', () => {
    const result = vnc(30, 0.004);
    expect(result.removedIodineHu).toBeGreaterThan(50);
  });

  it('handles negative HU — fat and lung are unenhanced too', () => {
    expect(vnc(-90, 0).hu).toBeCloseTo(-90, 5);
  });

  it('reports the failure rather than a zero image', () => {
    const result = vncHu(
      decompose({ huLow: 40, huHigh: 38, basisA: WATER, basisB: { ...WATER } }),
      40
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(describeVnc(result)).toBe(result.reason);
  });
});

describe('virtualNonContrast — VNC systematically loses calcium', () => {
  // Calcium is not in the basis, so it is expressed as water plus SPURIOUS iodine — and
  // VNC then subtracts that spurious iodine back out.
  it('darkens calcium relative to what it actually is', () => {
    const density = 0.05;
    const trueHu = muToHu(1 + density * (CALCIUM.muLow - 1));
    const pair = {
      huLow: muToHu(1 + density * (CALCIUM.muLow - 1)),
      huHigh: muToHu(1 + density * (CALCIUM.muHigh - 1)),
    };
    const result = vncHu(decompose({ ...pair, basisA: WATER, basisB: IODINE }), pair.huLow);
    expect(result.ok).toBe(true);
    expect(result.hu).toBeLessThan(trueHu);
  });

  // The score comes out in the same units as a real one, which is what makes it dangerous
  // rather than merely wrong.
  it('REFUSES calcium scoring, always, with the reason', () => {
    const verdict = isValidForCalciumScoring();
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toMatch(new RegExp(`${AGATSTON_THRESHOLD_HU} HU`));
    expect(verdict.reason).toMatch(/aquisição sem contraste verdadeira/);
  });

  it('warns that a small stone may not be there at all', () => {
    const small = stoneVisibilityWarning(2);
    expect(small.reliable).toBe(false);
    expect(small.message).toMatch(/não exclui/);
  });

  it('accepts a stone comfortably above the limit', () => {
    expect(stoneVisibilityWarning(STONE_VISIBILITY_LIMIT_MM + 2).reliable).toBe(true);
    expect(stoneVisibilityWarning(STONE_VISIBILITY_LIMIT_MM + 2).message).toBe('');
  });

  it('warns generically when the size is unknown', () => {
    expect(stoneVisibilityWarning(NaN).reliable).toBe(false);
    expect(stoneVisibilityWarning(0).message).toMatch(new RegExp(`${STONE_VISIBILITY_LIMIT_MM} mm`));
  });

  it('honours a site-specific visibility limit', () => {
    expect(stoneVisibilityWarning(4, 5).reliable).toBe(false);
    expect(stoneVisibilityWarning(4, 3).reliable).toBe(true);
  });
});

describe('virtualNonContrast — the residual is not zero and not random', () => {
  it('always reports an uncertainty, even with no input noise', () => {
    expect(vnc(30, 0.004).uncertaintyHu).toBeCloseTo(VNC_SOFT_TISSUE_UNCERTAINTY_HU, 6);
  });

  // Independent sources, so they add in quadrature: adding linearly over-states and makes
  // VNC look useless; taking the larger under-states.
  it('adds the propagated noise in quadrature with the systematic bias', () => {
    const gain = decompose({ ...enhanced(30, 0.004), basisA: WATER, basisB: IODINE }).noiseGainA;
    const propagated = 20 * gain;
    const noisy = vnc(30, 0.004, { inputNoiseHu: 20 });
    expect(noisy.uncertaintyHu).toBeCloseTo(
      Math.hypot(VNC_SOFT_TISSUE_UNCERTAINTY_HU, propagated),
      6
    );
    expect(noisy.uncertaintyHu).toBeLessThan(VNC_SOFT_TISSUE_UNCERTAINTY_HU + propagated);
    expect(noisy.uncertaintyHu).toBeGreaterThan(propagated);
  });

  // Not a small effect: the water basis is recovered with a gain near 2, which is the
  // well-known "VNC is noisier than a true non-contrast" in one number.
  it('the water basis amplifies input noise by about 2x', () => {
    const gain = decompose({ ...enhanced(30, 0.004), basisA: WATER, basisB: IODINE }).noiseGainA;
    expect(gain).toBeGreaterThan(1.5);
    expect(gain).toBeLessThan(3);
  });

  it('accepts a site-measured bias in place of the reference value', () => {
    expect(vnc(30, 0.004, { softTissueUncertaintyHu: 4 }).uncertaintyHu).toBeCloseTo(4, 6);
  });

  it('carries the value and its uncertainty into the readout', () => {
    expect(describeVnc(vnc(30, 0.004))).toMatch(/^VNC 30 ± 10 HU \(iodo removido: \d+ HU\)$/);
  });

  it('omits the removed-iodine note when nothing was removed', () => {
    expect(describeVnc(vnc(45, 0))).toBe('VNC 45 ± 10 HU');
  });
});

describe('virtualNonContrast — comparing to a diagnostic threshold', () => {
  const at = (hu: number, options = {}) => compareToThreshold(vnc(hu, 0.004, options), 20, 'limiar de cisto simples');

  // The uncomfortable consequence of being honest about ±10 HU: at the reference
  // uncertainty, VNC cannot make the 20 HU simple-cyst call at all unless the value is
  // below 0 or above 40. That is a finding about VNC, not a defect in the comparison.
  it('cannot make the simple-cyst call at the reference uncertainty', () => {
    expect(at(2).verdict).toBe('inconclusive');
    expect(at(2).message).toMatch(/use aquisição sem contraste verdadeira/);
  });

  it('can make it once a site measures a tighter uncertainty', () => {
    const read = at(2, { softTissueUncertaintyHu: 4 });
    expect(read.verdict).toBe('clearlyBelow');
    expect(read.message).toMatch(/abaixo do limiar de cisto simples de 20 HU/);
  });

  it('calls a clearly dense lesion dense', () => {
    expect(at(80).verdict).toBe('clearlyAbove');
  });

  // The 8-vs-22 HU distinction is exactly what VNC cannot settle and true non-contrast can.
  it('says INCONCLUSIVE when the uncertainty crosses the threshold', () => {
    const read = at(18);
    expect(read.verdict).toBe('inconclusive');
    expect(read.message).toMatch(/use aquisição sem contraste verdadeira/);
  });

  // A point comparison is how a measurement with known uncertainty gets reported as a fact.
  it('uses 2 sigma, not the point value', () => {
    // 5 HU is 15 below the threshold — inside 2σ of the 10 HU reference uncertainty.
    expect(at(5).verdict).toBe('inconclusive');
    // With a tighter, site-measured uncertainty the same value becomes decidable.
    expect(at(5, { softTissueUncertaintyHu: 2 }).verdict).toBe('clearlyBelow');
  });

  it('reports unavailable rather than guessing', () => {
    const read = compareToThreshold(
      vncHu(decompose({ huLow: 1, huHigh: 1, basisA: WATER, basisB: { ...WATER } }), 1),
      20
    );
    expect(read.verdict).toBe('unavailable');
  });
});

describe('virtualNonContrast — the series carries its own caveat', () => {
  it('says it is not equivalent to a true unenhanced acquisition', () => {
    expect(vncSeriesDescription()).toMatch(/NÃO equivale a aquisição sem contraste/);
  });

  it('names the source series when there is one', () => {
    expect(vncSeriesDescription('ABDOME PORTAL')).toMatch(/derivada de ABDOME PORTAL/);
  });

  it('is defensive about a blank source', () => {
    expect(vncSeriesDescription('   ')).toBe(vncSeriesDescription());
  });
});
