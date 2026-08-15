import {
  ACTION_LEVEL_MM,
  approveCorrection,
  couchShifts,
  CouchShiftInput,
  decomposeRotation,
  describeCorrection,
  detectCbct,
  SEVERITY_LABELS,
  TOLERANCE_LIMIT_MM,
} from './couchShifts';

/** Row-major 4x4 with a pure translation in DICOM patient coordinates. */
const translation = (x: number, y: number, z: number) =>
  [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];

/** Rotation about the patient z axis (yaw), degrees. */
const yaw = (deg: number) => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
};

const shifts = (over: Partial<CouchShiftInput> = {}) =>
  couchShifts({ matrix: translation(0, 0, 0), patientPosition: 'HFS', ...over });

describe('couchShifts — CBCT detection', () => {
  it('recognises a series described as CBCT', () => {
    const result = detectCbct({ seriesInstanceUid: '1', seriesDescription: 'kV CBCT', modality: 'CT' });
    expect(result.isCbct).toBe(true);
    expect(result.matchedBy).toContain('SeriesDescription');
  });

  it('recognises it from the protocol name', () => {
    expect(
      detectCbct({ seriesInstanceUid: '1', protocolName: 'Pelvis CBCT', modality: 'CT' }).isCbct
    ).toBe(true);
  });

  // Modality is checked first and hard.
  it('refuses anything that is not stored as CT', () => {
    expect(
      detectCbct({ seriesInstanceUid: '1', seriesDescription: 'CBCT', modality: 'MR' }).isCbct
    ).toBe(false);
  });

  // A Varian diagnostic CT is still a diagnostic CT.
  it('never matches on manufacturer alone', () => {
    const result = detectCbct({
      seriesInstanceUid: '1',
      manufacturer: 'Varian Medical Systems',
      seriesDescription: 'ABDOME COM CONTRASTE',
      modality: 'CT',
    });
    expect(result.isCbct).toBe(false);
  });

  it('raises confidence when several rules agree', () => {
    const result = detectCbct({
      seriesInstanceUid: '1',
      seriesDescription: 'kV CBCT',
      protocolName: 'CBCT Pelvis',
      manufacturer: 'Varian Medical Systems',
      modality: 'CT',
    });
    expect(result.confidence).toBe('high');
    expect(result.matchedBy.length).toBeGreaterThan(2);
  });

  // The failure mode is a diagnostic CT treated as a setup image; the reader needs to see
  // why the viewer thought so.
  it('always reports which rule matched', () => {
    const result = detectCbct({ seriesInstanceUid: '1', seriesDescription: 'CBCT', modality: 'CT' });
    expect(result.matchedBy).toHaveLength(1);
    expect(result.confidence).toBe('low');
  });
});

describe('couchShifts — the patient position is required', () => {
  // Assuming head-first supine is right most of the time and catastrophically wrong the
  // rest, and the wrong times are the setups that get least testing.
  it('REFUSES without it', () => {
    const result = couchShifts({ matrix: translation(1, 2, 3), patientPosition: undefined as never });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/ao dobro do erro/);
  });

  it('refuses an unsupported position rather than guessing', () => {
    expect(couchShifts({ matrix: translation(1, 2, 3), patientPosition: 'HFDR' }).ok).toBe(false);
  });

  it('flips the lateral sign between supine and prone', () => {
    const supine = shifts({ matrix: translation(5, 0, 0), patientPosition: 'HFS' });
    const prone = shifts({ matrix: translation(5, 0, 0), patientPosition: 'HFP' });
    expect(supine.displacement.lateralMm).toBeCloseTo(-prone.displacement.lateralMm, 9);
  });

  it('flips the longitudinal sign between head-first and feet-first', () => {
    const headFirst = shifts({ matrix: translation(0, 0, 5), patientPosition: 'HFS' });
    const feetFirst = shifts({ matrix: translation(0, 0, 5), patientPosition: 'FFS' });
    expect(headFirst.displacement.longitudinalMm).toBeCloseTo(
      -feetFirst.displacement.longitudinalMm,
      9
    );
  });

  it('carries the position into the result', () => {
    expect(shifts({ patientPosition: 'FFP' }).patientPosition).toBe('FFP');
  });
});

describe('couchShifts — the correction is opposite to the displacement', () => {
  // Both numbers are the same magnitude, which is what makes the mix-up invisible.
  it('negates every axis', () => {
    const result = shifts({ matrix: translation(4, -3, 2) });
    expect(result.correction.lateralMm).toBeCloseTo(-result.displacement.lateralMm, 9);
    expect(result.correction.verticalMm).toBeCloseTo(-result.displacement.verticalMm, 9);
    expect(result.correction.longitudinalMm).toBeCloseTo(-result.displacement.longitudinalMm, 9);
  });

  it('prints the CORRECTION, labelled as a couch move', () => {
    const result = shifts({ matrix: translation(0, 0, 4) });
    // HFS: +z superior maps to +longitudinal, so the couch move is negative.
    expect(result.displacement.longitudinalMm).toBeCloseTo(4, 9);
    expect(describeCorrection(result)).toMatch(/Mover mesa/);
    expect(describeCorrection(result)).toMatch(/longitudinal -4\.0 mm/);
  });

  it('a zero registration produces a zero move', () => {
    const result = shifts();
    expect(result.maxTranslationMm).toBe(0);
    expect(result.severity).toBe('withinTolerance');
  });
});

describe('couchShifts — rotations', () => {
  // Reading yaw off r01/r00 instead of r10/r00 returns it negated. Caught here.
  it('recovers a yaw with the right SIGN', () => {
    const result = decomposeRotation(yaw(3));
    expect(result.yawDeg).toBeCloseTo(3, 6);
    expect(result.rollDeg).toBeCloseTo(0, 6);
    expect(result.pitchDeg).toBeCloseTo(0, 6);
    expect(result.nearDegenerate).toBe(false);
  });

  it('recovers a negative yaw', () => {
    expect(decomposeRotation(yaw(-2.5)).yawDeg).toBeCloseTo(-2.5, 6);
  });

  // A registration that has gone wrong produces exactly the large angles where the
  // decomposition breaks.
  it('flags a decomposition near gimbal lock instead of returning a confident triple', () => {
    const pitched = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];
    const result = decomposeRotation(pitched);
    expect(result.nearDegenerate).toBe(true);
    expect(result.message).toMatch(/gimbal lock/);
  });

  it('surfaces that warning through the couch correction', () => {
    const pitched = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];
    expect(shifts({ matrix: pitched }).warnings.join(' ')).toMatch(/gimbal lock/);
  });
});

describe('couchShifts — action levels', () => {
  it('is within tolerance below the action level', () => {
    expect(shifts({ matrix: translation(0, 0, 2) }).severity).toBe('withinTolerance');
  });

  it('reaches the action level above 3 mm', () => {
    expect(shifts({ matrix: translation(0, 0, ACTION_LEVEL_MM + 0.5) }).severity).toBe(
      'actionLevel'
    );
  });

  it('is above the limit past 5 mm', () => {
    const result = shifts({ matrix: translation(0, 0, TOLERANCE_LIMIT_MM + 1) });
    expect(result.severity).toBe('aboveLimit');
    expect(describeCorrection(result)).toMatch(/reposicione o paciente/);
  });

  it('rotations trip the levels too', () => {
    expect(shifts({ matrix: yaw(4) }).severity).toBe('actionLevel');
    expect(shifts({ matrix: yaw(6) }).severity).toBe('aboveLimit');
  });

  it('honours site-specific levels', () => {
    expect(
      shifts({ matrix: translation(0, 0, 2), actionLevelMm: 1 }).severity
    ).toBe('actionLevel');
  });

  it('labels every severity', () => {
    for (const key of Object.keys(SEVERITY_LABELS)) {
      expect(SEVERITY_LABELS[key as keyof typeof SEVERITY_LABELS].length).toBeGreaterThan(5);
    }
  });
});

describe('couchShifts — the approval record', () => {
  const base = {
    patientId: 'MRN-1',
    fractionNumber: 7,
    cbctSeriesUid: '1.2.3',
    planningCtSeriesUid: '1.2.4',
    approvedBy: 'fisico1',
    approvedAt: 1_700_000_000_000,
  };

  it('records an in-tolerance correction', () => {
    const result = approveCorrection({ ...base, correction: shifts({ matrix: translation(0, 0, 1) }) });
    expect(result.record).not.toBeNull();
    expect(result.record!.fractionNumber).toBe(7);
    expect(result.record!.approvedBy).toBe('fisico1');
  });

  // An approval log whose entries include corrections nobody should have applied is worse
  // than no log: it is a record that the check was performed.
  it('REFUSES to record an above-limit correction without an explicit override', () => {
    const result = approveCorrection({
      ...base,
      correction: shifts({ matrix: translation(0, 0, 9) }),
    });
    expect(result.record).toBeNull();
    expect(result.error).toMatch(/justificativa explícita/);
  });

  it('records it with the override', () => {
    const result = approveCorrection({
      ...base,
      correction: shifts({ matrix: translation(0, 0, 9) }),
      override: true,
    });
    expect(result.record).not.toBeNull();
  });

  it('refuses without a responsible person, a time or a fraction number', () => {
    const correction = shifts({ matrix: translation(0, 0, 1) });
    expect(approveCorrection({ ...base, correction, approvedBy: '  ' }).error).toMatch(/responsável/);
    expect(approveCorrection({ ...base, correction, approvedAt: NaN }).error).toMatch(/horário/);
    expect(approveCorrection({ ...base, correction, fractionNumber: NaN }).error).toMatch(/fração/);
  });

  it('refuses to record a failed calculation', () => {
    const bad = couchShifts({ matrix: [], patientPosition: 'HFS' });
    expect(approveCorrection({ ...base, correction: bad }).record).toBeNull();
  });
});
