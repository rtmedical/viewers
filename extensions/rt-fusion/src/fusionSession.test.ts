import { isIdentity, rotationMagnitudeDeg, translationOf } from './fusionRegistration';
import {
  blockedReason,
  buildRegistrationDraft,
  canAdvance,
  describePair,
  emptySession,
  FusionSeries,
  FusionSessionState,
  nextStep,
  previousStep,
  sessionRegistration,
  setRotationEnabled,
  SPATIAL_REGISTRATION_SOP_CLASS_UID,
  stepsFor,
  validatePair,
} from './fusionSession';

const CT: FusionSeries = {
  seriesInstanceUid: '1.2.3.1',
  studyInstanceUid: '1.2.3',
  patientId: 'MRN-1',
  frameOfReferenceUid: 'FOR-A',
  modality: 'CT',
  seriesDescription: 'TORAX',
};

const PET: FusionSeries = {
  seriesInstanceUid: '1.2.3.2',
  studyInstanceUid: '1.2.3',
  patientId: 'MRN-1',
  frameOfReferenceUid: 'FOR-A',
  modality: 'PT',
  seriesDescription: 'MEDIASTINO',
};

const MR_OTHER_FOR: FusionSeries = {
  ...PET,
  seriesInstanceUid: '1.2.4.1',
  studyInstanceUid: '1.2.4',
  frameOfReferenceUid: 'FOR-B',
  modality: 'MR',
  seriesDescription: 'T1 POS',
};

const session = (over: Partial<FusionSessionState> = {}): FusionSessionState => ({
  ...emptySession(),
  fixed: CT,
  moving: MR_OTHER_FOR,
  ...over,
});

describe('fusionSession — pair validation', () => {
  // A confident-looking picture on top of a wrong-patient error.
  it('refuses two patients, before any other check can approve it', () => {
    const v = validatePair(CT, { ...MR_OTHER_FOR, patientId: 'MRN-2' });
    expect(v.verdict).toBe('differentPatient');
    expect(v.fusable).toBe(false);
  });

  it('refuses a series with itself', () => {
    expect(validatePair(CT, { ...CT }).verdict).toBe('sameSeries');
  });

  it('asks for two series before anything else', () => {
    expect(validatePair(CT, {} as FusionSeries).verdict).toBe('incomplete');
    expect(validatePair(undefined as never, undefined as never).fusable).toBe(false);
  });

  it('refuses a series with no spatial information', () => {
    const v = validatePair(CT, { ...MR_OTHER_FOR, hasSpatialInformation: false });
    expect(v.verdict).toBe('noSpatialInformation');
    expect(v.message).toMatch(/ImagePositionPatient/);
  });

  // The scanner's FoR UID is its assertion that the two volumes already share a
  // coordinate system. This is the most common fusion pair there is.
  it('recognises a shared Frame of Reference as already registered', () => {
    const v = validatePair(CT, PET);
    expect(v.verdict).toBe('alreadyRegistered');
    expect(v.fusable).toBe(true);
    expect(v.preRegistered).toBe(true);
  });

  it('accepts differing frames of reference and asks for an isocenter', () => {
    const v = validatePair(CT, MR_OTHER_FOR);
    expect(v.verdict).toBe('ok');
    expect(v.preRegistered).toBe(false);
    expect(v.message).toMatch(/isocentro/);
  });

  it('does not treat a missing FoR as a match', () => {
    const v = validatePair({ ...CT, frameOfReferenceUid: '' }, { ...MR_OTHER_FOR, frameOfReferenceUid: '' });
    expect(v.preRegistered).toBe(false);
  });

  it('names the modality pair for the header', () => {
    expect(validatePair(CT, PET).pairKind).toBe('CT-PT');
    expect(describePair(session({ fixed: CT, moving: PET }))).toBe('CT-PT · MEDIASTINO → TORAX');
  });
});

describe('fusionSession — step flow', () => {
  it('walks select → isocenter → preview for an unregistered pair', () => {
    expect(stepsFor(session())).toEqual(['select', 'isocenter', 'preview']);
  });

  // Offering the step would invite the reader to replace a known-good registration with
  // a hand-placed click.
  it('SKIPS the isocenter step when the pair is already registered', () => {
    expect(stepsFor(session({ moving: PET }))).toEqual(['select', 'preview']);
  });

  it('offers only selection while the pair is invalid', () => {
    expect(stepsFor(session({ moving: { ...MR_OTHER_FOR, patientId: 'MRN-9' } }))).toEqual([
      'select',
    ]);
  });

  it('inserts the rotation step only when asked for', () => {
    expect(stepsFor(setRotationEnabled(session(), true))).toEqual([
      'select',
      'isocenter',
      'rotation',
      'preview',
    ]);
  });

  it('will not advance past selection with an invalid pair, and says why', () => {
    const state = session({ moving: { ...MR_OTHER_FOR, patientId: 'MRN-9' } });
    expect(canAdvance(state)).toBe(false);
    expect(blockedReason(state)).toMatch(/pacientes diferentes/);
    expect(nextStep(state)).toBe(state);
  });

  it('will not leave the isocenter step until both points are placed', () => {
    const state = session({ step: 'isocenter' });
    expect(blockedReason(state)).toMatch(/isocentro/);
    expect(canAdvance(state)).toBe(false);

    const placed = { ...state, fixedIsocenter: [0, 0, 0] as never, movingIsocenter: [1, 0, 0] as never };
    expect(blockedReason(placed)).toBeNull();
    expect(nextStep(placed).step).toBe('preview');
  });

  it('goes back through the same steps it came forward through', () => {
    const state = session({ step: 'preview' });
    expect(previousStep(state).step).toBe('isocenter');
    expect(previousStep(session({ step: 'select' })).step).toBe('select');
  });

  // Hidden non-zero state still applied to the saved registration is exactly what makes
  // a fusion irreproducible.
  it('clears the angles when the rotation step is turned off', () => {
    let state = setRotationEnabled(session({ step: 'rotation' }), true);
    state = { ...state, angles: { x: 5, y: 0, z: 12 } };
    const off = setRotationEnabled(state, false);
    expect(off.angles).toEqual({ x: 0, y: 0, z: 0 });
    expect(off.step).toBe('preview');
  });
});

describe('fusionSession — the resulting transform', () => {
  it('is the identity for an already-registered pair, not a hand-placed shift', () => {
    const state = session({
      moving: PET,
      fixedIsocenter: [0, 0, 0],
      movingIsocenter: [40, 40, 40],
    });
    expect(isIdentity(sessionRegistration(state))).toBe(true);
  });

  it('is a translation for an unregistered pair', () => {
    const state = session({ fixedIsocenter: [10, 5, 0], movingIsocenter: [0, 0, 0] });
    const m = sessionRegistration(state);
    expect(translationOf(m)).toEqual([10, 5, 0]);
    expect(rotationMagnitudeDeg(m)).toBeCloseTo(0, 9);
  });

  it('includes the rotation once the angio step is enabled', () => {
    const state = setRotationEnabled(
      session({ fixedIsocenter: [0, 0, 0], movingIsocenter: [0, 0, 0] }),
      true
    );
    const m = sessionRegistration({ ...state, angles: { x: 0, y: 0, z: 15 } });
    expect(rotationMagnitudeDeg(m)).toBeCloseTo(15, 6);
  });

  it('ignores the angles while the rotation step is off', () => {
    const state = session({
      fixedIsocenter: [0, 0, 0],
      movingIsocenter: [0, 0, 0],
      angles: { x: 0, y: 0, z: 15 },
    });
    expect(rotationMagnitudeDeg(sessionRegistration(state))).toBeCloseTo(0, 9);
  });

  it('is the identity for an invalid pair rather than a partial transform', () => {
    const state = session({ moving: { ...MR_OTHER_FOR, patientId: 'MRN-9' }, fixedIsocenter: [9, 9, 9] });
    expect(isIdentity(sessionRegistration(state))).toBe(true);
  });
});

describe('fusionSession — what gets saved to the PACS', () => {
  const state = session({ fixedIsocenter: [10, 0, 0], movingIsocenter: [0, 0, 0] });

  it('is a Spatial Registration object, not a resampled volume', () => {
    const draft = buildRegistrationDraft(state)!;
    expect(draft.sopClassUid).toBe(SPATIAL_REGISTRATION_SOP_CLASS_UID);
    expect(draft.matrixType).toBe('RIGID');
    expect(draft.frameOfReferenceTransformationMatrix).toHaveLength(16);
  });

  it('references both frames of reference, in the right roles', () => {
    const draft = buildRegistrationDraft(state)!;
    expect(draft.referencedFrameOfReferenceUid).toBe('FOR-A');
    expect(draft.sourceFrameOfReferenceUid).toBe('FOR-B');
    expect(draft.referencedSeriesInstanceUids).toEqual(['1.2.3.1', '1.2.4.1']);
  });

  // An object asserting nothing is an object every downstream reader opens and dismisses.
  it('writes nothing for an already-registered pair with no adjustment', () => {
    expect(buildRegistrationDraft(session({ moving: PET }))).toBeNull();
  });

  it('does write when the reader rotated an already-registered pair', () => {
    const rotated = setRotationEnabled(
      session({ moving: PET, fixedIsocenter: [0, 0, 0], movingIsocenter: [0, 0, 0] }),
      true
    );
    const draft = buildRegistrationDraft({ ...rotated, angles: { x: 0, y: 0, z: 5 } });
    expect(draft).not.toBeNull();
    expect(rotationMagnitudeDeg(draft!.frameOfReferenceTransformationMatrix)).toBeCloseTo(5, 6);
  });

  it('writes nothing for an invalid pair', () => {
    expect(buildRegistrationDraft(session({ moving: { ...CT } }))).toBeNull();
  });
});
