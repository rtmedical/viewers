import {
  allowedOperations,
  assessSeries,
  COMPLETENESS_LABELS,
  DEFAULT_PROGRESS,
  derivedArtefactWarning,
  describeProgress,
  detectGaps,
  OPERATION_LABELS,
  SeriesArrival,
} from './acquisitionProgress';

const T0 = 1_700_000_000_000;

const arrival = (over: Partial<SeriesArrival> = {}): SeriesArrival => ({
  seriesInstanceUid: '1.2.3',
  modality: 'CT',
  receivedInstances: 100,
  expectedInstances: 100,
  slicePositionsMm: Array.from({ length: 100 }, (_, i) => i * 2),
  firstInstanceAt: T0 - 60_000,
  lastInstanceAt: T0 - 1000,
  ...over,
});

describe('acquisitionProgress — a gap in the middle is worse than a short tail', () => {
  it('finds nothing in an evenly spaced stack', () => {
    expect(detectGaps(Array.from({ length: 20 }, (_, i) => i * 2)).gaps).toEqual([]);
  });

  // The count cannot tell a missing middle from a missing end.
  it('finds a missing slice in the middle', () => {
    const positions = Array.from({ length: 20 }, (_, i) => i * 2).filter(p => p !== 10);
    const result = detectGaps(positions);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toEqual({ fromMm: 8, toMm: 12, missingSlices: 1 });
    expect(result.medianSpacingMm).toBeCloseTo(2, 6);
  });

  it('counts several missing slices in one gap', () => {
    // Removes 10, 12, 14, 16 and 18 -- five slices, and the gap runs 8 to 20.
    const positions = Array.from({ length: 20 }, (_, i) => i * 2).filter(p => p < 10 || p > 18);
    expect(detectGaps(positions).gaps[0].missingSlices).toBe(5);
  });

  // A truncated tail leaves the spacing even, which is exactly why it is the safer failure.
  it('does not flag a truncated series as gapped', () => {
    expect(detectGaps(Array.from({ length: 10 }, (_, i) => i * 2)).gaps).toEqual([]);
  });

  it('needs at least three positions to have a spacing at all', () => {
    expect(detectGaps([0, 2]).gaps).toEqual([]);
  });

  it('honours the gap factor', () => {
    const positions = [0, 2, 4, 6.5, 8.5];
    expect(detectGaps(positions, 1.1).gaps.length).toBeGreaterThan(0);
    expect(detectGaps(positions, 3).gaps).toEqual([]);
  });
});

describe('acquisitionProgress — where a series is in its arrival', () => {
  it('calls a full series complete', () => {
    expect(assessSeries(arrival(), T0).completeness).toBe('complete');
  });

  it('calls a partial series still arriving while instances are landing', () => {
    const result = assessSeries(
      arrival({ receivedInstances: 50, slicePositionsMm: Array.from({ length: 50 }, (_, i) => i * 2) }),
      T0
    );
    expect(result.completeness).toBe('arriving');
  });

  it('calls it stalled once it has gone quiet short of the expected count', () => {
    const result = assessSeries(
      arrival({
        receivedInstances: 50,
        slicePositionsMm: Array.from({ length: 50 }, (_, i) => i * 2),
        lastInstanceAt: T0 - DEFAULT_PROGRESS.quietMs - 10_000,
      }),
      T0
    );
    expect(result.completeness).toBe('stalled');
  });

  // The same shape as a silent channel: elapsed time is not evidence.
  it('cannot tell finished from stalled with no expected count', () => {
    const result = assessSeries(
      arrival({ expectedInstances: undefined, lastInstanceAt: T0 - 120_000 }),
      T0
    );
    expect(result.completeness).toBe('unknown');
    expect(result.warnings.join(' ')).toMatch(/tempo decorrido não é evidência/);
  });

  // An instance rejected on ingestion leaves the sender's count intact.
  it('lets a gap outrank a satisfied instance count', () => {
    const positions = Array.from({ length: 100 }, (_, i) => i * 2).filter(p => p !== 50);
    const result = assessSeries(
      arrival({ receivedInstances: 100, expectedInstances: 99, slicePositionsMm: positions }),
      T0
    );
    expect(result.completeness).toBe('gapped');
  });

  it('names why a missing middle is invisible', () => {
    const positions = Array.from({ length: 100 }, (_, i) => i * 2).filter(p => p !== 50);
    expect(assessSeries(arrival({ slicePositionsMm: positions }), T0).warnings.join(' ')).toMatch(
      /o viewer passa reto, e se a lesão estava ali nada indica que falta alguma coisa/
    );
  });

  it('flags more instances than expected', () => {
    expect(
      assessSeries(arrival({ receivedInstances: 120, expectedInstances: 100 }), T0).warnings.join(' ')
    ).toMatch(/série duplicada ou contagem da origem desatualizada/);
  });
});

describe('acquisitionProgress — looking is allowed, measuring is not', () => {
  // Looking early is the entire feature.
  it('never blocks viewing', () => {
    for (const state of [
      assessSeries(arrival({ receivedInstances: 10 }), T0),
      assessSeries(arrival({ expectedInstances: undefined, lastInstanceAt: T0 - 999_999 }), T0),
    ]) {
      expect(allowedOperations(state).allowed).toContain('view');
    }
  });

  it('unlocks everything once the series is complete', () => {
    const permission = allowedOperations(assessSeries(arrival(), T0));
    expect(permission.allowed).toEqual(['view', 'measure', 'reformat', 'segment', 'report']);
    expect(permission.blocked).toEqual([]);
  });

  // A MIP over half a lung is a perfectly normal-looking MIP.
  it('blocks measuring, reformatting, segmenting and reporting while it arrives', () => {
    const permission = allowedOperations(assessSeries(arrival({ receivedInstances: 40 }), T0));
    expect(permission.blocked.map(b => b.operation)).toEqual(['measure', 'reformat', 'segment', 'report']);
    expect(permission.blocked[0].reason).toMatch(/o que for derivado dela sai com cara de completo/);
  });

  it('gives the gap its own reason', () => {
    const positions = Array.from({ length: 100 }, (_, i) => i * 2).filter(p => p !== 50);
    const permission = allowedOperations(assessSeries(arrival({ slicePositionsMm: positions }), T0));
    expect(permission.blocked[0].reason).toMatch(/herda o buraco sem mostrá-lo/);
  });
});

describe('acquisitionProgress — a derived artefact outlives the state it was made in', () => {
  it('says nothing for a complete series', () => {
    expect(derivedArtefactWarning(assessSeries(arrival(), T0), 'reformat').safe).toBe(true);
  });

  // No rule about the live viewport reaches a saved secondary capture.
  it('demands the mark travel with anything saved', () => {
    const warning = derivedArtefactWarning(assessSeries(arrival({ receivedInstances: 40 }), T0), 'reformat');
    expect(warning.safe).toBe(false);
    expect(warning.message).toMatch(/um MIP salvo de um estudo pela metade é um MIP normal para sempre/);
    expect(warning.message).toMatch(new RegExp(OPERATION_LABELS.reformat.replace(/[()/]/g, '.')));
  });
});

describe('acquisitionProgress — the indicator', () => {
  it('states received, expected and state', () => {
    expect(describeProgress(assessSeries(arrival(), T0))).toBe(
      `100/100 instância(s), ${COMPLETENESS_LABELS.complete}.`
    );
  });

  it('omits the expected count when the source did not give one', () => {
    const line = describeProgress(assessSeries(arrival({ expectedInstances: undefined }), T0));
    expect(line).toMatch(/^100 instância\(s\), chegando\./);
  });
});
