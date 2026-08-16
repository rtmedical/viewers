import {
  absoluteUptake,
  Acquisition,
  comparable,
  countRate,
  decayFactor,
  describeUptake,
  HALF_LIFE_HOURS,
  netInjectedDose,
  relativeRenalFunction,
  RENAL_SPLIT_NORMAL_HIGH,
  RENAL_SPLIT_NORMAL_LOW,
  targetToBackground,
} from './spectQuantification';

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

const acquisition = (over: Partial<Acquisition> = {}): Acquisition => ({
  durationSec: 600,
  acquiredAt: T0 + 3 * HOUR,
  nuclide: 'Tc-99m',
  attenuationCorrected: true,
  ...over,
});

const dose = (over = {}) => ({
  syringeBeforeMBq: 800,
  syringeAfterMBq: 0,
  injectedAt: T0,
  ...over,
});

const roi = (counts: number, voxels = 1000) => ({ label: 'roi', counts, voxels });

describe('spectQuantification — decay', () => {
  it('halves at one half-life', () => {
    expect(decayFactor('Tc-99m', HALF_LIFE_HOURS['Tc-99m'])).toBeCloseTo(0.5, 10);
  });

  it('knows the long-lived therapy nuclides too', () => {
    expect(HALF_LIFE_HOURS['I-131']).toBeCloseTo(192.6, 1);
    expect(decayFactor('Lu-177', 159.53)).toBeCloseTo(0.5, 6);
  });

  it('refuses an unknown nuclide rather than assuming one', () => {
    expect(Number.isNaN(decayFactor('Xx-000', 1))).toBe(true);
  });
});

describe('spectQuantification — counts need a duration', () => {
  it('normalises to counts per second', () => {
    expect(countRate(roi(60000), acquisition()).cps).toBeCloseTo(100, 10);
  });

  // A raw count from a 10-minute and a 20-minute acquisition differ by two for no
  // clinical reason, and both are labelled "counts".
  it('refuses a count with no acquisition duration', () => {
    const result = countRate(roi(60000), acquisition({ durationSec: 0 }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/não é comparável entre aquisições de tempos diferentes/);
  });

  it('gives a mean per voxel', () => {
    expect(countRate(roi(60000, 200), acquisition()).meanCps).toBeCloseTo(0.5, 10);
  });

  it('refuses negative counts', () => {
    expect(countRate(roi(-1), acquisition()).ok).toBe(false);
  });
});

describe('spectQuantification — the injected dose is not the drawn dose', () => {
  it('subtracts the residual', () => {
    const result = netInjectedDose(dose({ syringeAfterMBq: 20 }), 'Tc-99m');
    expect(result.netMBq).toBeCloseTo(780, 6);
  });

  // A residual measured an hour after injection has already decayed; subtracting it
  // uncorrected under-subtracts.
  it('decay-corrects a residual measured later', () => {
    const result = netInjectedDose(
      dose({ syringeAfterMBq: 20, residualMeasuredAt: T0 + HOUR }),
      'Tc-99m'
    );
    expect(result.netMBq).toBeLessThan(780);
    expect(result.netMBq).toBeCloseTo(777.55, 1);
  });

  // The bias is in one direction for every patient, so it survives averaging.
  it('refuses to guess a missing residual', () => {
    const result = netInjectedDose(dose({ syringeAfterMBq: undefined as never }), 'Tc-99m');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/inflado em 2–5% para todo paciente, sempre na mesma direção/);
  });

  it('flags an implausibly large residual', () => {
    const result = netInjectedDose(dose({ syringeAfterMBq: 200 }), 'Tc-99m');
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/acima do esperado/);
  });

  it('refuses a residual larger than what was drawn', () => {
    expect(netInjectedDose(dose({ syringeAfterMBq: 900 }), 'Tc-99m').ok).toBe(false);
  });
});

describe('spectQuantification — there is no SUV, and the refusal is the feature', () => {
  // A number with decimals gets compared to last year's study on another camera.
  it('refuses an absolute uptake without a phantom calibration', () => {
    const result = absoluteUptake({ roi: roi(60000), acquisition: acquisition(), dose: dose() });
    expect(result.calibrated).toBe(false);
    expect(result.activityMBq).toBeNull();
    expect(result.percentInjectedDose).toBeNull();
    expect(result.message).toMatch(/SPECT convencional não tem SUV/);
  });

  it('still returns counts per second, which are honest within one acquisition', () => {
    const result = absoluteUptake({ roi: roi(60000), acquisition: acquisition(), dose: dose() });
    expect(result.cps).toBeCloseTo(100, 10);
  });

  it('computes %ID once a sensitivity is supplied', () => {
    const result = absoluteUptake({
      roi: roi(60000),
      acquisition: acquisition(),
      dose: dose(),
      sensitivityCpsPerMBq: 100,
    });
    expect(result.calibrated).toBe(true);
    expect(result.activityMBq).toBeCloseTo(1, 10);
    // 800 MBq decayed over 3 h of Tc-99m leaves 565.9 MBq at scan time.
    expect(result.percentInjectedDose).toBeCloseTo(0.1767, 3);
  });

  // The denominator is the dose still present, not what was given hours ago.
  it('decay-corrects the denominator to scan time', () => {
    const early = absoluteUptake({
      roi: roi(60000),
      acquisition: acquisition({ acquiredAt: T0 }),
      dose: dose(),
      sensitivityCpsPerMBq: 100,
    });
    const late = absoluteUptake({
      roi: roi(60000),
      acquisition: acquisition(),
      dose: dose(),
      sensitivityCpsPerMBq: 100,
    });
    expect(late.percentInjectedDose!).toBeGreaterThan(early.percentInjectedDose!);
  });

  it('warns when attenuation correction is missing', () => {
    const result = absoluteUptake({
      roi: roi(60000),
      acquisition: acquisition({ attenuationCorrected: false }),
      dose: dose(),
      sensitivityCpsPerMBq: 100,
    });
    expect(result.warnings.join(' ')).toMatch(/lesão profunda e de uma superficial/);
  });

  it('refuses a %ID when the scan precedes the injection', () => {
    const result = absoluteUptake({
      roi: roi(60000),
      acquisition: acquisition({ acquiredAt: T0 - HOUR }),
      dose: dose(),
      sensitivityCpsPerMBq: 100,
    });
    expect(result.percentInjectedDose).toBeNull();
    expect(result.message).toMatch(/horários inconsistentes/);
  });

  it('reads out message and warnings together', () => {
    const result = absoluteUptake({
      roi: roi(60000),
      acquisition: acquisition({ attenuationCorrected: false }),
      dose: dose(),
      sensitivityCpsPerMBq: 100,
    });
    expect(describeUptake(result)).toMatch(/da dose injetada.*correção de atenuação/s);
  });
});

describe('spectQuantification — target to background', () => {
  it('divides the means', () => {
    expect(targetToBackground(roi(20000, 100), roi(5000, 100)).ratio).toBeCloseTo(4, 10);
  });

  // Unbounded as the background goes to zero: a background over lung produces a
  // spectacular ratio from an unremarkable lesion.
  it('refuses a background ROI too small to divide by', () => {
    const result = targetToBackground(roi(20000, 100), roi(2, 3));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/ilimitada quando o fundo tende a zero/);
  });

  it('refuses a zero-count background', () => {
    expect(targetToBackground(roi(20000, 100), roi(0, 100)).ok).toBe(false);
  });

  it('refuses an empty ROI', () => {
    expect(targetToBackground(roi(20000, 0), roi(5000, 100)).ok).toBe(false);
  });
});

describe('spectQuantification — relative renal function', () => {
  const kidney = (counts: number, backgroundMeanCounts: number) => ({
    counts,
    voxels: 1000,
    backgroundMeanCounts,
  });

  it('splits on background-subtracted counts', () => {
    const split = relativeRenalFunction(kidney(30000, 10), kidney(70000, 10));
    expect(split.leftFraction).toBeCloseTo(0.25, 10);
    expect(split.rightFraction).toBeCloseTo(0.75, 10);
    expect(split.asymmetric).toBe(true);
  });

  // The error direction is towards normal, so nothing invites a second look.
  it('shows that omitting background subtraction pulls the split towards 50/50', () => {
    const corrected = relativeRenalFunction(kidney(30000, 10), kidney(70000, 10));
    const uncorrected = relativeRenalFunction(kidney(30000, 0), kidney(70000, 0));
    expect(uncorrected.leftFraction).toBeCloseTo(0.3, 10);
    expect(Math.abs(uncorrected.leftFraction - 0.5)).toBeLessThan(
      Math.abs(corrected.leftFraction - 0.5)
    );
    expect(uncorrected.warnings.join(' ')).toMatch(/puxa a divisão para 50\/50/);
  });

  // Two equally failing kidneys look exactly like two healthy ones.
  it('always carries the bilateral-disease caveat, even on a normal split', () => {
    const split = relativeRenalFunction(kidney(50000, 5), kidney(50000, 5));
    expect(split.asymmetric).toBe(false);
    expect(split.bilateralWarning).toMatch(/Doença bilateral é invisível aqui/);
    expect(split.bilateralWarning).toMatch(/clearance\/TFG/);
  });

  it('uses the 45–55% band', () => {
    expect(RENAL_SPLIT_NORMAL_LOW).toBe(0.45);
    expect(RENAL_SPLIT_NORMAL_HIGH).toBe(0.55);
    expect(relativeRenalFunction(kidney(46000, 0), kidney(54000, 0)).asymmetric).toBe(false);
    expect(relativeRenalFunction(kidney(44000, 0), kidney(56000, 0)).asymmetric).toBe(true);
  });

  it('never lets a heavy background produce negative counts', () => {
    const split = relativeRenalFunction(kidney(1000, 50), kidney(70000, 10));
    expect(split.leftFraction).toBe(0);
  });

  it('refuses when both kidneys net to zero', () => {
    expect(relativeRenalFunction(kidney(1000, 50), kidney(1000, 50)).ok).toBe(false);
  });
});

describe('spectQuantification — comparing two studies', () => {
  it('accepts matched calibrated acquisitions', () => {
    const a = { ...acquisition(), sensitivityCpsPerMBq: 100 };
    expect(comparable(a, { ...a })).toEqual({ ok: true, reasons: [] });
  });

  it('refuses different tracers', () => {
    const a = { ...acquisition(), sensitivityCpsPerMBq: 100 };
    const b = { ...a, nuclide: 'I-131' };
    expect(comparable(a, b).reasons.join(' ')).toMatch(/Radiofármacos diferentes/);
  });

  it('refuses when only one is attenuation-corrected', () => {
    const a = { ...acquisition(), sensitivityCpsPerMBq: 100 };
    const b = { ...a, attenuationCorrected: false };
    expect(comparable(a, b).ok).toBe(false);
  });

  // The difference between two uncalibrated numbers is technique.
  it('refuses uncalibrated acquisitions and says why', () => {
    const a = acquisition();
    expect(comparable(a, a).reasons.join(' ')).toMatch(/técnica, não fisiológica/);
  });
});
