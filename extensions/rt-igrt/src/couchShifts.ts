/**
 * IGRT couch corrections from a CBCT-to-planning-CT registration — pure core (RTV-208).
 *
 * Before each fraction the linac acquires a CBCT, it is registered to the planning CT, and
 * the translation of that registration becomes a couch move. The arithmetic is a matrix
 * decomposition. The dangerous part is the coordinate convention.
 *
 * ## A sign error moves the patient the wrong way, by twice the error
 *
 * The registration is in DICOM patient coordinates: **+x left, +y posterior, +z superior**
 * (for HFS). The couch is described in the IEC 61217 vocabulary the therapist actually
 * types into: **vertical, lateral, longitudinal**. They are not the same axes and they do
 * not have the same signs, and a 4 mm error applied backwards leaves the patient 8 mm off.
 *
 * There is no way to make that safe by being careful in the caller. So the mapping lives
 * here, once, with the patient orientation as a required argument — {@link couchShifts}
 * refuses without it rather than assuming head-first supine, because prone and feet-first
 * setups flip signs and are exactly the cases nobody tests.
 *
 * ## The sign of the correction is opposite to the measured displacement
 *
 * The registration says where the patient *is* relative to where the plan expects them.
 * The couch move is what cancels that. Reporting the displacement in a field labelled
 * "correction" is the second way to send a patient the wrong way, and it is invisible
 * because both numbers are the same magnitude. {@link CouchCorrection} carries both, named
 * differently, and {@link describeCorrection} prints the one the therapist applies.
 *
 * ## Euler angles are only safe because setup rotations are small
 *
 * Decomposing a rotation matrix into roll/pitch/yaw is convention-dependent and unstable
 * near gimbal lock. Setup rotations are a couple of degrees, so the decomposition is well
 * conditioned in practice — but "in practice" is not a guarantee, and a registration that
 * has gone wrong produces exactly the large angles where it breaks.
 * {@link decomposeRotation} reports when it is near the degenerate case instead of
 * returning a confident triple.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

/** Row-major 4×4, DICOM Frame of Reference Transformation Matrix order. */
export type Mat4 = number[];

/** Patient position as DICOM (0018,5100) writes it. */
export type PatientPosition = 'HFS' | 'HFP' | 'FFS' | 'FFP' | 'HFDR' | 'HFDL' | 'FFDR' | 'FFDL';

export const SUPPORTED_POSITIONS: PatientPosition[] = ['HFS', 'HFP', 'FFS', 'FFP'];

/** Action level: above this, the correction is flagged. */
export const ACTION_LEVEL_MM = 3;
export const ACTION_LEVEL_DEG = 3;
/** Above this it should not be applied without a second look. */
export const TOLERANCE_LIMIT_MM = 5;
export const TOLERANCE_LIMIT_DEG = 5;

/** Beyond this the Euler decomposition is close enough to gimbal lock to be untrustworthy. */
export const GIMBAL_WARNING_DEG = 80;

export interface CbctCandidate {
  seriesInstanceUid: string;
  seriesDescription?: string;
  protocolName?: string;
  manufacturer?: string;
  modality?: string;
  /** DICOM (0018,0023). */
  mrAcquisitionType?: string;
  imageType?: string[];
}

export interface CbctDetection {
  isCbct: boolean;
  /** What matched, so a false positive can be traced to its rule. */
  matchedBy: string[];
  confidence: 'high' | 'low' | 'none';
}

const text = (v: unknown): string => String(v ?? '').trim().toUpperCase();

/**
 * Whether a series looks like a setup CBCT.
 *
 * Heuristic by necessity — there is no tag that says "this is a setup image". The rules
 * are reported rather than collapsed to a boolean, because the failure mode is a
 * diagnostic CT being treated as a setup image, and the reader needs to see *why* the
 * viewer thought so.
 *
 * Modality is checked first and hard: a CBCT is stored as `CT`, and anything else that
 * happens to be called "CBCT" is not one.
 */
export function detectCbct(series: CbctCandidate): CbctDetection {
  const matchedBy: string[] = [];
  if (text(series?.modality) !== 'CT') {
    return { isCbct: false, matchedBy, confidence: 'none' };
  }

  const description = text(series?.seriesDescription);
  const protocolName = text(series?.protocolName);
  const manufacturer = text(series?.manufacturer);
  const imageType = (series?.imageType ?? []).map(text);

  if (/\bCBCT\b|CONE ?BEAM/.test(description)) {
    matchedBy.push('SeriesDescription');
  }
  if (/\bCBCT\b|CONE ?BEAM/.test(protocolName)) {
    matchedBy.push('ProtocolName');
  }
  if (/KV (SETUP|CBCT)|SETUP IMAGE/.test(description)) {
    matchedBy.push('SeriesDescription (kV setup)');
  }
  if (imageType.some(t => t.includes('ACQUISITION') && t.includes('CBCT'))) {
    matchedBy.push('ImageType');
  }
  // Manufacturer alone is never enough — a Varian diagnostic CT is still a diagnostic CT.
  if (/VARIAN|ELEKTA/.test(manufacturer) && matchedBy.length) {
    matchedBy.push('Manufacturer');
  }

  if (!matchedBy.length) {
    return { isCbct: false, matchedBy, confidence: 'none' };
  }
  return {
    isCbct: true,
    matchedBy,
    confidence: matchedBy.length >= 2 ? 'high' : 'low',
  };
}

export interface RotationDecomposition {
  /** Rotation about the patient x axis, degrees. */
  rollDeg: number;
  /** About the patient y axis. */
  pitchDeg: number;
  /** About the patient z axis. */
  yawDeg: number;
  /** True when the decomposition is near gimbal lock and should not be trusted. */
  nearDegenerate: boolean;
  message?: string;
}

/**
 * Extracts roll/pitch/yaw from the rotation block, ZYX convention.
 *
 * Reports proximity to gimbal lock rather than silently returning a confident triple —
 * setup rotations are small, but a registration that has gone wrong produces exactly the
 * large angles where the decomposition breaks.
 */
export function decomposeRotation(matrix: Mat4): RotationDecomposition {
  // Row-major indices: r00=m[0] r01=m[1] r02=m[2] | r10=m[4] r11=m[5] r12=m[6]
  //                     r20=m[8] r21=m[9] r22=m[10]
  // ZYX (R = Rz·Ry·Rx): pitch = asin(-r20), yaw = atan2(r10, r00), roll = atan2(r21, r22).
  // Reading yaw off r01/r00 instead of r10/r00 returns it NEGATED — the transpose of the
  // intended convention — which is a sign error on a couch rotation.
  const m = (matrix ?? []).map(v => Number(v) || 0);
  const r20 = Math.min(1, Math.max(-1, m[8]));
  const pitch = Math.asin(-r20);
  const cosPitch = Math.cos(pitch);

  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const nearDegenerate = Math.abs(cosPitch) < Math.cos((GIMBAL_WARNING_DEG * Math.PI) / 180);

  if (Math.abs(cosPitch) < 1e-8) {
    return {
      rollDeg: 0,
      pitchDeg: toDeg(pitch),
      yawDeg: toDeg(Math.atan2(-m[1], m[5])),
      nearDegenerate: true,
      message: 'Rotação em gimbal lock — roll e yaw não são separáveis nesta matriz.',
    };
  }

  return {
    rollDeg: toDeg(Math.atan2(m[9], m[10])),
    pitchDeg: toDeg(pitch),
    yawDeg: toDeg(Math.atan2(m[4], m[0])),
    nearDegenerate,
    message: nearDegenerate
      ? `Rotação de ${Math.abs(toDeg(pitch)).toFixed(0)}° em pitch — decomposição próxima de gimbal lock; verifique o registro.`
      : undefined,
  };
}

export type ShiftSeverity = 'withinTolerance' | 'actionLevel' | 'aboveLimit';

export interface CouchCorrection {
  /**
   * Where the patient is, relative to the plan, in couch axes (mm).
   *
   * This is the *measurement*. It is not what the therapist types in.
   */
  displacement: { verticalMm: number; lateralMm: number; longitudinalMm: number };
  /**
   * What to move the couch by, in couch axes (mm).
   *
   * Opposite sign to the displacement. This is what gets applied.
   */
  correction: { verticalMm: number; lateralMm: number; longitudinalMm: number };
  rotation: RotationDecomposition;
  /** Largest absolute translation, mm. */
  maxTranslationMm: number;
  /** Largest absolute rotation, degrees. */
  maxRotationDeg: number;
  severity: ShiftSeverity;
  patientPosition: PatientPosition;
  warnings: string[];
  ok: boolean;
  reason?: string;
}

/**
 * DICOM patient axes to couch axes, per patient position.
 *
 * `[lateralSign, verticalSign, longitudinalSign]` applied to `[x, y, z]` respectively.
 * Head-first supine is the identity-ish case; the others flip. These are the setups nobody
 * tests, so they are a table rather than a conditional buried in the calculation.
 */
const AXIS_SIGNS: Record<string, { lateral: number; vertical: number; longitudinal: number }> = {
  // +x patient-left is couch-lateral-left; +y patient-posterior is couch-down (vertical
  // is conventionally positive up); +z patient-superior is couch-longitudinal-in.
  HFS: { lateral: 1, vertical: -1, longitudinal: 1 },
  // Prone: the patient is rotated 180 degrees about the longitudinal axis.
  HFP: { lateral: -1, vertical: 1, longitudinal: 1 },
  // Feet first: the longitudinal and lateral axes reverse.
  FFS: { lateral: -1, vertical: -1, longitudinal: -1 },
  FFP: { lateral: 1, vertical: 1, longitudinal: -1 },
};

export interface CouchShiftInput {
  /** Moving (CBCT) → fixed (planning CT) rigid transform, row-major 4×4. */
  matrix: Mat4;
  patientPosition: PatientPosition;
  actionLevelMm?: number;
  actionLevelDeg?: number;
  toleranceLimitMm?: number;
  toleranceLimitDeg?: number;
}

/**
 * Couch corrections from a registration matrix.
 *
 * The patient position is required. Assuming head-first supine would be right most of the
 * time and catastrophically wrong the rest, and the wrong times are the prone and
 * feet-first setups that get least testing.
 */
export function couchShifts(input: CouchShiftInput): CouchCorrection {
  const position = input?.patientPosition;
  const warnings: string[] = [];

  const empty = (reason: string): CouchCorrection => ({
    displacement: { verticalMm: 0, lateralMm: 0, longitudinalMm: 0 },
    correction: { verticalMm: 0, lateralMm: 0, longitudinalMm: 0 },
    rotation: { rollDeg: 0, pitchDeg: 0, yawDeg: 0, nearDegenerate: false },
    maxTranslationMm: 0,
    maxRotationDeg: 0,
    severity: 'withinTolerance',
    patientPosition: position ?? 'HFS',
    warnings,
    ok: false,
    reason,
  });

  const signs = AXIS_SIGNS[String(position ?? '')];
  if (!signs) {
    return empty(
      `Posição do paciente "${position ?? 'ausente'}" não suportada — os sinais dos eixos dependem dela, e aplicar um deslocamento com o sinal trocado deixa o paciente ao dobro do erro.`
    );
  }

  const m = (input?.matrix ?? []).map(v => Number(v));
  if (m.length < 16 || !m.every(Number.isFinite)) {
    return empty('Matriz de registro inválida.');
  }

  // Translation in DICOM patient coordinates.
  const tx = m[3];
  const ty = m[7];
  const tz = m[11];

  const displacement = {
    lateralMm: signs.lateral * tx,
    verticalMm: signs.vertical * ty,
    longitudinalMm: signs.longitudinal * tz,
  };
  // The couch move cancels the displacement.
  const correction = {
    lateralMm: -displacement.lateralMm,
    verticalMm: -displacement.verticalMm,
    longitudinalMm: -displacement.longitudinalMm,
  };

  const rotation = decomposeRotation(m);
  if (rotation.message) {
    warnings.push(rotation.message);
  }

  const maxTranslationMm = Math.max(
    Math.abs(displacement.lateralMm),
    Math.abs(displacement.verticalMm),
    Math.abs(displacement.longitudinalMm)
  );
  const maxRotationDeg = Math.max(
    Math.abs(rotation.rollDeg),
    Math.abs(rotation.pitchDeg),
    Math.abs(rotation.yawDeg)
  );

  const actionMm = positiveOr(input?.actionLevelMm, ACTION_LEVEL_MM);
  const actionDeg = positiveOr(input?.actionLevelDeg, ACTION_LEVEL_DEG);
  const limitMm = positiveOr(input?.toleranceLimitMm, TOLERANCE_LIMIT_MM);
  const limitDeg = positiveOr(input?.toleranceLimitDeg, TOLERANCE_LIMIT_DEG);

  let severity: ShiftSeverity = 'withinTolerance';
  if (maxTranslationMm > limitMm || maxRotationDeg > limitDeg) {
    severity = 'aboveLimit';
  } else if (maxTranslationMm > actionMm || maxRotationDeg > actionDeg) {
    severity = 'actionLevel';
  }

  return {
    displacement,
    correction,
    rotation,
    maxTranslationMm,
    maxRotationDeg,
    severity,
    patientPosition: position,
    warnings,
    ok: true,
  };
}

function positiveOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const SEVERITY_LABELS: Record<ShiftSeverity, string> = {
  withinTolerance: 'Dentro da tolerância',
  actionLevel: 'Nível de ação — confirme antes de aplicar',
  aboveLimit: 'Acima do limite — reposicione o paciente e repita o CBCT',
};

/**
 * The line the therapist reads.
 *
 * Prints the **correction**, labelled as such, with its sign. Printing the displacement
 * in a field the therapist treats as a couch move is the failure this whole module is
 * arranged around.
 */
export function describeCorrection(result: CouchCorrection): string {
  if (!result?.ok) {
    return result?.reason ?? '';
  }
  const mm = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  const deg = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  const { correction, rotation } = result;
  const warnings = result.warnings.length ? ` ${result.warnings.join(' ')}` : '';
  return (
    `Mover mesa — vertical ${mm(correction.verticalMm)} mm, lateral ${mm(correction.lateralMm)} mm, ` +
    `longitudinal ${mm(correction.longitudinalMm)} mm · roll ${deg(rotation.rollDeg)}°, ` +
    `pitch ${deg(rotation.pitchDeg)}°, yaw ${deg(rotation.yawDeg)}° · ` +
    `${SEVERITY_LABELS[result.severity]} (${result.patientPosition}).${warnings}`
  );
}

export interface IgrtRecord {
  patientId: string;
  fractionNumber: number;
  cbctSeriesUid: string;
  planningCtSeriesUid: string;
  correction: CouchCorrection;
  approvedBy: string;
  approvedAt: number;
}

export interface ApprovalResult {
  record: IgrtRecord | null;
  error?: string;
}

/**
 * Builds the immutable IGRT verification record.
 *
 * Refuses to record an approval for a correction above the tolerance limit without an
 * explicit override, and refuses one for a failed calculation at all. An approval log
 * whose entries include corrections nobody should have applied is worse than no log: it
 * is a record that the check was performed.
 */
export function approveCorrection(
  input: Omit<IgrtRecord, 'correction'> & { correction: CouchCorrection; override?: boolean }
): ApprovalResult {
  const correction = input?.correction;
  if (!correction?.ok) {
    return { record: null, error: 'Não há correção válida para aprovar.' };
  }
  if (!String(input?.approvedBy ?? '').trim()) {
    return { record: null, error: 'Aprovação sem responsável identificado.' };
  }
  if (!Number.isFinite(Number(input?.approvedAt))) {
    return { record: null, error: 'Aprovação sem horário.' };
  }
  if (!Number.isFinite(Number(input?.fractionNumber))) {
    return { record: null, error: 'Aprovação sem número de fração.' };
  }
  if (correction.severity === 'aboveLimit' && !input?.override) {
    return {
      record: null,
      error: `${SEVERITY_LABELS.aboveLimit}. Para registrar assim mesmo, é preciso uma justificativa explícita.`,
    };
  }

  return {
    record: {
      patientId: String(input.patientId ?? ''),
      fractionNumber: Number(input.fractionNumber),
      cbctSeriesUid: String(input.cbctSeriesUid ?? ''),
      planningCtSeriesUid: String(input.planningCtSeriesUid ?? ''),
      correction,
      approvedBy: String(input.approvedBy).trim(),
      approvedAt: Number(input.approvedAt),
    },
  };
}
