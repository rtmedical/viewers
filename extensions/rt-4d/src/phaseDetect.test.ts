import {
  describeGating,
  detectGating,
  isPhaseSetIncomplete,
  parseCardiacTechnique,
  parseRespiratoryLabel,
  PhaseInstanceLike,
} from './phaseDetect';

/** N instances sharing the given metadata. */
const rep = (count: number, meta: PhaseInstanceLike): PhaseInstanceLike[] =>
  Array.from({ length: count }, () => ({ ...meta }));

describe('parseCardiacTechnique', () => {
  it.each([
    ['PROSPECTIVE', 'prospective'],
    ['RETROSPECTIVE', 'retrospective'],
    ['REAL_TIME', 'realtime'],
    ['TRIGGERED', 'triggered'],
    ['NONE', 'none'],
    ['  prospective  ', 'prospective'],
  ])('reads %s', (raw, expected) => {
    expect(parseCardiacTechnique(raw)).toBe(expected);
  });

  it('marks an unrecognised value as unknown, not undefined', () => {
    // Undefined means "tag absent"; a present-but-odd value must stay distinguishable.
    expect(parseCardiacTechnique('SOMETHING_ELSE')).toBe('unknown');
  });

  it('returns undefined when the tag is absent', () => {
    expect(parseCardiacTechnique(undefined)).toBeUndefined();
    expect(parseCardiacTechnique('')).toBeUndefined();
  });
});

describe('parseRespiratoryLabel', () => {
  it.each([
    ['CT 4D 0%', 0, undefined],
    ['CT 4D 50%', 50, undefined],
    ['Phase 30% EX', 30, 'EX'],
    ['4D 100% IN', 100, 'IN'],
    ['recon 10 % exp', 10, 'EX'],
  ])('reads %s', (description, percent, marker) => {
    expect(parseRespiratoryLabel(description)).toEqual(
      marker ? { percent, marker } : { percent }
    );
  });

  it('ignores numbers that are not a percentage', () => {
    expect(parseRespiratoryLabel('T1 100 slices')).toBeUndefined();
    expect(parseRespiratoryLabel('AX CT 1.25mm')).toBeUndefined();
  });

  it('rejects an out-of-range percentage', () => {
    expect(parseRespiratoryLabel('recon 300%')).toBeUndefined();
  });

  it('does not pick up a marker from inside a longer word', () => {
    // "EXTREMITY" must not read as expiration.
    expect(parseRespiratoryLabel('40% EXTREMITY')).toEqual({ percent: 40 });
  });

  it('handles absent input', () => {
    expect(parseRespiratoryLabel(undefined)).toBeUndefined();
    expect(parseRespiratoryLabel('')).toBeUndefined();
  });
});

describe('detectGating — respiratory', () => {
  it('groups by NominalPercentageOfRespiratoryPhase', () => {
    const info = detectGating([
      ...rep(3, { NominalPercentageOfRespiratoryPhase: 0 }),
      ...rep(3, { NominalPercentageOfRespiratoryPhase: 50 }),
      ...rep(3, { NominalPercentageOfRespiratoryPhase: 20 }),
    ]);

    expect(info.isGated).toBe(true);
    expect(info.kind).toBe('respiratory');
    expect(info.sourceTag).toBe('NominalPercentageOfRespiratoryPhase');
    // Ordered by percent, not by encounter order.
    expect(info.phases.map(p => p.label)).toEqual(['0%', '20%', '50%']);
    expect(info.phases.map(p => p.instanceCount)).toEqual([3, 3, 3]);
    expect(info.phases[1].percent).toBe(20);
    expect(info.phases.map(p => p.index)).toEqual([0, 1, 2]);
  });

  it('prefers the explicit tag over the SeriesDescription', () => {
    const info = detectGating([
      ...rep(2, { NominalPercentageOfRespiratoryPhase: 0, SeriesDescription: '90% EX' }),
      ...rep(2, { NominalPercentageOfRespiratoryPhase: 50, SeriesDescription: '10% IN' }),
    ]);
    expect(info.sourceTag).toBe('NominalPercentageOfRespiratoryPhase');
    expect(info.phases.map(p => p.label)).toEqual(['0%', '50%']);
  });

  it('falls back to the 4D-CT SeriesDescription convention', () => {
    const info = detectGating([
      ...rep(2, { SeriesDescription: 'CT 4D 0% IN' }),
      ...rep(2, { SeriesDescription: 'CT 4D 50% EX' }),
      ...rep(2, { SeriesDescription: 'CT 4D 20%' }),
    ]);

    expect(info.isGated).toBe(true);
    expect(info.kind).toBe('respiratory');
    expect(info.sourceTag).toBe('SeriesDescription');
    expect(info.phases.map(p => p.label)).toEqual(['0% IN', '20%', '50% EX']);
  });

  it('reports the respiratory signal source when present', () => {
    const info = detectGating([
      ...rep(2, { NominalPercentageOfRespiratoryPhase: 0, RespiratorySignalSource: 'BELT' }),
      ...rep(2, { NominalPercentageOfRespiratoryPhase: 50 }),
    ]);
    expect(info.respiratorySignalSource).toBe('BELT');
  });

  it('formats a fractional percent without noise', () => {
    const info = detectGating([
      ...rep(1, { NominalPercentageOfRespiratoryPhase: 12.5 }),
      ...rep(1, { NominalPercentageOfRespiratoryPhase: 75 }),
    ]);
    expect(info.phases.map(p => p.label)).toEqual(['12.5%', '75%']);
  });
});

describe('detectGating — cardiac', () => {
  const cardiac = { CardiacSynchronizationTechnique: 'RETROSPECTIVE', HeartRate: 60 };

  it('groups by TriggerTime and reports the technique', () => {
    const info = detectGating([
      ...rep(2, { ...cardiac, TriggerTime: 0 }),
      ...rep(2, { ...cardiac, TriggerTime: 500 }),
      ...rep(2, { ...cardiac, TriggerTime: 250 }),
    ]);

    expect(info.isGated).toBe(true);
    expect(info.kind).toBe('cardiac');
    expect(info.sourceTag).toBe('TriggerTime');
    expect(info.cardiacTechnique).toBe('retrospective');
    expect(info.phases.map(p => p.triggerTimeMs)).toEqual([0, 250, 500]);
  });

  it('expresses the phase as a percent of the RR interval from HeartRate', () => {
    // 60 bpm => RR = 1000 ms, so 250 ms is 25% through the cycle.
    const info = detectGating([
      ...rep(1, { ...cardiac, TriggerTime: 0 }),
      ...rep(1, { ...cardiac, TriggerTime: 250 }),
    ]);
    expect(info.phases[1].percent).toBeCloseTo(25, 6);
    expect(info.phases[1].label).toBe('25% (250 ms)');
  });

  it('prefers CardiacRRIntervalSpecified over HeartRate', () => {
    const meta = { CardiacSynchronizationTechnique: 'PROSPECTIVE', HeartRate: 60, CardiacRRIntervalSpecified: 800 };
    const info = detectGating([
      ...rep(1, { ...meta, TriggerTime: 0 }),
      ...rep(1, { ...meta, TriggerTime: 400 }),
    ]);
    expect(info.cardiacTechnique).toBe('prospective');
    expect(info.phases[1].percent).toBeCloseTo(50, 6);
  });

  it('falls back to milliseconds when the RR interval is unknown', () => {
    const meta = { CardiacNumberOfImages: 2 };
    const info = detectGating([
      ...rep(1, { ...meta, TriggerTime: 0 }),
      ...rep(1, { ...meta, TriggerTime: 320 }),
    ]);
    expect(info.phases[1].label).toBe('320 ms');
    expect(info.phases[1].percent).toBeUndefined();
  });

  it('does not invent cardiac phases from TriggerTime alone', () => {
    // TriggerTime also varies in plain multi-echo MR. Without a cardiac tag this
    // must not be reported as gating.
    const info = detectGating([{ TriggerTime: 0 }, { TriggerTime: 100 }, { TriggerTime: 200 }]);
    expect(info.isGated).toBe(false);
    expect(info.kind).toBeNull();
  });
});

describe('detectGating — generic temporal', () => {
  it('groups by TemporalPositionIndex', () => {
    const info = detectGating([
      ...rep(2, { TemporalPositionIndex: 1 }),
      ...rep(2, { TemporalPositionIndex: 3 }),
      ...rep(2, { TemporalPositionIndex: 2 }),
    ]);
    expect(info.kind).toBe('temporal');
    expect(info.sourceTag).toBe('TemporalPositionIndex');
    expect(info.phases.map(p => p.label)).toEqual(['Phase 1', 'Phase 2', 'Phase 3']);
  });

  it('falls back to TemporalPositionIdentifier', () => {
    const info = detectGating([
      ...rep(1, { TemporalPositionIdentifier: 1 }),
      ...rep(1, { TemporalPositionIdentifier: 2 }),
    ]);
    expect(info.sourceTag).toBe('TemporalPositionIdentifier');
  });

  it('ranks respiratory above generic temporal', () => {
    const info = detectGating([
      ...rep(1, { NominalPercentageOfRespiratoryPhase: 0, TemporalPositionIndex: 1 }),
      ...rep(1, { NominalPercentageOfRespiratoryPhase: 50, TemporalPositionIndex: 2 }),
    ]);
    expect(info.kind).toBe('respiratory');
  });
});

describe('detectGating — guards', () => {
  it('does not call a single phase gating', () => {
    const info = detectGating(rep(20, { NominalPercentageOfRespiratoryPhase: 0 }));
    expect(info.isGated).toBe(false);
    expect(info.phases).toEqual([]);
  });

  it('handles empty and nullish input', () => {
    expect(detectGating([]).isGated).toBe(false);
    expect(detectGating(undefined as never).isGated).toBe(false);
    expect(detectGating([null, undefined] as never).isGated).toBe(false);
  });

  it('ignores instances with no usable tag', () => {
    const info = detectGating([
      ...rep(2, { NominalPercentageOfRespiratoryPhase: 0 }),
      ...rep(2, { NominalPercentageOfRespiratoryPhase: 50 }),
      ...rep(5, { SeriesDescription: 'Localizer' }),
    ]);
    expect(info.phases).toHaveLength(2);
  });

  it('tolerates numeric strings, as DICOM JSON often delivers them', () => {
    const info = detectGating([
      ...rep(1, { NominalPercentageOfRespiratoryPhase: '0' }),
      ...rep(1, { NominalPercentageOfRespiratoryPhase: '50' }),
    ]);
    expect(info.isGated).toBe(true);
    expect(info.phases.map(p => p.percent)).toEqual([0, 50]);
  });
});

describe('isPhaseSetIncomplete', () => {
  it('flags a 4D-CT that is missing phases', () => {
    const info = detectGating([
      ...rep(1, { NominalPercentageOfRespiratoryPhase: 0, NumberOfTemporalPositions: 10 }),
      ...rep(1, { NominalPercentageOfRespiratoryPhase: 50, NumberOfTemporalPositions: 10 }),
    ]);
    expect(info.expectedPhaseCount).toBe(10);
    expect(isPhaseSetIncomplete(info)).toBe(true);
  });

  it('does not flag a complete set', () => {
    const info = detectGating([
      ...rep(1, { NominalPercentageOfRespiratoryPhase: 0, NumberOfTemporalPositions: 2 }),
      ...rep(1, { NominalPercentageOfRespiratoryPhase: 50, NumberOfTemporalPositions: 2 }),
    ]);
    expect(isPhaseSetIncomplete(info)).toBe(false);
  });

  it('does not flag when the expected count is unknown', () => {
    const info = detectGating([
      ...rep(1, { NominalPercentageOfRespiratoryPhase: 0 }),
      ...rep(1, { NominalPercentageOfRespiratoryPhase: 50 }),
    ]);
    expect(info.expectedPhaseCount).toBeUndefined();
    expect(isPhaseSetIncomplete(info)).toBe(false);
  });

  it('uses CardiacNumberOfImages for cardiac series', () => {
    const meta = { CardiacSynchronizationTechnique: 'PROSPECTIVE', CardiacNumberOfImages: 20 };
    const info = detectGating([
      ...rep(1, { ...meta, TriggerTime: 0 }),
      ...rep(1, { ...meta, TriggerTime: 100 }),
    ]);
    expect(info.expectedPhaseCount).toBe(20);
    expect(isPhaseSetIncomplete(info)).toBe(true);
  });
});

describe('describeGating', () => {
  it('describes a respiratory set', () => {
    const info = detectGating([
      ...rep(1, { NominalPercentageOfRespiratoryPhase: 0 }),
      ...rep(1, { NominalPercentageOfRespiratoryPhase: 50 }),
    ]);
    expect(describeGating(info)).toBe('Respiratory · 2 phases');
  });

  it('names the cardiac technique', () => {
    const meta = { CardiacSynchronizationTechnique: 'RETROSPECTIVE' };
    const info = detectGating([
      ...rep(1, { ...meta, TriggerTime: 0 }),
      ...rep(1, { ...meta, TriggerTime: 100 }),
    ]);
    expect(describeGating(info)).toBe('Cardiac (retrospective) · 2 phases');
  });

  it('says so when the set is incomplete', () => {
    const info = detectGating([
      ...rep(1, { NominalPercentageOfRespiratoryPhase: 0, NumberOfTemporalPositions: 10 }),
      ...rep(1, { NominalPercentageOfRespiratoryPhase: 50, NumberOfTemporalPositions: 10 }),
    ]);
    expect(describeGating(info)).toContain('incomplete (expected 10)');
  });

  it('describes an ungated series', () => {
    expect(describeGating(detectGating([]))).toBe('Not gated');
  });
});
