import {
  AXES,
  describeMargin,
  groupSystematicAlert,
  marginInputs,
  MIN_FRACTIONS,
  MIN_PATIENTS,
  patientStatistics,
  populationStatistics,
  PatientShifts,
  standardDeviation,
  VAN_HERK_RANDOM,
  VAN_HERK_SYSTEMATIC,
  vanHerkMargin,
} from './setupStatistics';

/** A patient with a known systematic offset and a known spread. */
const patient = (id: string, offsetMm: number, spread: number[] = [0, 0, 0, 0, 0, 0]): PatientShifts => ({
  patientId: id,
  shiftsMm: spread.map(s => offsetMm + s),
});

const population = (offsets: number[], spread: number[] = [-1, 0, 1, -1, 0, 1]) =>
  offsets.map((o, i) => patient(`p${i}`, o, spread));

describe('setupStatistics — per patient', () => {
  it('splits the mean from the spread', () => {
    const stats = patientStatistics(patient('p1', 3, [-2, 0, 2, -2, 0, 2]));
    expect(stats.meanMm).toBeCloseTo(3, 9);
    expect(stats.sdMm).toBeGreaterThan(1.5);
    expect(stats.fractions).toBe(6);
  });

  it('flags a patient with too few fractions for the SD to mean anything', () => {
    expect(patientStatistics({ patientId: 'p1', shiftsMm: [1, 2] }).underSampled).toBe(true);
    expect(patientStatistics(patient('p1', 0)).underSampled).toBe(false);
    expect(MIN_FRACTIONS).toBe(5);
  });

  it('ignores non-finite shifts', () => {
    expect(patientStatistics({ patientId: 'p1', shiftsMm: [1, NaN, 3] }).fractions).toBe(2);
  });

  it('sample SD uses n-1', () => {
    expect(standardDeviation([2, 4])).toBeCloseTo(Math.SQRT2, 9);
    expect(standardDeviation([5])).toBe(0);
  });
});

describe('setupStatistics — systematic and random are different errors', () => {
  // Sigma is the SD OF THE MEANS; sigma-random is the RMS OF THE SDs. One SD over
  // everything pooled is neither, and it is what a spreadsheet produces by default.
  it('Σ comes from the spread BETWEEN patients, not within them', () => {
    // Same spread in every patient; only the offsets differ.
    const stats = populationStatistics(population([-4, -2, 0, 2, 4]));
    expect(stats.sigmaSystematicMm).toBeCloseTo(standardDeviation([-4, -2, 0, 2, 4]), 6);
  });

  it('σ comes from the spread WITHIN patients, not between them', () => {
    // Every patient has the same offset; only the within-patient spread matters.
    const stats = populationStatistics(population([0, 0, 0, 0, 0], [-2, 0, 2, -2, 0, 2]));
    expect(stats.sigmaSystematicMm).toBeCloseTo(0, 9);
    expect(stats.sigmaRandomMm).toBeGreaterThan(1.5);
  });

  it('and a pooled SD would be neither of them', () => {
    const patients = population([-4, -2, 0, 2, 4], [-2, 0, 2, -2, 0, 2]);
    const stats = populationStatistics(patients);
    const pooled = standardDeviation(patients.flatMap(p => p.shiftsMm));
    expect(pooled).toBeGreaterThan(stats.sigmaSystematicMm);
    expect(pooled).toBeGreaterThan(stats.sigmaRandomMm);
  });

  it('reports the residual group systematic', () => {
    expect(populationStatistics(population([2, 2, 2])).groupMeanMm).toBeCloseTo(2, 9);
  });

  it('excludes under-sampled patients from σ and says so', () => {
    const patients = [
      ...population([0, 0, 0]),
      { patientId: 'short', shiftsMm: [10, -10] },
    ];
    const stats = populationStatistics(patients);
    expect(stats.underSampledPatients).toEqual(['short']);
    expect(stats.warnings.join(' ')).toMatch(/excluídos do cálculo de σ/);
  });

  it('warns below the minimum patient count', () => {
    const stats = populationStatistics(population([0, 1, 2]));
    expect(stats.warnings.join(' ')).toMatch(new RegExp(`abaixo de ${MIN_PATIENTS}`));
  });

  it('is not ok with no data at all', () => {
    expect(populationStatistics([]).ok).toBe(false);
  });
});

describe('setupStatistics — the van Herk recipe', () => {
  it('is 2.5 sigma plus 0.7 sigma-random', () => {
    expect(VAN_HERK_SYSTEMATIC).toBe(2.5);
    expect(VAN_HERK_RANDOM).toBe(0.7);
    const stats = populationStatistics(population([-4, -2, 0, 2, 4], [-2, 0, 2, -2, 0, 2]));
    const margin = vanHerkMargin(stats);
    expect(margin.marginMm).toBeCloseTo(
      2.5 * stats.sigmaSystematicMm + 0.7 * stats.sigmaRandomMm,
      9
    );
  });

  // Systematic error is weighted three and a half times as heavily, and the recipe says so
  // numerically, which argues better than an assertion.
  it('weights systematic error three and a half times as heavily', () => {
    const systematicOnly = vanHerkMargin(
      populationStatistics(population([-3, 0, 3], [0, 0, 0, 0, 0, 0]))
    );
    const randomOnly = vanHerkMargin(
      populationStatistics(population([0, 0, 0], [-3, 0, 3, -3, 0, 3]))
    );
    // Comparable spreads, very different margins.
    expect(systematicOnly.marginMm).toBeGreaterThan(randomOnly.marginMm * 2);
  });

  it('reports the two contributions separately, and the systematic share', () => {
    const margin = vanHerkMargin(
      populationStatistics(population([-4, -2, 0, 2, 4], [-1, 0, 1, -1, 0, 1]))
    );
    expect(margin.systematicContributionMm + margin.randomContributionMm).toBeCloseTo(
      margin.marginMm,
      9
    );
    expect(margin.systematicShare).toBeGreaterThan(0.6);
    expect(describeMargin(margin)).toMatch(/sistemático \d+\.\d+ mm = \d+%/);
  });

  it('carries the sample-size warnings into the margin', () => {
    const margin = vanHerkMargin(populationStatistics(population([0, 1, 2])));
    expect(margin.warnings.join(' ')).toMatch(new RegExp(`abaixo de ${MIN_PATIENTS}`));
    expect(describeMargin(margin)).toMatch(new RegExp(`abaixo de ${MIN_PATIENTS}`));
  });

  it('honours site-specific coefficients', () => {
    const stats = populationStatistics(population([-3, 0, 3]));
    expect(vanHerkMargin(stats, { systematic: 2, random: 0.7 }).marginMm).toBeLessThan(
      vanHerkMargin(stats).marginMm
    );
  });

  it('is not ok when the statistics were not', () => {
    expect(vanHerkMargin(populationStatistics([])).ok).toBe(false);
    expect(describeMargin(vanHerkMargin(populationStatistics([])))).toMatch(/Sem dados/);
  });
});

describe('setupStatistics — a group systematic is a process problem', () => {
  // Absorbing it with margin delivers dose to healthy tissue every fraction of every
  // patient rather than fixing the reference mark once.
  it('flags a non-zero group mean', () => {
    const alert = groupSystematicAlert(populationStatistics(population([3, 3, 3])));
    expect(alert.present).toBe(true);
    expect(alert.message).toMatch(/problema do processo de setup/);
    expect(alert.message).toMatch(/tecido sadio/);
  });

  it('stays quiet when the group is centred', () => {
    expect(groupSystematicAlert(populationStatistics(population([-2, 0, 2]))).present).toBe(false);
  });

  it('honours a custom threshold', () => {
    expect(
      groupSystematicAlert(populationStatistics(population([0.5, 0.5, 0.5])), 0.2).present
    ).toBe(true);
  });

  it('says nothing when there are no statistics', () => {
    expect(groupSystematicAlert(populationStatistics([])).present).toBe(false);
  });
});

describe('setupStatistics — all three axes', () => {
  it('produces a margin per axis and totals the sample', () => {
    const byAxis = {
      vertical: population([-3, 0, 3]),
      lateral: population([-1, 0, 1]),
      longitudinal: population([-5, 0, 5]),
    };
    const report = marginInputs(byAxis);
    expect(AXES.every(a => report.perAxis[a].ok)).toBe(true);
    expect(report.perAxis.longitudinal.marginMm).toBeGreaterThan(report.perAxis.lateral.marginMm);
    expect(report.patients).toBe(3);
    expect(report.fractions).toBe(54);
  });

  it('deduplicates the warnings across axes', () => {
    const byAxis = {
      vertical: population([0, 1, 2]),
      lateral: population([0, 1, 2]),
      longitudinal: population([0, 1, 2]),
    };
    const report = marginInputs(byAxis);
    expect(report.warnings.filter(w => w.includes('abaixo de'))).toHaveLength(1);
  });

  it('survives a missing axis', () => {
    const report = marginInputs({ vertical: population([0, 1]) } as never);
    expect(report.perAxis.lateral.ok).toBe(false);
  });

  it('names the axis in the readout', () => {
    const report = marginInputs({
      vertical: population([-3, 0, 3]),
      lateral: population([-1, 0, 1]),
      longitudinal: population([-5, 0, 5]),
    });
    expect(describeMargin(report.perAxis.vertical, 'vertical')).toMatch(/^vertical: margem/);
  });
});
