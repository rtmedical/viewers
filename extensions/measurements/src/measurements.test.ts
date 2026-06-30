import {
  huStats,
  cobbAngle,
  agatstonWeight,
  agatstonScore,
  dicomTimeToSeconds,
  parseRadiopharmaceutical,
  suvBwFactor,
  convertToSuvBw,
  suvStats,
} from './measurements';

describe('huStats (RTV-28)', () => {
  it('computes count/min/max/mean/sd', () => {
    const s = huStats([10, 20, 30]);
    expect(s).toMatchObject({ count: 3, min: 10, max: 30, mean: 20 });
    expect(s.sd).toBeCloseTo(8.165, 2);
  });
  it('handles empty input', () => {
    expect(huStats([])).toEqual({ count: 0 });
  });
});

describe('cobbAngle (RTV-30)', () => {
  it('is the acute angle (0–90) between two lines', () => {
    expect(cobbAngle([[0, 0], [10, 0]], [[0, 0], [10, 10]])).toBe(45);
    expect(cobbAngle([[0, 0], [10, 0]], [[0, 0], [0, 10]])).toBe(90);
    // 0° vs 135° → 135 → folded to 45
    expect(cobbAngle([[0, 0], [10, 0]], [[0, 0], [-10, 10]])).toBe(45);
  });
});

describe('agatston (RTV-46)', () => {
  it('weights by peak HU per ACR thresholds', () => {
    expect([100, 150, 250, 350, 450].map(agatstonWeight)).toEqual([0, 1, 2, 3, 4]);
  });
  it('scores Σ(area × weight)', () => {
    const r = agatstonScore([{ areaMm2: 5, maxHu: 250 }, { areaMm2: 2, maxHu: 450 }]);
    expect(r.perLesion).toEqual([10, 8]); // 5×2, 2×4
    expect(r.total).toBe(18);
  });
});

describe('SUVbw (RTV-29)', () => {
  it('parses time + radiopharmaceutical info', () => {
    expect(dicomTimeToSeconds('101500')).toBe(36900);
    const info = parseRadiopharmaceutical({
      RadiopharmaceuticalInformationSequence: [
        { RadionuclideTotalDose: '370000000', RadionuclideHalfLife: '6586.2', RadiopharmaceuticalStartTime: '101500' },
      ],
    });
    expect(info).toEqual({ injectedDoseBq: 370000000, halfLifeSec: 6586.2, injectionTime: '101500' });
  });

  it('computes the SUVbw factor and applies decay', () => {
    const base = suvBwFactor({ patientWeightKg: 70, injectedDoseBq: 370e6, halfLifeSec: 6586.2, elapsedSec: 0 })!;
    expect(base).toBeCloseTo(70000 / 370e6, 9);
    // one half-life elapsed → dose halves → factor doubles
    const decayed = suvBwFactor({ patientWeightKg: 70, injectedDoseBq: 370e6, halfLifeSec: 6586.2, elapsedSec: 6586.2 })!;
    expect(decayed).toBeCloseTo(base * 2, 9);
  });

  it('guards against bad inputs', () => {
    expect(suvBwFactor({ patientWeightKg: 0, injectedDoseBq: 370e6, halfLifeSec: 6586.2 })).toBeUndefined();
    expect(suvBwFactor({ patientWeightKg: 70, injectedDoseBq: 0, halfLifeSec: 6586.2 })).toBeUndefined();
  });

  it('converts values + computes SUV stats', () => {
    const factor = 1e-6;
    expect(convertToSuvBw(5_000_000, factor)).toBe(5);
    const s = suvStats([2_000_000, 6_000_000, 4_000_000], factor);
    expect(s).toMatchObject({ count: 3, minSuv: 2, maxSuv: 6, meanSuv: 4 });
  });
});
