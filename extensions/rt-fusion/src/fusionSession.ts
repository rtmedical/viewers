/**
 * Fusion modal session: pair validation and step flow — pure core (RTV-134).
 *
 * The modal picks two series, asks for an isocenter, optionally asks for a rotation, and
 * saves. The interesting part is not the wizard; it is deciding *whether these two series
 * may be fused at all* and *which steps are even meaningful for them*.
 *
 * ## Two patients is never a fusion
 *
 * Overlaying one patient's anatomy on another's is a wrong-patient error with a
 * confident-looking picture on top of it. {@link validatePair} refuses on differing
 * PatientID, and refuses before anything else, so no later check can accidentally
 * approve it.
 *
 * ## Same Frame of Reference means the registration already exists
 *
 * PET/CT from a combined scanner, or a CT with its own re-reconstruction, share a
 * FrameOfReferenceUID. That UID is the scanner's assertion that the two volumes are
 * already in the same coordinate system. The correct transform is the identity, and the
 * isocenter step must be **skipped**, not offered — a reader who nudges an isocenter here
 * is destroying a known-good spatial relationship and replacing it with a hand-placed
 * click. This is the most common fusion pair in practice, so getting it wrong would be
 * the most common way to be wrong.
 *
 * ## The rotation step is opt-in, because one point cannot produce rotation
 *
 * See `fusionRegistration.ts`: a single landmark pair determines translation and nothing
 * else. The CR step exists for the angio case, where the reader dials angles explicitly.
 * Offering it by default would suggest the modal is doing something it is not.
 *
 * ## What "save to PACS" means
 *
 * A DICOM Spatial Registration object (SOP class 1.2.840.10008.5.1.4.1.1.66.1) carrying
 * the 4×4 and both Frame of Reference UIDs — *not* a resampled volume and not a
 * screenshot. The registration is the finding; a resampled copy is a derived image that
 * doubles the archive and cannot be undone or refined later.
 *
 * Framework-free. Zero-fork per RTV-114.
 */

import {
  buildRegistration,
  identity,
  isIdentity,
  Mat4,
  RegistrationInput,
  Vec3,
} from './fusionRegistration';

/** Spatial Registration Storage. Deformable would be `...66.3`, which this is not. */
export const SPATIAL_REGISTRATION_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.66.1';

export interface FusionSeries {
  seriesInstanceUid: string;
  studyInstanceUid?: string;
  patientId?: string;
  frameOfReferenceUid?: string;
  modality?: string;
  seriesDescription?: string;
  /** False when the series has no ImagePositionPatient — nothing to register. */
  hasSpatialInformation?: boolean;
}

export type PairVerdict =
  | 'ok'
  | 'alreadyRegistered'
  | 'differentPatient'
  | 'sameSeries'
  | 'noSpatialInformation'
  | 'incomplete';

export interface PairValidation {
  verdict: PairVerdict;
  /** True when the pair can proceed at all. */
  fusable: boolean;
  /** True when the frames of reference already agree; the isocenter step is skipped. */
  preRegistered: boolean;
  message: string;
  /** e.g. 'PET-CT'. Empty when either modality is unknown. */
  pairKind: string;
}

const text = (v: unknown): string => String(v ?? '').trim();

/**
 * Whether these two series may be fused.
 *
 * Order is deliberate: the wrong-patient refusal comes first, and the
 * already-registered case is decided before anything asks the reader for a landmark.
 */
export function validatePair(fixed: FusionSeries, moving: FusionSeries): PairValidation {
  const kind = [text(fixed?.modality), text(moving?.modality)].filter(Boolean).join('-');
  const base = { pairKind: kind.includes('-') ? kind : '' };

  if (!text(fixed?.seriesInstanceUid) || !text(moving?.seriesInstanceUid)) {
    return {
      ...base,
      verdict: 'incomplete',
      fusable: false,
      preRegistered: false,
      message: 'Selecione duas séries.',
    };
  }

  const fixedPatient = text(fixed.patientId);
  const movingPatient = text(moving.patientId);
  if (fixedPatient && movingPatient && fixedPatient !== movingPatient) {
    return {
      ...base,
      verdict: 'differentPatient',
      fusable: false,
      preRegistered: false,
      message: 'As séries são de pacientes diferentes.',
    };
  }

  if (text(fixed.seriesInstanceUid) === text(moving.seriesInstanceUid)) {
    return {
      ...base,
      verdict: 'sameSeries',
      fusable: false,
      preRegistered: false,
      message: 'Selecione duas séries distintas.',
    };
  }

  if (fixed.hasSpatialInformation === false || moving.hasSpatialInformation === false) {
    return {
      ...base,
      verdict: 'noSpatialInformation',
      fusable: false,
      preRegistered: false,
      message: 'Uma das séries não tem posicionamento espacial (sem ImagePositionPatient).',
    };
  }

  const fixedFor = text(fixed.frameOfReferenceUid);
  const movingFor = text(moving.frameOfReferenceUid);
  if (fixedFor && movingFor && fixedFor === movingFor) {
    return {
      ...base,
      verdict: 'alreadyRegistered',
      fusable: true,
      preRegistered: true,
      message: 'Mesmo Frame of Reference — as séries já estão registradas.',
    };
  }

  return {
    ...base,
    verdict: 'ok',
    fusable: true,
    preRegistered: false,
    message: 'Frames of Reference diferentes — defina o isocentro.',
  };
}

export type FusionStep = 'select' | 'isocenter' | 'rotation' | 'preview';

export interface FusionSessionState {
  step: FusionStep;
  fixed?: FusionSeries;
  moving?: FusionSeries;
  movingIsocenter?: Vec3;
  fixedIsocenter?: Vec3;
  /** Angio: the reader asked for the rotation step. */
  rotationEnabled: boolean;
  angles: { x: number; y: number; z: number };
  centreOfRotation?: Vec3;
}

export function emptySession(): FusionSessionState {
  return { step: 'select', rotationEnabled: false, angles: { x: 0, y: 0, z: 0 } };
}

/**
 * The steps this pair actually needs.
 *
 * A pre-registered pair goes straight from selection to preview: there is no landmark to
 * place, and offering the step would invite the reader to break a correct registration.
 */
export function stepsFor(state: FusionSessionState): FusionStep[] {
  const validation = validatePair(state?.fixed as FusionSeries, state?.moving as FusionSeries);
  if (!validation.fusable) {
    return ['select'];
  }
  const steps: FusionStep[] = ['select'];
  if (!validation.preRegistered) {
    steps.push('isocenter');
  }
  if (state?.rotationEnabled) {
    steps.push('rotation');
  }
  steps.push('preview');
  return steps;
}

/** Why the wizard cannot advance, or null when it can. */
export function blockedReason(state: FusionSessionState): string | null {
  const validation = validatePair(state?.fixed as FusionSeries, state?.moving as FusionSeries);
  if (state?.step === 'select') {
    return validation.fusable ? null : validation.message;
  }
  if (state?.step === 'isocenter') {
    return state?.fixedIsocenter && state?.movingIsocenter
      ? null
      : 'Marque o isocentro nas duas séries.';
  }
  return null;
}

export function canAdvance(state: FusionSessionState): boolean {
  const steps = stepsFor(state);
  const index = steps.indexOf(state?.step);
  return index >= 0 && index < steps.length - 1 && blockedReason(state) === null;
}

export function nextStep(state: FusionSessionState): FusionSessionState {
  if (!canAdvance(state)) {
    return state;
  }
  const steps = stepsFor(state);
  return { ...state, step: steps[steps.indexOf(state.step) + 1] };
}

export function previousStep(state: FusionSessionState): FusionSessionState {
  const steps = stepsFor(state);
  const index = steps.indexOf(state?.step);
  return index > 0 ? { ...state, step: steps[index - 1] } : state;
}

/**
 * Turns the rotation step on or off.
 *
 * Turning it off clears the angles rather than remembering them: a hidden non-zero
 * rotation still applied to the saved registration is exactly the kind of invisible state
 * that makes a fusion irreproducible.
 */
export function setRotationEnabled(
  state: FusionSessionState,
  enabled: boolean
): FusionSessionState {
  if (enabled) {
    return { ...state, rotationEnabled: true };
  }
  return {
    ...state,
    rotationEnabled: false,
    angles: { x: 0, y: 0, z: 0 },
    step: state.step === 'rotation' ? 'preview' : state.step,
  };
}

/** The moving → fixed transform for the current session. */
export function sessionRegistration(state: FusionSessionState): Mat4 {
  const validation = validatePair(state?.fixed as FusionSeries, state?.moving as FusionSeries);
  if (!validation.fusable) {
    return identity();
  }
  if (validation.preRegistered && !state?.rotationEnabled) {
    // The scanner already asserted these share a coordinate system.
    return identity();
  }

  const input: RegistrationInput = {
    movingIsocenter: state?.movingIsocenter,
    fixedIsocenter: state?.fixedIsocenter,
    angles: state?.rotationEnabled ? state?.angles : undefined,
    centreOfRotation: state?.centreOfRotation,
  };
  return buildRegistration(input);
}

export interface SpatialRegistrationDraft {
  sopClassUid: string;
  patientId?: string;
  studyInstanceUid?: string;
  /** Fixed volume's FoR — the registration maps INTO this one. */
  referencedFrameOfReferenceUid?: string;
  /** Moving volume's FoR — the one being mapped. */
  sourceFrameOfReferenceUid?: string;
  referencedSeriesInstanceUids: string[];
  /** Row-major 4×4, DICOM (3006,00C6). */
  frameOfReferenceTransformationMatrix: Mat4;
  matrixType: 'RIGID';
}

/**
 * The object to STOW back to the PACS.
 *
 * Returns `null` when the transform is the identity and the pair was already registered:
 * writing a registration that asserts nothing adds an object every downstream reader has
 * to open and dismiss.
 */
export function buildRegistrationDraft(
  state: FusionSessionState
): SpatialRegistrationDraft | null {
  const validation = validatePair(state?.fixed as FusionSeries, state?.moving as FusionSeries);
  if (!validation.fusable) {
    return null;
  }
  const matrix = sessionRegistration(state);
  if (validation.preRegistered && isIdentity(matrix)) {
    return null;
  }

  return {
    sopClassUid: SPATIAL_REGISTRATION_SOP_CLASS_UID,
    patientId: text(state.fixed?.patientId) || undefined,
    studyInstanceUid: text(state.fixed?.studyInstanceUid) || undefined,
    referencedFrameOfReferenceUid: text(state.fixed?.frameOfReferenceUid) || undefined,
    sourceFrameOfReferenceUid: text(state.moving?.frameOfReferenceUid) || undefined,
    referencedSeriesInstanceUids: [
      text(state.fixed?.seriesInstanceUid),
      text(state.moving?.seriesInstanceUid),
    ].filter(Boolean),
    frameOfReferenceTransformationMatrix: matrix,
    matrixType: 'RIGID',
  };
}

/** Header line for the modal: "PET-CT · MEDIASTINO → TORAX". */
export function describePair(state: FusionSessionState): string {
  const validation = validatePair(state?.fixed as FusionSeries, state?.moving as FusionSeries);
  const names = [
    text(state?.moving?.seriesDescription) || text(state?.moving?.modality),
    text(state?.fixed?.seriesDescription) || text(state?.fixed?.modality),
  ];
  const arrow = names.every(Boolean) ? `${names[0]} → ${names[1]}` : '';
  return [validation.pairKind, arrow].filter(Boolean).join(' · ');
}
