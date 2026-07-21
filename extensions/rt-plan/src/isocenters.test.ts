import {
  collectIsocenters,
  formatIsocenter,
  ISOCENTER_TOLERANCE_MM,
} from './isocenters';
import { RtPlan, RtPlanBeam } from './rtPlanParser';

const planWith = (beams: RtPlanBeam[]): RtPlan => ({
  prescriptions: [],
  fractionGroups: [],
  beams,
});

describe('collectIsocenters', () => {
  it('returns one entry per unique isocenter with beam identity and key', () => {
    const entries = collectIsocenters(
      planWith([
        { number: 1, name: 'AP', isocenter: [-12.5, 34, -105.1] },
        { number: 2, name: 'PA', isocenter: [10, 0, 55] },
      ])
    );
    expect(entries).toEqual([
      {
        beamNumber: 1,
        beamName: 'AP',
        isocenter: [-12.5, 34, -105.1],
        key: '-12.50,34.00,-105.10',
        beamNumbers: [1],
      },
      {
        beamNumber: 2,
        beamName: 'PA',
        isocenter: [10, 0, 55],
        key: '10.00,0.00,55.00',
        beamNumbers: [2],
      },
    ]);
  });

  it('dedupes beams sharing an isocenter within the 0.01 mm tolerance', () => {
    const entries = collectIsocenters(
      planWith([
        { number: 1, name: 'AP', isocenter: [1, 2, 3] },
        { number: 2, name: 'PA', isocenter: [1 + ISOCENTER_TOLERANCE_MM, 2, 3 - 0.005] },
        { number: 3, name: 'LAT', isocenter: [1, 2, 3.02] }, // beyond tolerance
      ])
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ beamNumber: 1, beamNumbers: [1, 2] });
    expect(entries[1]).toMatchObject({ beamNumber: 3, beamNumbers: [3] });
  });

  it('orders entries by lowest referencing beam number', () => {
    const entries = collectIsocenters(
      planWith([
        { number: 5, name: 'late', isocenter: [9, 9, 9] },
        { number: 2, name: 'early', isocenter: [0, 0, 0] },
      ])
    );
    expect(entries.map(e => e.beamNumber)).toEqual([2, 5]);
  });

  it('skips beams without a finite 3D isocenter and handles empty/missing plans', () => {
    const entries = collectIsocenters(
      planWith([
        { number: 1, name: 'no iso' },
        { number: 2, name: 'bad iso', isocenter: [NaN, 0, 0] },
        { number: 3, name: 'ok', isocenter: [4, 5, 6] },
      ])
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].beamNumber).toBe(3);
    expect(collectIsocenters(planWith([]))).toEqual([]);
    expect(collectIsocenters(undefined)).toEqual([]);
    expect(collectIsocenters(null)).toEqual([]);
  });

  it('sorts unnumbered beams last and never emits a negative-zero key', () => {
    const entries = collectIsocenters(
      planWith([
        { name: 'setup', isocenter: [7, 7, 7] },
        { number: 1, name: 'AP', isocenter: [-0.001, 2, 3] },
      ])
    );
    expect(entries.map(e => e.beamNumber)).toEqual([1, undefined]);
    expect(entries[0].key).toBe('0.00,2.00,3.00');
    expect(entries[1].beamNumbers).toEqual([]);
  });
});

describe('formatIsocenter', () => {
  it("renders 'x, y, z mm' with one decimal place", () => {
    expect(formatIsocenter([-12.55, 34, -105.14])).toBe('-12.6, 34.0, -105.1 mm');
  });

  it('normalizes negative zero', () => {
    expect(formatIsocenter([-0.04, 0, 12])).toBe('0.0, 0.0, 12.0 mm');
  });
});
