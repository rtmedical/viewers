import {
  bodySurfaceAreaM2,
  compareUptakeTimes,
  describeSuv,
  F18_HALF_LIFE_MIN,
  leanBodyMassKg,
  netDoseAtScan,
  suvBodyWeight,
  suvLeanBodyMass,
  UPTAKE_TIME_TOLERANCE_MIN,
} from './suv';

const PATIENT = { weightKg: 70, heightCm: 175, sex: 'male' as const };
const DOSE = { injectedDoseMbq: 370, uptakeTimeMin: 60 };

describe('suv — dose at scan time', () => {
  it('decays by one half-life over the half-life', () => {
    const dose = netDoseAtScan({ injectedDoseMbq: 400, uptakeTimeMin: F18_HALF_LIFE_MIN });
    expect(dose).toBeCloseTo(200, 6);
  });

  // The residual never entered the patient and never decayed in them.
  it('subtracts the syringe residual BEFORE decaying', () => {
    const withResidual = netDoseAtScan({
      injectedDoseMbq: 400,
      residualDoseMbq: 40,
      uptakeTimeMin: F18_HALF_LIFE_MIN,
    });
    expect(withResidual).toBeCloseTo(180, 6);
  });

  // A 5% residual is a 5% error in every SUV in the study, in the same direction.
  it('a 5% residual moves every SUV by 5%', () => {
    const clean = suvBodyWeight(10000, PATIENT, DOSE).value;
    const dirty = suvBodyWeight(10000, PATIENT, { ...DOSE, residualDoseMbq: 18.5 }).value;
    expect(dirty / clean).toBeCloseTo(1 / 0.95, 3);
  });

  it('is zero for missing or nonsense input', () => {
    expect(netDoseAtScan({ injectedDoseMbq: 0, uptakeTimeMin: 60 })).toBe(0);
    expect(netDoseAtScan({ injectedDoseMbq: 370, uptakeTimeMin: NaN })).toBe(0);
  });
});

describe('suv — body weight', () => {
  it('is dimensionless and near 1 for uniform distribution', () => {
    // 370 MBq at 60 min decays to ~250 MBq; spread through 70 kg that is ~3.6 kBq/mL.
    const concentration = (netDoseAtScan(DOSE) * 1e6) / (70 * 1000);
    expect(suvBodyWeight(concentration, PATIENT, DOSE).value).toBeCloseTo(1, 6);
  });

  it('scales linearly with the measured concentration', () => {
    const a = suvBodyWeight(5000, PATIENT, DOSE).value;
    const b = suvBodyWeight(10000, PATIENT, DOSE).value;
    expect(b / a).toBeCloseTo(2, 9);
  });

  it('refuses without a dose or a weight', () => {
    expect(suvBodyWeight(5000, PATIENT, { injectedDoseMbq: 0, uptakeTimeMin: 60 }).failure).toBe(
      'missingDose'
    );
    expect(suvBodyWeight(5000, { weightKg: 0 }, DOSE).failure).toBe('missingWeight');
  });

  it('warns when the uptake time is outside the reference window', () => {
    expect(suvBodyWeight(5000, PATIENT, { ...DOSE, uptakeTimeMin: 100 }).warnings[0]).toMatch(
      /fora da janela/
    );
    expect(suvBodyWeight(5000, PATIENT, DOSE).warnings).toEqual([]);
  });
});

describe('suv — lean body mass', () => {
  it('is less than total body weight', () => {
    expect(leanBodyMassKg(PATIENT)).toBeLessThan(PATIENT.weightKg);
    expect(leanBodyMassKg(PATIENT)).toBeGreaterThan(40);
  });

  it('is lower for a female patient of the same size', () => {
    expect(leanBodyMassKg({ ...PATIENT, sex: 'female' })).toBeLessThan(leanBodyMassKg(PATIENT));
  });

  // James decreases LBM as an obese patient gains weight, which is an SUL that rises for a
  // purely mechanical reason in exactly the population SUL exists to fix.
  it('rises monotonically with weight, unlike the James formula', () => {
    const weights = [60, 80, 100, 130, 160];
    const lbms = weights.map(weightKg => leanBodyMassKg({ ...PATIENT, weightKg }));
    for (let i = 1; i < lbms.length; i++) {
      expect(lbms[i]).toBeGreaterThan(lbms[i - 1]);
    }
  });

  it('SUL is higher than SUV for the same measurement, since LBM is smaller', () => {
    const suv = suvBodyWeight(10000, PATIENT, DOSE).value;
    const sul = suvLeanBodyMass(10000, PATIENT, DOSE).value;
    expect(sul).toBeLessThan(suv);
    expect(sul / suv).toBeCloseTo(leanBodyMassKg(PATIENT) / PATIENT.weightKg, 9);
  });

  // A value silently computed as SUVbw and labelled SUL is the exact confusion this
  // distinction exists to prevent.
  it('REFUSES rather than falling back to body weight', () => {
    expect(suvLeanBodyMass(10000, { weightKg: 70 }, DOSE).failure).toBe('missingHeight');
    expect(suvLeanBodyMass(10000, { weightKg: 70, heightCm: 175 }, DOSE).failure).toBe(
      'missingSex'
    );
  });

  it('labels which normalisation it used', () => {
    expect(suvLeanBodyMass(10000, PATIENT, DOSE).kind).toBe('leanBodyMass');
    expect(suvBodyWeight(10000, PATIENT, DOSE).kind).toBe('bodyWeight');
    expect(describeSuv(suvLeanBodyMass(10000, PATIENT, DOSE))).toMatch(/^SUL /);
    expect(describeSuv(suvBodyWeight(10000, PATIENT, DOSE))).toMatch(/^SUV /);
  });

  it('body surface area is available too', () => {
    expect(bodySurfaceAreaM2(PATIENT)).toBeGreaterThan(1.5);
    expect(bodySurfaceAreaM2({ weightKg: 0 })).toBe(0);
  });
});

describe('suv — the weight-gain trap SUL exists to fix', () => {
  // A patient who gains 8 kg during chemotherapy shows an SUVbw rise with no change in the
  // tumour. The lesion concentration is identical in both scans.
  const before = { weightKg: 70, heightCm: 175, sex: 'male' as const };
  const after = { ...before, weightKg: 78 };

  it('SUVbw rises with the weight even though nothing changed', () => {
    const a = suvBodyWeight(10000, before, DOSE).value;
    const b = suvBodyWeight(10000, after, DOSE).value;
    expect(b / a).toBeCloseTo(78 / 70, 9);
    expect(b / a).toBeGreaterThan(1.1);
  });

  it('SUL absorbs about half of the spurious change', () => {
    const a = suvLeanBodyMass(10000, before, DOSE).value;
    const b = suvLeanBodyMass(10000, after, DOSE).value;
    const suvExcess = 78 / 70 - 1;
    const sulExcess = b / a - 1;
    expect(sulExcess).toBeLessThan(suvExcess);
    // Roughly half: the gain is mostly fat, and LBM barely notices it.
    expect(sulExcess).toBeLessThan(0.7 * suvExcess);
  });
});

describe('suv — uptake time comparability', () => {
  it('accepts scans within the tolerance', () => {
    expect(compareUptakeTimes(60, 70).comparable).toBe(true);
    expect(compareUptakeTimes(60, 60 + UPTAKE_TIME_TOLERANCE_MIN).comparable).toBe(true);
  });

  // The failure that changes management most often, and it is completely invisible in the
  // images.
  it('REFUSES scans further apart, and says why', () => {
    const result = compareUptakeTimes(60, 90);
    expect(result.comparable).toBe(false);
    expect(result.differenceMin).toBe(30);
    expect(result.message).toMatch(/do relógio e não da doença/);
  });

  it('refuses when either time is missing', () => {
    expect(compareUptakeTimes(60, NaN).comparable).toBe(false);
    expect(compareUptakeTimes(NaN, 60).message).toMatch(/não registrado/);
  });

  it('honours a custom tolerance', () => {
    expect(compareUptakeTimes(60, 65, 3).comparable).toBe(false);
  });
});
