import {
  describeProjection,
  phaseDataSourceFromArrays,
  projectOverPhases,
  resolvePhaseIndices,
  TEMPORAL_OPERATIONS,
} from './temporalProjection';

/** Three phases, four voxels. */
const phases = [
  [1, 5, 0, -2],
  [3, 2, 0, -8],
  [2, 9, 0, 4],
];
const source = () => phaseDataSourceFromArrays(phases);

describe('resolvePhaseIndices', () => {
  it('returns every phase when none are requested', () => {
    expect(resolvePhaseIndices(source())).toEqual([0, 1, 2]);
  });

  it('keeps the requested order', () => {
    expect(resolvePhaseIndices(source(), [2, 0])).toEqual([2, 0]);
  });

  it('drops out-of-range and duplicate indices instead of throwing', () => {
    // A slider that overshoots must not be able to crash a projection.
    expect(resolvePhaseIndices(source(), [0, 0, 5, -1, 2])).toEqual([0, 2]);
  });

  it('drops non-numeric requests', () => {
    expect(resolvePhaseIndices(source(), [NaN, 1] as number[])).toEqual([1]);
  });

  it('returns nothing for an empty source', () => {
    expect(resolvePhaseIndices(phaseDataSourceFromArrays([]))).toEqual([]);
  });
});

describe('projectOverPhases', () => {
  it('MIP takes the maximum across phases', () => {
    // This is the operation Cornerstone3D's DynamicOperatorType does not have,
    // and the one RT planning needs for the ITV.
    expect([...projectOverPhases(source(), 'MIP')]).toEqual([3, 9, 0, 4]);
  });

  it('MinIP takes the minimum across phases', () => {
    expect([...projectOverPhases(source(), 'MinIP')]).toEqual([1, 2, 0, -8]);
  });

  it('SUM adds across phases', () => {
    expect([...projectOverPhases(source(), 'SUM')]).toEqual([6, 16, 0, -6]);
  });

  it('AvgIP averages across phases', () => {
    // Float32Array, so 16/3 is compared with tolerance rather than structurally.
    const result = [...projectOverPhases(source(), 'AvgIP')];
    expect(result[0]).toBe(2);
    expect(result[1]).toBeCloseTo(16 / 3, 5);
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(-2);
  });

  it('handles negative values without treating 0 as a floor', () => {
    // A naive implementation that seeds the accumulator at 0 gets MIP wrong for
    // all-negative voxels. HU values are routinely negative.
    const negative = phaseDataSourceFromArrays([[-10, -5], [-20, -1]]);
    expect([...projectOverPhases(negative, 'MIP')]).toEqual([-10, -1]);
    expect([...projectOverPhases(negative, 'MinIP')]).toEqual([-20, -5]);
  });

  it('projects only the selected phases', () => {
    expect([...projectOverPhases(source(), 'MIP', { phaseIndices: [0, 1] })]).toEqual([3, 5, 0, -2]);
    expect([...projectOverPhases(source(), 'MinIP', { phaseIndices: [2] })]).toEqual([2, 9, 0, 4]);
  });

  it('skips non-finite samples rather than propagating them', () => {
    // One NaN in one phase must not blank the voxel in the projection.
    const withNaN = phaseDataSourceFromArrays([
      [1, NaN, 5],
      [NaN, 4, 7],
    ]);
    expect([...projectOverPhases(withNaN, 'MIP')]).toEqual([1, 4, 7]);
    expect([...projectOverPhases(withNaN, 'AvgIP')]).toEqual([1, 4, 6]);
  });

  it('resolves a voxel with no finite sample to zero', () => {
    const allNaN = phaseDataSourceFromArrays([
      [NaN, 2],
      [NaN, 4],
    ]);
    expect([...projectOverPhases(allNaN, 'MIP')]).toEqual([0, 4]);
  });

  it('skips a phase that fails to load', () => {
    const flaky = {
      phaseCount: 3,
      voxelCount: 2,
      getPhaseData: (i: number) => (i === 1 ? undefined : [i + 1, i + 1]),
    };
    // Phases 0 and 2 contribute; phase 1 is absent, not fatal.
    expect([...projectOverPhases(flaky, 'MIP')]).toEqual([3, 3]);
  });

  it('writes into a supplied buffer', () => {
    const output = new Float32Array(4);
    const result = projectOverPhases(source(), 'MIP', { output });
    expect(result).toBe(output);
    expect([...output]).toEqual([3, 9, 0, 4]);
  });

  it('does not leak values from a previous projection when reusing a buffer', () => {
    const output = new Float32Array([99, 99]);
    const allNaN = phaseDataSourceFromArrays([
      [NaN, 1],
      [NaN, 2],
    ]);
    projectOverPhases(allNaN, 'MIP', { output });
    expect([...output]).toEqual([0, 2]);
  });

  it('tolerates a phase shorter than voxelCount', () => {
    const ragged = {
      phaseCount: 2,
      voxelCount: 3,
      getPhaseData: (i: number) => (i === 0 ? [1, 2, 3] : [9]),
    };
    expect([...projectOverPhases(ragged, 'MIP')]).toEqual([9, 2, 3]);
  });

  it('throws when no phases are selected', () => {
    expect(() => projectOverPhases(source(), 'MIP', { phaseIndices: [] })).toThrow(RangeError);
    expect(() => projectOverPhases(phaseDataSourceFromArrays([]), 'MIP')).toThrow(RangeError);
  });

  it('throws when the volume has no voxels', () => {
    expect(() =>
      projectOverPhases({ phaseCount: 2, voxelCount: 0, getPhaseData: () => [] }, 'MIP')
    ).toThrow(RangeError);
  });

  it('throws when the supplied buffer is too small', () => {
    expect(() => projectOverPhases(source(), 'MIP', { output: new Float32Array(2) })).toThrow(
      /needs 4/
    );
  });

  it('returns a Float32Array of the right length for every operation', () => {
    for (const operation of TEMPORAL_OPERATIONS) {
      const result = projectOverPhases(source(), operation);
      expect(result).toBeInstanceOf(Float32Array);
      expect(result).toHaveLength(4);
    }
  });
});

describe('describeProjection', () => {
  it('collapses a contiguous run into a range', () => {
    expect(describeProjection('MIP', [0, 1, 2, 3])).toBe('MIP over phases 1-4');
  });

  it('lists a non-contiguous selection', () => {
    expect(describeProjection('MinIP', [0, 2])).toBe('MinIP over phases 1, 3');
  });

  it('uses phase labels when it has them', () => {
    expect(describeProjection('MIP', [0, 1, 2], ['0%', '10%', '20%'])).toBe(
      'MIP over phases 0%-20%'
    );
  });

  it('drops the parenthetical from the operation label', () => {
    expect(describeProjection('AvgIP', [0, 1])).toBe('Average over phases 1, 2');
  });

  it('handles an empty selection', () => {
    expect(describeProjection('MIP', [])).toBe('MIP');
  });
});
