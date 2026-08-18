/**
 * RTV-172 - Image Details panel + Switch to Offline Review (pure core).
 *
 * Radiotherapy treatment-history area. In a course timeline, clicking an imaging
 * event opens a panel with a preview plus a metadata table (acquisition
 * parameters, machine, geometry, imaging dose), backward/forward navigation
 * between imaging events, and a handoff into the Offline Review workspace.
 * Source of truth: Varian Treatment Delivery IFU P1065954-004-D (Oct 2025),
 * pp. 99-110.
 *
 * This module is the decision core only: which rows exist, what presentation
 * state each row is in, explicit unit conversion, session attribution,
 * navigation, preview/metadata pairing and the Offline Review preconditions.
 * No React, no Cornerstone, no DICOM parsing, no HTTP, no imports, no clock,
 * no randomness. Refusals are returned as values; nothing is thrown.
 *
 * Failure modes prevented (each guard below cites the concrete clinical harm):
 *
 *  FM-1  Setup image attributed to the wrong fraction. Ambiguous attribution
 *        (duplicate acquisition timestamps, a timestamp between sessions, no
 *        session reference, a reference that conflicts with the timestamp) is
 *        refused instead of resolved by guessing. Harm: a physicist concludes
 *        the patient was positioned correctly on fraction 12 while looking at
 *        fraction 11's image, and approves a course that had a real setup error.
 *
 *  FM-2  A metadata table that presents an absent value as a value. Absent,
 *        zero and not-applicable are three distinct presentation states with
 *        three distinct display strings. Harm: a physicist comparing imaging
 *        dose across fractions reads a missing mAs as zero exposure and
 *        concludes the patient received no imaging dose on that fraction.
 *
 *  FM-3  Units and the wrong-size-but-plausible value. Every numeric row
 *        carries its unit; conversion is explicit and one-directional per
 *        function; a value whose unit was never declared is marked
 *        unit-not-declared and its machine-readable numericValue is withheld.
 *        Harm: an SID of 100 (cm) rendered and trended as 100 mm, or 2 Gy read
 *        as 2 cGy, both plausible on screen and wrong by a factor of ten or a
 *        hundred.
 *
 *  FM-4  Navigation that silently skips or wraps. Arrows traverse exactly the
 *        filtered, deterministically ordered list, the scope is stated in
 *        words, and both ends refuse instead of wrapping. Harm: the physicist
 *        believes every image of the course was reviewed while a modality
 *        filter hid half of them, or re-reviews the first images believing
 *        they are the last.
 *
 *  FM-5  "Switch to Offline Review" that loses or misroutes context. The
 *        handoff refuses on incomplete or internally inconsistent context and
 *        reports unsaved review state as a distinct outcome. Harm: the user
 *        lands on another patient's data, or on a workspace they believe is
 *        empty, or loses an approval note in progress.
 *
 *  FM-6  The stale preview. Preview and metadata must carry the same instance
 *        UID and the same revision. Harm: a confident wrong answer - last
 *        fraction's cached image shown beside this fraction's numbers.
 *
 *  FM-7  A list that spans more than one patient. Merged timelines let the
 *        arrows step from this patient's image into another patient's image
 *        under the same panel header. Refused at list construction.
 *
 *  FM-8  Blank-but-present identifiers. A whitespace-only patient/course/
 *        session id survives a truthiness check and routes the workspace
 *        nowhere, or to whatever the workspace last had loaded. Treated as
 *        missing everywhere.
 *
 *  FM-9  Numeric junk rendered as a number. A failed upstream parse arrives as
 *        NaN or a non-number; rendering it produces "NaN kV" or "[object
 *        Object] mAs", which readers translate into "the machine recorded
 *        something odd" rather than "this field is unusable". Classified as
 *        absent with an explicit note.
 *
 *  FM-10 Applicability collapsed into absence. kVp on an MV portal image is
 *        not-applicable, not missing; showing it as missing sends a physicist
 *        hunting for a value that never existed, and showing a missing value
 *        as not-applicable hides a real gap in the record. Requires a known
 *        modality, otherwise refuses.
 *
 *  FM-11 Locale-ambiguous number formatting. "1.000 mAs" reads as one or as a
 *        thousand depending on the reader's locale, so no digit grouping is
 *        ever emitted and the decimal separator is fixed for pt-BR.
 */

/* ------------------------------------------------------------------ */
/* Result plumbing                                                     */
/* ------------------------------------------------------------------ */

export type ImgRefusalCode =
  | 'IMG_EVENT_MISSING'
  | 'IMG_EVENT_ID_BLANK'
  | 'IMG_METADATA_MISSING'
  | 'IMG_INSTANCE_UID_MISSING'
  | 'IMG_MODALITY_MISSING'
  | 'IMG_MODALITY_UNSUPPORTED'
  | 'IMG_VALUE_NOT_FINITE'
  | 'IMG_UNIT_UNDECLARED'
  | 'IMG_UNIT_UNKNOWN'
  | 'IMG_UNIT_DIMENSION_MISMATCH'
  | 'IMG_SESSION_LIST_EMPTY'
  | 'IMG_SESSION_RECORD_INVALID'
  | 'IMG_SESSION_REF_UNKNOWN'
  | 'IMG_SESSION_REF_AMBIGUOUS'
  | 'IMG_SESSION_REF_TIME_CONFLICT'
  | 'IMG_SESSION_TIMESTAMP_MISSING'
  | 'IMG_SESSION_TIME_OUTSIDE'
  | 'IMG_SESSION_TIME_AMBIGUOUS'
  | 'IMG_SESSION_PATIENT_MISMATCH'
  | 'IMG_ACQUISITION_TIMESTAMP_COLLISION'
  | 'IMG_LIST_EMPTY'
  | 'IMG_LIST_DUPLICATE_ID'
  | 'IMG_LIST_UNORDERABLE'
  | 'IMG_LIST_MULTIPLE_PATIENTS'
  | 'IMG_FILTER_WINDOW_INVALID'
  | 'IMG_CURRENT_NOT_IN_SCOPE'
  | 'IMG_DIRECTION_INVALID'
  | 'IMG_AT_FIRST'
  | 'IMG_AT_LAST'
  | 'IMG_PREVIEW_MISSING'
  | 'IMG_PREVIEW_UID_MISSING'
  | 'IMG_PREVIEW_MISMATCH'
  | 'IMG_PREVIEW_STALE_REVISION'
  | 'IMG_METADATA_STALE_REVISION'
  | 'IMG_PREVIEW_STALE_AGE'
  | 'IMG_PREVIEW_TIMESTAMP_FUTURE'
  | 'IMG_NOW_INVALID'
  | 'IMG_CONTEXT_MISSING'
  | 'IMG_CONTEXT_INCOMPLETE'
  | 'IMG_CONTEXT_PATIENT_MISMATCH'
  | 'IMG_CONTEXT_SESSION_UNVERIFIED'
  | 'IMG_CONTEXT_SESSION_MISMATCH'
  | 'IMG_CONTEXT_SESSION_INFERRED'
  | 'IMG_CONTEXT_PREVIEW_UNVERIFIED';

/**
 * strictNullChecks is OFF in this package, so a plain discriminated union on a
 * boolean literal does not narrow. The explicit `value?: undefined` /
 * `code?: undefined` / `reason?: undefined` members are what make
 * `if (!r.ok) return r;` followed by `r.value` type-check correctly. Do not
 * "simplify" them away.
 */
export type ImgResult<T> =
  | { ok: true; value: T; code?: undefined; reason?: undefined }
  | { ok: false; code: ImgRefusalCode; reason: string; value?: undefined };

export function imgOk<T>(value: T): ImgResult<T> {
  return { ok: true, value };
}

export function imgRefuse<T>(code: ImgRefusalCode, reason: string): ImgResult<T> {
  return { ok: false, code, reason };
}

/* ------------------------------------------------------------------ */
/* Primitive helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * FM-8: a whitespace-only identifier is not an identifier. Every id check in
 * this module goes through here, because `if (patientId)` accepts " " and the
 * Offline Review workspace then opens whatever it had loaded before - i.e.
 * another patient - under this patient's panel title.
 */
export function imgIsBlank(text: unknown): boolean {
  return typeof text !== 'string' || text.trim().length === 0;
}

export function imgTrim(text: unknown): string {
  return typeof text === 'string' ? text.trim() : '';
}

export function imgIsFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && isFinite(value);
}

export const IMG_DECIMAL_SEPARATOR = ',';

/**
 * FM-11: pt-BR decimal comma, and never any digit grouping. "1.000 mAs" is one
 * thousand to a Brazilian reader and one to an English-speaking visiting
 * physicist reading the same screen; a shared workstation makes that a real
 * mixed-audience situation. Trailing float noise is trimmed so that an exact
 * conversion such as 25 mm -> 2,5 cm never renders as 2,5000000000000004.
 */
export function imgFormatNumber(value: number): string {
  if (!imgIsFiniteNumber(value)) {
    return IMG_DISPLAY_ABSENT;
  }
  let text: string;
  if (Math.round(value) === value) {
    text = String(value);
  } else {
    text = String(parseFloat(value.toFixed(6)));
  }
  if (text.indexOf('e') >= 0 || text.indexOf('E') >= 0) {
    // Exponential notation on a clinical parameter table is unreadable and
    // invites a misread exponent; fall back to a fixed rendering.
    text = parseFloat(value.toFixed(6)).toFixed(6);
  }
  return text.replace('.', IMG_DECIMAL_SEPARATOR);
}

function imgPad(value: number, width: number): string {
  let text = String(value);
  while (text.length < width) {
    text = '0' + text;
  }
  return text;
}

/**
 * Epoch-ms to a fixed UTC calendar string, implemented arithmetically so that
 * the module owns no dependency on the host `Date` object or on the machine
 * time zone. A local-time rendering here would be a real hazard: the same
 * acquisition timestamp would print as two different clock times on the
 * physicist's workstation and on the linac console, and the two readings would
 * be compared against the session schedule (FM-1).
 */
export function imgFormatEpochUtc(epochMs: number): ImgResult<string> {
  if (!imgIsFiniteNumber(epochMs)) {
    return imgRefuse('IMG_VALUE_NOT_FINITE', 'Instante invalido: nao e um numero finito de milissegundos.');
  }
  const total = Math.floor(epochMs);
  const days = Math.floor(total / 86400000);
  const msOfDay = total - days * 86400000;
  const seconds = Math.floor(msOfDay / 1000);
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds - hh * 3600) / 60);
  const ss = seconds - hh * 3600 - mm * 60;

  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  const year = y + (month <= 2 ? 1 : 0);

  return imgOk(
    year +
      '-' +
      imgPad(month, 2) +
      '-' +
      imgPad(day, 2) +
      ' ' +
      imgPad(hh, 2) +
      ':' +
      imgPad(mm, 2) +
      ':' +
      imgPad(ss, 2) +
      ' UTC'
  );
}

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

export type ImgUnit =
  | 'kV'
  | 'MV'
  | 'mA'
  | 'mAs'
  | 'ms'
  | 's'
  | 'mm'
  | 'cm'
  | 'cGy'
  | 'Gy'
  | 'deg'
  | 'none';

export type ImgUnitDimension =
  | 'potential'
  | 'current'
  | 'charge'
  | 'time'
  | 'length'
  | 'dose'
  | 'angle'
  | 'dimensionless';

export const IMG_UNITS: ImgUnit[] = [
  'kV',
  'MV',
  'mA',
  'mAs',
  'ms',
  's',
  'mm',
  'cm',
  'cGy',
  'Gy',
  'deg',
  'none',
];

export const IMG_UNIT_DIMENSIONS: { [unit: string]: ImgUnitDimension } = {
  kV: 'potential',
  MV: 'potential',
  mA: 'current',
  mAs: 'charge',
  ms: 'time',
  s: 'time',
  mm: 'length',
  cm: 'length',
  cGy: 'dose',
  Gy: 'dose',
  deg: 'angle',
  none: 'dimensionless',
};

/**
 * Factor to the base unit of each dimension (base = factor 1). Conversion is
 * value * factor(from) / factor(to); no factor is ever inferred from a unit
 * name, and no cross-dimension pair exists in this table, so "convert seconds
 * to millimetres" cannot silently produce a number (FM-3).
 */
export const IMG_UNIT_BASE_FACTORS: { [unit: string]: number } = {
  mm: 1,
  cm: 10,
  ms: 1,
  s: 1000,
  cGy: 1,
  Gy: 100,
  kV: 1,
  MV: 1000,
  mA: 1,
  mAs: 1,
  deg: 1,
  none: 1,
};

export function imgIsKnownUnit(unit: unknown): boolean {
  return typeof unit === 'string' && Object.prototype.hasOwnProperty.call(IMG_UNIT_DIMENSIONS, unit);
}

export function imgUnitDimension(unit: unknown): ImgUnitDimension {
  return imgIsKnownUnit(unit) ? IMG_UNIT_DIMENSIONS[unit as string] : undefined;
}

/**
 * Generic conversion. Refuses rather than returning a number whenever the pair
 * is not convertible, because a returned number is indistinguishable from a
 * correct one once it reaches a table cell or a trend chart (FM-3).
 */
export function imgConvertUnitValue(value: number, from: ImgUnit, to: ImgUnit): ImgResult<number> {
  if (!imgIsFiniteNumber(value)) {
    return imgRefuse('IMG_VALUE_NOT_FINITE', 'Valor nao numerico ou nao finito: conversao recusada.');
  }
  if (!imgIsKnownUnit(from) || !imgIsKnownUnit(to)) {
    return imgRefuse(
      'IMG_UNIT_UNKNOWN',
      'Unidade desconhecida na conversao (origem "' + String(from) + '", destino "' + String(to) + '").'
    );
  }
  if (IMG_UNIT_DIMENSIONS[from] !== IMG_UNIT_DIMENSIONS[to]) {
    return imgRefuse(
      'IMG_UNIT_DIMENSION_MISMATCH',
      'Conversao incompativel: "' + from + '" e "' + to + '" medem grandezas diferentes.'
    );
  }
  if (from === to) {
    return imgOk(value);
  }
  return imgOk((value * IMG_UNIT_BASE_FACTORS[from]) / IMG_UNIT_BASE_FACTORS[to]);
}

/* One-directional named conversions. Each one exists separately so that a
 * caller cannot pass the arguments in the wrong order and get the inverse
 * factor, which is the exact shape of the bug this codebase keeps hitting:
 * SID 100 cm trended alongside SID 1000 mm as if they differed. */
export function imgConvertCmToMm(value: number): ImgResult<number> {
  return imgConvertUnitValue(value, 'cm', 'mm');
}
export function imgConvertMmToCm(value: number): ImgResult<number> {
  return imgConvertUnitValue(value, 'mm', 'cm');
}
export function imgConvertSecondsToMs(value: number): ImgResult<number> {
  return imgConvertUnitValue(value, 's', 'ms');
}
export function imgConvertMsToSeconds(value: number): ImgResult<number> {
  return imgConvertUnitValue(value, 'ms', 's');
}
export function imgConvertGyToCGy(value: number): ImgResult<number> {
  return imgConvertUnitValue(value, 'Gy', 'cGy');
}
export function imgConvertCGyToGy(value: number): ImgResult<number> {
  return imgConvertUnitValue(value, 'cGy', 'Gy');
}
export function imgConvertMvToKv(value: number): ImgResult<number> {
  return imgConvertUnitValue(value, 'MV', 'kV');
}
export function imgConvertKvToMv(value: number): ImgResult<number> {
  return imgConvertUnitValue(value, 'kV', 'MV');
}

/* ------------------------------------------------------------------ */
/* Domain types                                                        */
/* ------------------------------------------------------------------ */

/**
 * A quantity as it arrives from upstream. `unit` is deliberately optional and
 * deliberately NOT implied by the field name: field names that embed a unit
 * ("tubeCurrentMa") train readers to trust the name over the payload, and the
 * day the payload changes unit the name lies (FM-3). `notApplicable` is the
 * caller's way of saying "this parameter does not exist for this acquisition",
 * which is a different statement from "we do not have it".
 */
export interface ImgQuantity {
  value?: number;
  unit?: ImgUnit;
  notApplicable?: boolean;
}

export type ImgTextValue = string | { notApplicable?: boolean } | null | undefined;

export interface ImgAcquisitionMetadata {
  instanceUid?: ImgTextValue;
  /** DICOM-ish modality of the imaging event, e.g. KV, MV, CBCT, CT. */
  modality?: string;
  acquiredAtMs?: number;
  machineName?: ImgTextValue;
  sessionRef?: ImgTextValue;
  fractionNumber?: number | ImgQuantity;
  kvp?: number | ImgQuantity;
  tubeCurrent?: number | ImgQuantity;
  exposure?: number | ImgQuantity;
  exposureTime?: number | ImgQuantity;
  beamEnergy?: number | ImgQuantity;
  sid?: number | ImgQuantity;
  ssd?: number | ImgQuantity;
  gantryAngle?: number | ImgQuantity;
  collimatorAngle?: number | ImgQuantity;
  imagingDose?: number | ImgQuantity;
  /** Monotonic revision of the metadata record, used for preview pairing. */
  revision?: number;
  updatedAtMs?: number;
}

export interface ImgPreviewRef {
  instanceUid?: string;
  revision?: number;
  renderedAtMs?: number;
}

export interface ImgImagingEvent {
  eventId?: string;
  patientId?: string;
  courseId?: string;
  metadata?: ImgAcquisitionMetadata;
  preview?: ImgPreviewRef;
}

export interface ImgTreatmentSession {
  sessionId?: string;
  patientId?: string;
  courseId?: string;
  fractionNumber?: number;
  startedAtMs?: number;
  endedAtMs?: number;
}

/* ------------------------------------------------------------------ */
/* Value states and the row catalogue                                  */
/* ------------------------------------------------------------------ */

export type ImgValueState = 'present' | 'absent' | 'not-applicable';

export const IMG_VALUE_STATE_PRESENT: ImgValueState = 'present';
export const IMG_VALUE_STATE_ABSENT: ImgValueState = 'absent';
export const IMG_VALUE_STATE_NOT_APPLICABLE: ImgValueState = 'not-applicable';
export const IMG_VALUE_STATES: ImgValueState[] = [
  IMG_VALUE_STATE_PRESENT,
  IMG_VALUE_STATE_ABSENT,
  IMG_VALUE_STATE_NOT_APPLICABLE,
];

/**
 * The unit status of a row is tracked separately from the value status,
 * because "we have 100 but nobody said whether it is mm or cm" is neither a
 * present value nor an absent one: it is a value that must never be compared
 * with another fraction's value (FM-3).
 */
export type ImgUnitState = 'declared' | 'not-declared' | 'unrecognized' | 'incompatible' | 'not-applicable';

export const IMG_UNIT_STATE_DECLARED: ImgUnitState = 'declared';
export const IMG_UNIT_STATE_NOT_DECLARED: ImgUnitState = 'not-declared';
export const IMG_UNIT_STATE_UNRECOGNIZED: ImgUnitState = 'unrecognized';
export const IMG_UNIT_STATE_INCOMPATIBLE: ImgUnitState = 'incompatible';
export const IMG_UNIT_STATE_NOT_APPLICABLE: ImgUnitState = 'not-applicable';
export const IMG_UNIT_STATES: ImgUnitState[] = [
  IMG_UNIT_STATE_DECLARED,
  IMG_UNIT_STATE_NOT_DECLARED,
  IMG_UNIT_STATE_UNRECOGNIZED,
  IMG_UNIT_STATE_INCOMPATIBLE,
  IMG_UNIT_STATE_NOT_APPLICABLE,
];

/**
 * FM-2: three states, three strings that cannot be confused with each other or
 * with a measurement. In particular there is no "-" and no empty cell: a dash
 * in a dose column is read as "not applicable" by half of the readers and as
 * "zero" by the other half.
 */
export const IMG_DISPLAY_ABSENT = 'Nao informado';
export const IMG_DISPLAY_NOT_APPLICABLE = 'Nao aplicavel';
export const IMG_DISPLAY_UNIT_NOT_DECLARED_SUFFIX = 'unidade nao declarada';
export const IMG_DISPLAY_UNIT_UNRECOGNIZED_SUFFIX = 'unidade nao reconhecida';
export const IMG_DISPLAY_UNIT_INCOMPATIBLE_SUFFIX = 'unidade incompativel';

export type ImgRowKind = 'text' | 'numeric' | 'timestamp';

export type ImgModalityClass = 'kv' | 'mv';

export interface ImgDetailRowDescriptor {
  key: string;
  /** User-facing label, pt-BR. */
  label: string;
  kind: ImgRowKind;
  field: string;
  /** Canonical unit every present numeric row is normalized to. */
  canonicalUnit?: ImgUnit;
  /** 'all', or the modality class this parameter exists for (FM-10). */
  appliesTo: 'all' | ImgModalityClass;
}

/** Modalities whose acquisition parameters are kV-tube parameters. */
export const IMG_KV_MODALITIES: string[] = ['KV', 'CBCT', 'CT', 'DX', 'RTIMAGE_KV'];
/** Modalities imaged with the treatment beam. */
export const IMG_MV_MODALITIES: string[] = ['MV', 'MVCT', 'RTIMAGE_MV'];

export const IMG_ROW_CATALOGUE: ImgDetailRowDescriptor[] = [
  { key: 'modality', label: 'Modalidade', kind: 'text', field: 'modality', appliesTo: 'all' },
  { key: 'acquiredAt', label: 'Data/hora da aquisicao', kind: 'timestamp', field: 'acquiredAtMs', appliesTo: 'all' },
  { key: 'machineName', label: 'Equipamento', kind: 'text', field: 'machineName', appliesTo: 'all' },
  { key: 'sessionRef', label: 'Sessao de tratamento', kind: 'text', field: 'sessionRef', appliesTo: 'all' },
  { key: 'fractionNumber', label: 'Fracao', kind: 'numeric', field: 'fractionNumber', canonicalUnit: 'none', appliesTo: 'all' },
  { key: 'kvp', label: 'Tensao do tubo', kind: 'numeric', field: 'kvp', canonicalUnit: 'kV', appliesTo: 'kv' },
  { key: 'tubeCurrent', label: 'Corrente do tubo', kind: 'numeric', field: 'tubeCurrent', canonicalUnit: 'mA', appliesTo: 'kv' },
  { key: 'exposure', label: 'Exposicao', kind: 'numeric', field: 'exposure', canonicalUnit: 'mAs', appliesTo: 'kv' },
  { key: 'exposureTime', label: 'Tempo de exposicao', kind: 'numeric', field: 'exposureTime', canonicalUnit: 'ms', appliesTo: 'kv' },
  { key: 'beamEnergy', label: 'Energia do feixe', kind: 'numeric', field: 'beamEnergy', canonicalUnit: 'MV', appliesTo: 'mv' },
  { key: 'sid', label: 'Distancia fonte-imagem', kind: 'numeric', field: 'sid', canonicalUnit: 'mm', appliesTo: 'all' },
  { key: 'ssd', label: 'Distancia fonte-superficie', kind: 'numeric', field: 'ssd', canonicalUnit: 'mm', appliesTo: 'all' },
  { key: 'gantryAngle', label: 'Angulo de gantry', kind: 'numeric', field: 'gantryAngle', canonicalUnit: 'deg', appliesTo: 'all' },
  { key: 'collimatorAngle', label: 'Angulo de colimador', kind: 'numeric', field: 'collimatorAngle', canonicalUnit: 'deg', appliesTo: 'all' },
  { key: 'imagingDose', label: 'Dose de imagem', kind: 'numeric', field: 'imagingDose', canonicalUnit: 'cGy', appliesTo: 'all' },
  { key: 'instanceUid', label: 'UID da instancia', kind: 'text', field: 'instanceUid', appliesTo: 'all' },
];

export const IMG_ROW_KEYS: string[] = IMG_ROW_CATALOGUE.map(function (d) {
  return d.key;
});

export interface ImgDetailRow {
  key: string;
  label: string;
  state: ImgValueState;
  unitState: ImgUnitState;
  /** Canonical unit of `numericValue`, when the unit is known. */
  unit?: ImgUnit;
  /**
   * Machine-readable value in the canonical unit. Populated ONLY when
   * unitState === 'declared' and state === 'present'. Anything that reads this
   * field (trending, cross-fraction comparison, export) therefore cannot pick
   * up a number of unknown scale (FM-3).
   */
  numericValue?: number;
  /** The number exactly as received, whatever its unit status. */
  rawValue?: number;
  rawUnit?: ImgUnit;
  textValue?: string;
  display: string;
  converted: boolean;
  note?: string;
}

export interface ImgDetailRows {
  instanceUid: string;
  modality: string;
  modalityClass: ImgModalityClass;
  rows: ImgDetailRow[];
  presentCount: number;
  absentCount: number;
  notApplicableCount: number;
  unitWarningCount: number;
}

export function imgNormalizeModality(modality: unknown): string {
  return imgTrim(modality).toUpperCase().replace(/[\s-]+/g, '_');
}

/**
 * FM-10: applicability decides whether an empty kVp cell means "never existed"
 * or "should exist and is missing". Without a recognized modality neither
 * statement can be made, so the panel refuses to render a table at all rather
 * than defaulting every kV row to not-applicable on an unknown-modality image.
 */
export function imgClassifyModality(modality: unknown): ImgResult<ImgModalityClass> {
  const normalized = imgNormalizeModality(modality);
  if (normalized.length === 0) {
    return imgRefuse(
      'IMG_MODALITY_MISSING',
      'Modalidade ausente: nao e possivel distinguir parametro inexistente de parametro faltante.'
    );
  }
  if (IMG_KV_MODALITIES.indexOf(normalized) >= 0) {
    return imgOk('kv');
  }
  if (IMG_MV_MODALITIES.indexOf(normalized) >= 0) {
    return imgOk('mv');
  }
  return imgRefuse(
    'IMG_MODALITY_UNSUPPORTED',
    'Modalidade "' + normalized + '" nao reconhecida: aplicabilidade dos parametros de aquisicao indefinida.'
  );
}

function imgTextValueState(value: ImgTextValue): { state: ImgValueState; text?: string } {
  if (value !== null && typeof value === 'object') {
    if ((value as { notApplicable?: boolean }).notApplicable === true) {
      return { state: IMG_VALUE_STATE_NOT_APPLICABLE };
    }
    return { state: IMG_VALUE_STATE_ABSENT };
  }
  if (imgIsBlank(value)) {
    return { state: IMG_VALUE_STATE_ABSENT };
  }
  return { state: IMG_VALUE_STATE_PRESENT, text: imgTrim(value) };
}

function imgAsQuantity(raw: number | ImgQuantity, canonicalUnit: ImgUnit): ImgQuantity {
  if (typeof raw === 'number') {
    // A bare number is accepted as already-canonical ONLY for dimensionless
    // rows (a fraction number has no unit to get wrong). For every dimensioned
    // parameter a bare number is treated as unit-not-declared, which is what
    // stops "sid: 100" from being charted next to "sid: {value:1000,unit:mm}".
    if (canonicalUnit === 'none') {
      return { value: raw, unit: 'none' };
    }
    return { value: raw };
  }
  return raw;
}

/**
 * Builds one row. Every branch below maps to a distinct on-screen string; no
 * branch produces an empty cell.
 */
export function imgBuildDetailRow(
  descriptor: ImgDetailRowDescriptor,
  metadata: ImgAcquisitionMetadata,
  modalityClass: ImgModalityClass
): ImgDetailRow {
  const base: ImgDetailRow = {
    key: descriptor.key,
    label: descriptor.label,
    state: IMG_VALUE_STATE_ABSENT,
    unitState: descriptor.kind === 'numeric' ? IMG_UNIT_STATE_DECLARED : IMG_UNIT_STATE_NOT_APPLICABLE,
    display: IMG_DISPLAY_ABSENT,
    converted: false,
  };

  if (descriptor.appliesTo !== 'all' && descriptor.appliesTo !== modalityClass) {
    base.state = IMG_VALUE_STATE_NOT_APPLICABLE;
    base.unitState = IMG_UNIT_STATE_NOT_APPLICABLE;
    base.display = IMG_DISPLAY_NOT_APPLICABLE;
    base.note = 'Parametro inexistente para esta modalidade de imagem.';
    return base;
  }

  const raw = (metadata as { [key: string]: unknown })[descriptor.field];

  if (descriptor.kind === 'text') {
    const classified = imgTextValueState(raw as ImgTextValue);
    base.state = classified.state;
    base.unitState = IMG_UNIT_STATE_NOT_APPLICABLE;
    if (classified.state === IMG_VALUE_STATE_PRESENT) {
      base.textValue = classified.text;
      base.display = classified.text;
    } else if (classified.state === IMG_VALUE_STATE_NOT_APPLICABLE) {
      base.display = IMG_DISPLAY_NOT_APPLICABLE;
    } else {
      base.display = IMG_DISPLAY_ABSENT;
    }
    return base;
  }

  if (descriptor.kind === 'timestamp') {
    base.unitState = IMG_UNIT_STATE_NOT_APPLICABLE;
    if (raw === null || raw === undefined) {
      base.state = IMG_VALUE_STATE_ABSENT;
      base.display = IMG_DISPLAY_ABSENT;
      return base;
    }
    if (!imgIsFiniteNumber(raw)) {
      // FM-9: an unparsed date arriving as NaN must not print as "NaN" or as
      // "01/01/1970"; either reading is taken as a real acquisition time.
      base.state = IMG_VALUE_STATE_ABSENT;
      base.display = IMG_DISPLAY_ABSENT;
      base.note = 'Instante de aquisicao invalido no registro de origem.';
      return base;
    }
    const formatted = imgFormatEpochUtc(raw as number);
    if (!formatted.ok) {
      base.state = IMG_VALUE_STATE_ABSENT;
      base.display = IMG_DISPLAY_ABSENT;
      base.note = formatted.reason;
      return base;
    }
    base.state = IMG_VALUE_STATE_PRESENT;
    base.rawValue = raw as number;
    base.numericValue = raw as number;
    base.display = formatted.value;
    return base;
  }

  /* numeric */
  const canonical = descriptor.canonicalUnit;
  if (raw === null || raw === undefined) {
    base.state = IMG_VALUE_STATE_ABSENT;
    base.unitState = IMG_UNIT_STATE_DECLARED;
    base.unit = canonical;
    base.display = IMG_DISPLAY_ABSENT;
    return base;
  }

  if (typeof raw !== 'number' && typeof raw !== 'object') {
    // FM-9: a string "120" or a boolean would otherwise be concatenated with
    // the unit and read as a measurement.
    base.state = IMG_VALUE_STATE_ABSENT;
    base.unit = canonical;
    base.display = IMG_DISPLAY_ABSENT;
    base.note = 'Valor de origem nao numerico: campo tratado como nao informado.';
    return base;
  }

  const quantity = imgAsQuantity(raw as number | ImgQuantity, canonical);

  if (quantity.notApplicable === true) {
    base.state = IMG_VALUE_STATE_NOT_APPLICABLE;
    base.unitState = IMG_UNIT_STATE_NOT_APPLICABLE;
    base.display = IMG_DISPLAY_NOT_APPLICABLE;
    return base;
  }

  if (quantity.value === null || quantity.value === undefined) {
    base.state = IMG_VALUE_STATE_ABSENT;
    base.unit = canonical;
    base.display = IMG_DISPLAY_ABSENT;
    return base;
  }

  if (!imgIsFiniteNumber(quantity.value)) {
    // FM-2 + FM-9: NaN/Infinity is absence, and must not be rendered as a
    // number next to a unit. A physicist comparing imaging dose across
    // fractions must see "Nao informado", never "NaN cGy".
    base.state = IMG_VALUE_STATE_ABSENT;
    base.unit = canonical;
    base.display = IMG_DISPLAY_ABSENT;
    base.note = 'Valor numerico invalido no registro de origem (nao finito).';
    return base;
  }

  base.rawValue = quantity.value;

  if (quantity.unit === null || quantity.unit === undefined || imgIsBlank(quantity.unit)) {
    // FM-3: value present, scale unknown. Shown with an explicit warning and
    // WITHOUT numericValue, so nothing downstream can compare or trend it.
    base.state = IMG_VALUE_STATE_PRESENT;
    base.unitState = IMG_UNIT_STATE_NOT_DECLARED;
    base.display =
      imgFormatNumber(quantity.value) + ' (' + IMG_DISPLAY_UNIT_NOT_DECLARED_SUFFIX + '; esperado ' + canonical + ')';
    base.note = 'Unidade nao declarada na origem: valor nao comparavel entre fracoes.';
    return base;
  }

  base.rawUnit = quantity.unit;

  if (!imgIsKnownUnit(quantity.unit)) {
    base.state = IMG_VALUE_STATE_PRESENT;
    base.unitState = IMG_UNIT_STATE_UNRECOGNIZED;
    base.display =
      imgFormatNumber(quantity.value) +
      ' ' +
      String(quantity.unit) +
      ' (' +
      IMG_DISPLAY_UNIT_UNRECOGNIZED_SUFFIX +
      ')';
    base.note = 'Unidade "' + String(quantity.unit) + '" desconhecida: valor nao convertido.';
    return base;
  }

  if (imgUnitDimension(quantity.unit) !== imgUnitDimension(canonical)) {
    // FM-3: an exposure time arriving in mm is a mapping bug upstream. Showing
    // the number anyway, in the canonical unit, would produce a plausible
    // wrong parameter in the table.
    base.state = IMG_VALUE_STATE_PRESENT;
    base.unitState = IMG_UNIT_STATE_INCOMPATIBLE;
    base.display =
      imgFormatNumber(quantity.value) +
      ' ' +
      quantity.unit +
      ' (' +
      IMG_DISPLAY_UNIT_INCOMPATIBLE_SUFFIX +
      '; esperado ' +
      canonical +
      ')';
    base.note = 'Unidade incompativel com o parametro: conversao recusada.';
    return base;
  }

  const converted = imgConvertUnitValue(quantity.value, quantity.unit, canonical);
  if (!converted.ok) {
    base.state = IMG_VALUE_STATE_ABSENT;
    base.unit = canonical;
    base.display = IMG_DISPLAY_ABSENT;
    base.note = converted.reason;
    return base;
  }

  base.state = IMG_VALUE_STATE_PRESENT;
  base.unitState = IMG_UNIT_STATE_DECLARED;
  base.unit = canonical;
  base.numericValue = converted.value;
  base.converted = quantity.unit !== canonical;
  base.display =
    canonical === 'none'
      ? imgFormatNumber(converted.value)
      : imgFormatNumber(converted.value) + ' ' + canonical;
  if (base.converted) {
    base.note =
      'Convertido de ' + imgFormatNumber(quantity.value) + ' ' + quantity.unit + ' para ' + canonical + '.';
  }
  return base;
}

/**
 * Builds the whole metadata table for one imaging event.
 *
 * The instance UID is required: a metadata table with no instance identity
 * cannot be paired with the preview beside it (FM-6), and cannot be carried
 * into Offline Review (FM-5).
 */
export function imgBuildDetailRows(event: ImgImagingEvent): ImgResult<ImgDetailRows> {
  if (event === null || event === undefined) {
    return imgRefuse('IMG_EVENT_MISSING', 'Evento de imagem ausente.');
  }
  if (imgIsBlank(event.eventId)) {
    return imgRefuse(
      'IMG_EVENT_ID_BLANK',
      'Identificador do evento de imagem ausente ou em branco: painel nao pode ser vinculado a um evento.'
    );
  }
  const metadata = event.metadata;
  if (metadata === null || metadata === undefined) {
    return imgRefuse(
      'IMG_METADATA_MISSING',
      'Metadados de aquisicao ausentes: tabela vazia seria lida como aquisicao sem parametros registrados.'
    );
  }
  const uidState = imgTextValueState(metadata.instanceUid);
  if (uidState.state !== IMG_VALUE_STATE_PRESENT) {
    return imgRefuse(
      'IMG_INSTANCE_UID_MISSING',
      'UID da instancia ausente: nao e possivel garantir que a previa e a tabela sao da mesma imagem.'
    );
  }
  const modalityClass = imgClassifyModality(metadata.modality);
  if (!modalityClass.ok) {
    return imgRefuse(modalityClass.code, modalityClass.reason);
  }

  const rows: ImgDetailRow[] = [];
  let presentCount = 0;
  let absentCount = 0;
  let notApplicableCount = 0;
  let unitWarningCount = 0;

  for (let i = 0; i < IMG_ROW_CATALOGUE.length; i++) {
    const row = imgBuildDetailRow(IMG_ROW_CATALOGUE[i], metadata, modalityClass.value);
    rows.push(row);
    if (row.state === IMG_VALUE_STATE_PRESENT) {
      presentCount++;
    } else if (row.state === IMG_VALUE_STATE_ABSENT) {
      absentCount++;
    } else {
      notApplicableCount++;
    }
    if (
      row.unitState === IMG_UNIT_STATE_NOT_DECLARED ||
      row.unitState === IMG_UNIT_STATE_UNRECOGNIZED ||
      row.unitState === IMG_UNIT_STATE_INCOMPATIBLE
    ) {
      unitWarningCount++;
    }
  }

  return imgOk({
    instanceUid: uidState.text,
    modality: imgNormalizeModality(metadata.modality),
    modalityClass: modalityClass.value,
    rows,
    presentCount,
    absentCount,
    notApplicableCount,
    unitWarningCount,
  });
}

export function imgFindRow(rows: ImgDetailRows, key: string): ImgDetailRow {
  if (rows === null || rows === undefined || !rows.rows) {
    return undefined;
  }
  for (let i = 0; i < rows.rows.length; i++) {
    if (rows.rows[i].key === key) {
      return rows.rows[i];
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Session attribution (FM-1)                                          */
/* ------------------------------------------------------------------ */

export type ImgSessionConfidence = 'explicit' | 'inferred-by-time';

export const IMG_SESSION_CONFIDENCE_EXPLICIT: ImgSessionConfidence = 'explicit';
export const IMG_SESSION_CONFIDENCE_INFERRED: ImgSessionConfidence = 'inferred-by-time';

/**
 * Default tolerance around a session window is zero. Setup imaging usually
 * happens minutes before beam-on, so deployments whose session windows do not
 * already cover setup must pass an explicit tolerance. It is deliberately not
 * defaulted to "a few minutes": a silent tolerance is exactly how an image
 * taken just before session N+1 gets attributed to session N (FM-1).
 */
export const IMG_DEFAULT_SESSION_TOLERANCE_MS = 0;

export interface ImgSessionResolveOptions {
  toleranceMs?: number;
  /** Sibling imaging events of the same course, used to detect collisions. */
  peers?: ImgImagingEvent[];
}

export interface ImgSessionResolution {
  sessionId: string;
  courseId?: string;
  fractionNumber?: number;
  confidence: ImgSessionConfidence;
  /** pt-BR sentence the panel can show verbatim next to the fraction label. */
  evidence: string;
  session: ImgTreatmentSession;
  warnings: string[];
}

function imgValidateSessions(sessions: ImgTreatmentSession[]): ImgResult<ImgTreatmentSession[]> {
  if (!sessions || Object.prototype.toString.call(sessions) !== '[object Array]' || sessions.length === 0) {
    return imgRefuse(
      'IMG_SESSION_LIST_EMPTY',
      'Nenhuma sessao de tratamento informada: atribuicao da imagem a uma fracao impossivel.'
    );
  }
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    if (s === null || s === undefined || imgIsBlank(s.sessionId)) {
      return imgRefuse('IMG_SESSION_RECORD_INVALID', 'Sessao sem identificador na posicao ' + i + '.');
    }
    if (!imgIsFiniteNumber(s.startedAtMs) || !imgIsFiniteNumber(s.endedAtMs)) {
      return imgRefuse(
        'IMG_SESSION_RECORD_INVALID',
        'Sessao "' + s.sessionId + '" sem janela temporal valida: atribuicao por horario impossivel.'
      );
    }
    if (s.startedAtMs > s.endedAtMs) {
      return imgRefuse(
        'IMG_SESSION_RECORD_INVALID',
        'Sessao "' + s.sessionId + '" com inicio posterior ao fim: janela invalida.'
      );
    }
  }
  return imgOk(sessions);
}

/**
 * Resolves which treatment session (fraction) an imaging event belongs to, or
 * refuses.
 *
 * FM-1 in full: this function never picks a session when more than one is
 * possible and never invents one when none is. The harm it exists to prevent
 * is a physicist reviewing what the panel labels "fraction 12" while looking
 * at fraction 11's setup image, seeing correct positioning, and approving a
 * course in which fraction 12 actually had an uncorrected setup error.
 */
export function imgResolveSession(
  event: ImgImagingEvent,
  sessions: ImgTreatmentSession[],
  options?: ImgSessionResolveOptions
): ImgResult<ImgSessionResolution> {
  if (event === null || event === undefined) {
    return imgRefuse('IMG_EVENT_MISSING', 'Evento de imagem ausente.');
  }
  if (imgIsBlank(event.eventId)) {
    return imgRefuse('IMG_EVENT_ID_BLANK', 'Identificador do evento de imagem ausente ou em branco.');
  }
  if (event.metadata === null || event.metadata === undefined) {
    return imgRefuse('IMG_METADATA_MISSING', 'Metadados de aquisicao ausentes: atribuicao a uma fracao impossivel.');
  }
  const validated = imgValidateSessions(sessions);
  if (!validated.ok) {
    return imgRefuse(validated.code, validated.reason);
  }
  const tolerance = imgIsFiniteNumber(options && options.toleranceMs)
    ? options.toleranceMs
    : IMG_DEFAULT_SESSION_TOLERANCE_MS;
  if (tolerance < 0) {
    return imgRefuse('IMG_VALUE_NOT_FINITE', 'Tolerancia negativa nao faz sentido para uma janela de sessao.');
  }

  const metadata = event.metadata;
  const refState = imgTextValueState(metadata.sessionRef);
  const acquiredAt = metadata.acquiredAtMs;
  const warnings: string[] = [];

  /* Patient-scoped candidates only. A session belonging to another patient can
   * never be the answer, and letting it compete would let a cross-patient
   * record decide a fraction label. */
  const scoped: ImgTreatmentSession[] = [];
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    if (!imgIsBlank(event.patientId) && !imgIsBlank(s.patientId) && imgTrim(s.patientId) !== imgTrim(event.patientId)) {
      continue;
    }
    scoped.push(s);
  }
  if (scoped.length === 0) {
    return imgRefuse(
      'IMG_SESSION_PATIENT_MISMATCH',
      'Nenhuma sessao informada pertence ao paciente "' + imgTrim(event.patientId) + '".'
    );
  }

  if (refState.state === IMG_VALUE_STATE_PRESENT) {
    const ref = refState.text;
    const matches: ImgTreatmentSession[] = [];
    for (let i = 0; i < scoped.length; i++) {
      if (imgTrim(scoped[i].sessionId) === ref) {
        matches.push(scoped[i]);
      }
    }
    if (matches.length === 0) {
      return imgRefuse(
        'IMG_SESSION_REF_UNKNOWN',
        'A imagem referencia a sessao "' + ref + '", que nao existe neste curso: fracao nao confirmada.'
      );
    }
    if (matches.length > 1) {
      return imgRefuse(
        'IMG_SESSION_REF_AMBIGUOUS',
        'A referencia de sessao "' + ref + '" corresponde a ' + matches.length + ' sessoes: fracao ambigua.'
      );
    }
    const session = matches[0];
    if (
      !imgIsBlank(event.patientId) &&
      !imgIsBlank(session.patientId) &&
      imgTrim(session.patientId) !== imgTrim(event.patientId)
    ) {
      return imgRefuse(
        'IMG_SESSION_PATIENT_MISMATCH',
        'A sessao "' + ref + '" pertence a outro paciente que o evento de imagem.'
      );
    }
    if (imgIsFiniteNumber(acquiredAt)) {
      const inWindow =
        acquiredAt >= session.startedAtMs - tolerance && acquiredAt <= session.endedAtMs + tolerance;
      if (!inWindow) {
        // The record says fraction N while the clock says another fraction.
        // Choosing either one is the FM-1 harm; the panel must show the
        // conflict and let a human reconcile it.
        return imgRefuse(
          'IMG_SESSION_REF_TIME_CONFLICT',
          'A imagem referencia a sessao "' +
            ref +
            '", mas seu horario de aquisicao esta fora da janela dessa sessao: atribuicao de fracao conflitante.'
        );
      }
    } else {
      warnings.push('Horario de aquisicao ausente: a referencia de sessao nao pode ser confirmada pelo horario.');
    }
    return imgOk({
      sessionId: imgTrim(session.sessionId),
      courseId: imgIsBlank(session.courseId) ? undefined : imgTrim(session.courseId),
      fractionNumber: imgIsFiniteNumber(session.fractionNumber) ? session.fractionNumber : undefined,
      confidence: IMG_SESSION_CONFIDENCE_EXPLICIT,
      evidence: 'Sessao declarada na propria imagem ("' + ref + '").',
      session,
      warnings,
    });
  }

  if (refState.state === IMG_VALUE_STATE_NOT_APPLICABLE) {
    // "Not applicable" for a session reference is not a thing in a treatment
    // course: an image acquired in this course belongs to some session.
    return imgRefuse(
      'IMG_SESSION_REF_UNKNOWN',
      'Referencia de sessao marcada como nao aplicavel: uma imagem de tratamento sempre pertence a uma sessao.'
    );
  }

  /* No explicit reference: attribution can only be inferred from the clock. */
  if (!imgIsFiniteNumber(acquiredAt)) {
    return imgRefuse(
      'IMG_SESSION_TIMESTAMP_MISSING',
      'Imagem sem referencia de sessao e sem horario de aquisicao: fracao nao determinavel.'
    );
  }

  const peers = options && options.peers ? options.peers : [];
  for (let i = 0; i < peers.length; i++) {
    const peer = peers[i];
    if (peer === null || peer === undefined || peer.metadata === null || peer.metadata === undefined) {
      continue;
    }
    if (imgTrim(peer.eventId) === imgTrim(event.eventId)) {
      continue;
    }
    if (peer.metadata.acquiredAtMs === acquiredAt) {
      // Two images stamped at the same instant, neither carrying a session
      // reference: any time-based attribution would assign both to the same
      // fraction, and one of them belongs elsewhere.
      return imgRefuse(
        'IMG_ACQUISITION_TIMESTAMP_COLLISION',
        'Outra imagem ("' +
          imgTrim(peer.eventId) +
          '") tem exatamente o mesmo horario de aquisicao e nenhuma delas declara a sessao: fracao ambigua.'
      );
    }
  }

  const candidates: ImgTreatmentSession[] = [];
  for (let i = 0; i < scoped.length; i++) {
    const s = scoped[i];
    if (acquiredAt >= s.startedAtMs - tolerance && acquiredAt <= s.endedAtMs + tolerance) {
      candidates.push(s);
    }
  }
  if (candidates.length === 0) {
    const at = imgFormatEpochUtc(acquiredAt);
    return imgRefuse(
      'IMG_SESSION_TIME_OUTSIDE',
      'Horario de aquisicao (' +
        (at.ok ? at.value : String(acquiredAt)) +
        ') nao cai dentro de nenhuma sessao: a imagem esta entre sessoes e a fracao nao pode ser inferida.'
    );
  }
  if (candidates.length > 1) {
    return imgRefuse(
      'IMG_SESSION_TIME_AMBIGUOUS',
      'Horario de aquisicao cai dentro de ' + candidates.length + ' sessoes sobrepostas: fracao ambigua.'
    );
  }

  const only = candidates[0];
  warnings.push('Fracao inferida pelo horario de aquisicao, nao declarada pela imagem.');
  return imgOk({
    sessionId: imgTrim(only.sessionId),
    courseId: imgIsBlank(only.courseId) ? undefined : imgTrim(only.courseId),
    fractionNumber: imgIsFiniteNumber(only.fractionNumber) ? only.fractionNumber : undefined,
    confidence: IMG_SESSION_CONFIDENCE_INFERRED,
    evidence: 'Fracao inferida: horario de aquisicao dentro da janela da sessao "' + imgTrim(only.sessionId) + '".',
    session: only,
    warnings,
  });
}

export interface ImgDuplicateAcquisitionGroup {
  acquiredAtMs: number;
  eventIds: string[];
}

/**
 * Reports groups of imaging events sharing one acquisition instant. The panel
 * uses this to badge the timeline before the user clicks: the ambiguity is a
 * property of the course, not of the click (FM-1).
 */
export function imgFindDuplicateAcquisitions(
  events: ImgImagingEvent[]
): ImgResult<ImgDuplicateAcquisitionGroup[]> {
  if (!events || Object.prototype.toString.call(events) !== '[object Array]') {
    return imgRefuse('IMG_LIST_EMPTY', 'Lista de eventos de imagem ausente.');
  }
  const buckets: { [stamp: string]: string[] } = {};
  const order: number[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e === null || e === undefined || e.metadata === null || e.metadata === undefined) {
      continue;
    }
    const at = e.metadata.acquiredAtMs;
    if (!imgIsFiniteNumber(at)) {
      continue;
    }
    const key = String(at);
    if (!Object.prototype.hasOwnProperty.call(buckets, key)) {
      buckets[key] = [];
      order.push(at);
    }
    buckets[key].push(imgTrim(e.eventId));
  }
  const groups: ImgDuplicateAcquisitionGroup[] = [];
  for (let i = 0; i < order.length; i++) {
    const key = String(order[i]);
    if (buckets[key].length > 1) {
      groups.push({ acquiredAtMs: order[i], eventIds: buckets[key] });
    }
  }
  return imgOk(groups);
}

/* ------------------------------------------------------------------ */
/* Navigation (FM-4)                                                   */
/* ------------------------------------------------------------------ */

export interface ImgListFilter {
  modality?: string;
  sessionId?: string;
  fromMs?: number;
  toMs?: number;
}

export interface ImgEventList {
  events: ImgImagingEvent[];
  filter: ImgListFilter;
  filtered: boolean;
  totalCandidates: number;
  hiddenCount: number;
  /** pt-BR sentence stating what the arrows navigate within. */
  scopeLabel: string;
}

export type ImgNavigationDirection = 'backward' | 'forward';

export const IMG_NAVIGATION_BACKWARD: ImgNavigationDirection = 'backward';
export const IMG_NAVIGATION_FORWARD: ImgNavigationDirection = 'forward';
export const IMG_NAVIGATION_DIRECTIONS: ImgNavigationDirection[] = [
  IMG_NAVIGATION_BACKWARD,
  IMG_NAVIGATION_FORWARD,
];

export interface ImgNavigationOutcome {
  targetEventId: string;
  targetIndex: number;
  /** 1-based position of the target inside the navigated scope. */
  position: number;
  total: number;
  direction: ImgNavigationDirection;
  filtered: boolean;
  hiddenCount: number;
  scopeLabel: string;
}

function imgFilterMatches(event: ImgImagingEvent, filter: ImgListFilter): boolean {
  const metadata = event.metadata || {};
  if (filter && !imgIsBlank(filter.modality)) {
    if (imgNormalizeModality(metadata.modality) !== imgNormalizeModality(filter.modality)) {
      return false;
    }
  }
  if (filter && !imgIsBlank(filter.sessionId)) {
    const refState = imgTextValueState(metadata.sessionRef);
    if (refState.state !== IMG_VALUE_STATE_PRESENT || refState.text !== imgTrim(filter.sessionId)) {
      return false;
    }
  }
  if (filter && imgIsFiniteNumber(filter.fromMs)) {
    if (!imgIsFiniteNumber(metadata.acquiredAtMs) || metadata.acquiredAtMs < filter.fromMs) {
      return false;
    }
  }
  if (filter && imgIsFiniteNumber(filter.toMs)) {
    if (!imgIsFiniteNumber(metadata.acquiredAtMs) || metadata.acquiredAtMs > filter.toMs) {
      return false;
    }
  }
  return true;
}

/**
 * Describes the navigation scope in words. The panel must render this next to
 * the arrows: without it a physicist who left a modality filter on believes
 * "next image" walks the whole course and reports having reviewed images that
 * were never shown (FM-4).
 */
export function imgDescribeNavigationScope(
  shown: number,
  totalCandidates: number,
  filter: ImgListFilter
): string {
  const parts: string[] = [];
  if (filter && !imgIsBlank(filter.modality)) {
    parts.push('modalidade ' + imgNormalizeModality(filter.modality));
  }
  if (filter && !imgIsBlank(filter.sessionId)) {
    parts.push('sessao ' + imgTrim(filter.sessionId));
  }
  if (filter && (imgIsFiniteNumber(filter.fromMs) || imgIsFiniteNumber(filter.toMs))) {
    const from = imgIsFiniteNumber(filter.fromMs) ? imgFormatEpochUtc(filter.fromMs) : undefined;
    const to = imgIsFiniteNumber(filter.toMs) ? imgFormatEpochUtc(filter.toMs) : undefined;
    parts.push(
      'periodo de ' +
        (from && from.ok ? from.value : 'inicio do curso') +
        ' a ' +
        (to && to.ok ? to.value : 'fim do curso')
    );
  }
  if (parts.length === 0) {
    return 'Navegando entre todas as ' + totalCandidates + ' imagens do curso.';
  }
  return (
    'Navegando entre ' +
    shown +
    ' de ' +
    totalCandidates +
    ' imagens (filtro: ' +
    parts.join('; ') +
    '). Imagens fora do filtro nao serao exibidas pelas setas.'
  );
}

/**
 * Builds the navigable list: validates, filters and orders deterministically.
 *
 * Ordering is (acquiredAtMs, eventId). The eventId tiebreak matters: two
 * images sharing a timestamp would otherwise sit in whatever order the
 * transport delivered them, so "next" would mean different images on two
 * different loads of the same course and a physicist stepping through twice
 * would see a different sequence (FM-4).
 */
export function imgFilterEvents(events: ImgImagingEvent[], filter?: ImgListFilter): ImgResult<ImgEventList> {
  if (!events || Object.prototype.toString.call(events) !== '[object Array]' || events.length === 0) {
    return imgRefuse('IMG_LIST_EMPTY', 'Nenhum evento de imagem informado para navegacao.');
  }
  const effective: ImgListFilter = filter || {};
  if (imgIsFiniteNumber(effective.fromMs) && imgIsFiniteNumber(effective.toMs) && effective.fromMs > effective.toMs) {
    // An inverted window yields an empty list, which the panel would present as
    // "no imaging in this period" - read as "no imaging was performed".
    return imgRefuse(
      'IMG_FILTER_WINDOW_INVALID',
      'Janela de datas invertida (inicio posterior ao fim): resultado vazio seria lido como ausencia de imagens.'
    );
  }

  const seen: { [id: string]: boolean } = {};
  const patients: string[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e === null || e === undefined) {
      return imgRefuse('IMG_EVENT_MISSING', 'Evento de imagem nulo na posicao ' + i + ' da lista.');
    }
    if (imgIsBlank(e.eventId)) {
      return imgRefuse(
        'IMG_EVENT_ID_BLANK',
        'Evento sem identificador na posicao ' + i + ': navegacao nao pode localizar a imagem atual.'
      );
    }
    const id = imgTrim(e.eventId);
    if (seen[id] === true) {
      // Duplicate ids make "current" ambiguous, and the arrows then oscillate
      // between two entries while the counter advances.
      return imgRefuse(
        'IMG_LIST_DUPLICATE_ID',
        'Identificador de evento repetido na lista ("' + id + '"): posicao atual ambigua.'
      );
    }
    seen[id] = true;
    if (!imgIsBlank(e.patientId) && patients.indexOf(imgTrim(e.patientId)) < 0) {
      patients.push(imgTrim(e.patientId));
    }
  }
  if (patients.length > 1) {
    // FM-7: the arrows would step from this patient's image straight into
    // another patient's image, under this patient's panel header.
    return imgRefuse(
      'IMG_LIST_MULTIPLE_PATIENTS',
      'A lista contem imagens de ' + patients.length + ' pacientes diferentes: navegacao entre pacientes recusada.'
    );
  }

  const matched: ImgImagingEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    if (imgFilterMatches(events[i], effective)) {
      matched.push(events[i]);
    }
  }

  const unorderable: string[] = [];
  for (let i = 0; i < matched.length; i++) {
    const metadata = matched[i].metadata;
    if (!metadata || !imgIsFiniteNumber(metadata.acquiredAtMs)) {
      unorderable.push(imgTrim(matched[i].eventId));
    }
  }
  if (unorderable.length > 0) {
    // Without a timestamp an event has no defined place in the sequence; the
    // arrows would traverse an arbitrary order and the physicist would believe
    // the whole course was reviewed in chronological order.
    return imgRefuse(
      'IMG_LIST_UNORDERABLE',
      'Eventos sem horario de aquisicao valido (' +
        unorderable.join(', ') +
        '): ordem de navegacao indefinida.'
    );
  }

  const ordered = matched.slice(0).sort(function (a, b) {
    const ta = a.metadata.acquiredAtMs;
    const tb = b.metadata.acquiredAtMs;
    if (ta !== tb) {
      return ta < tb ? -1 : 1;
    }
    const ia = imgTrim(a.eventId);
    const ib = imgTrim(b.eventId);
    if (ia === ib) {
      return 0;
    }
    return ia < ib ? -1 : 1;
  });

  const isFiltered =
    !imgIsBlank(effective.modality) ||
    !imgIsBlank(effective.sessionId) ||
    imgIsFiniteNumber(effective.fromMs) ||
    imgIsFiniteNumber(effective.toMs);

  return imgOk({
    events: ordered,
    filter: effective,
    filtered: isFiltered,
    totalCandidates: events.length,
    hiddenCount: events.length - ordered.length,
    scopeLabel: imgDescribeNavigationScope(ordered.length, events.length, effective),
  });
}

export function imgIndexOfEvent(list: ImgEventList, eventId: string): number {
  if (!list || !list.events) {
    return -1;
  }
  const wanted = imgTrim(eventId);
  for (let i = 0; i < list.events.length; i++) {
    if (imgTrim(list.events[i].eventId) === wanted) {
      return i;
    }
  }
  return -1;
}

/**
 * Steps one image backward or forward inside the navigated scope.
 *
 * Never wraps. Wrapping from the last image back to the first, while the user
 * is stepping with their eyes on the image rather than on the counter, makes
 * them re-review the beginning of the course believing it is the end - and
 * report a complete review that missed nothing because nothing was missed,
 * except that half the fractions were seen twice and half not at all (FM-4).
 */
export function imgNavigate(
  list: ImgEventList,
  currentEventId: string,
  direction: ImgNavigationDirection
): ImgResult<ImgNavigationOutcome> {
  if (!list || !list.events || Object.prototype.toString.call(list.events) !== '[object Array]') {
    return imgRefuse('IMG_LIST_EMPTY', 'Lista de navegacao ausente ou invalida.');
  }
  if (direction !== IMG_NAVIGATION_BACKWARD && direction !== IMG_NAVIGATION_FORWARD) {
    return imgRefuse(
      'IMG_DIRECTION_INVALID',
      'Direcao de navegacao invalida: "' + String(direction) + '".'
    );
  }
  if (list.events.length === 0) {
    return imgRefuse(
      'IMG_LIST_EMPTY',
      'Nenhuma imagem no escopo atual. ' + (list.scopeLabel || '')
    );
  }
  if (imgIsBlank(currentEventId)) {
    return imgRefuse('IMG_EVENT_ID_BLANK', 'Imagem atual nao informada: navegacao sem ponto de partida.');
  }
  const index = imgIndexOfEvent(list, currentEventId);
  if (index < 0) {
    // The current image was filtered out of its own scope. Starting from index
    // 0 here would silently teleport the user to the first image of the filter
    // while the panel header still shows the image they were looking at.
    return imgRefuse(
      'IMG_CURRENT_NOT_IN_SCOPE',
      'A imagem atual ("' +
        imgTrim(currentEventId) +
        '") nao pertence ao escopo de navegacao. ' +
        (list.scopeLabel || '')
    );
  }
  if (direction === IMG_NAVIGATION_BACKWARD && index === 0) {
    return imgRefuse(
      'IMG_AT_FIRST',
      'Esta e a primeira imagem do escopo (1 de ' +
        list.events.length +
        '): nao existe imagem anterior. A navegacao nao circula. ' +
        (list.scopeLabel || '')
    );
  }
  if (direction === IMG_NAVIGATION_FORWARD && index === list.events.length - 1) {
    return imgRefuse(
      'IMG_AT_LAST',
      'Esta e a ultima imagem do escopo (' +
        list.events.length +
        ' de ' +
        list.events.length +
        '): nao existe imagem posterior. A navegacao nao circula. ' +
        (list.scopeLabel || '')
    );
  }
  const targetIndex = direction === IMG_NAVIGATION_FORWARD ? index + 1 : index - 1;
  return imgOk({
    targetEventId: imgTrim(list.events[targetIndex].eventId),
    targetIndex,
    position: targetIndex + 1,
    total: list.events.length,
    direction,
    filtered: list.filtered === true,
    hiddenCount: imgIsFiniteNumber(list.hiddenCount) ? list.hiddenCount : 0,
    scopeLabel: list.scopeLabel,
  });
}

/* ------------------------------------------------------------------ */
/* Preview / metadata pairing (FM-6)                                   */
/* ------------------------------------------------------------------ */

export interface ImgPreviewPairing {
  verified: true;
  instanceUid: string;
  revision?: number;
  ageMs?: number;
  verifiedAtMs?: number;
}

export interface ImgPreviewPairingOptions {
  /** Epoch ms; never read from a clock inside this module. */
  now?: number;
  maxAgeMs?: number;
}

/**
 * Verifies that the rendered preview and the metadata table describe the same
 * image instance at the same revision.
 *
 * FM-6: a preview drawn from cache beside numbers from a newer acquisition is
 * a confident wrong answer - the physicist checks the image against the kV/mAs
 * and the geometry shown next to it and signs off on a pair that never existed
 * together.
 */
export function imgVerifyPreviewPairing(
  preview: ImgPreviewRef,
  metadata: ImgAcquisitionMetadata,
  options?: ImgPreviewPairingOptions
): ImgResult<ImgPreviewPairing> {
  if (preview === null || preview === undefined) {
    return imgRefuse('IMG_PREVIEW_MISSING', 'Previa ausente: nao ha o que emparelhar com a tabela de metadados.');
  }
  if (metadata === null || metadata === undefined) {
    return imgRefuse('IMG_METADATA_MISSING', 'Metadados ausentes: emparelhamento com a previa impossivel.');
  }
  const metadataUid = imgTextValueState(metadata.instanceUid);
  if (imgIsBlank(preview.instanceUid) || metadataUid.state !== IMG_VALUE_STATE_PRESENT) {
    return imgRefuse(
      'IMG_PREVIEW_UID_MISSING',
      'UID da instancia ausente na previa ou nos metadados: nao e possivel provar que sao da mesma imagem.'
    );
  }
  if (imgTrim(preview.instanceUid) !== metadataUid.text) {
    return imgRefuse(
      'IMG_PREVIEW_MISMATCH',
      'Previa e metadados sao de instancias diferentes ("' +
        imgTrim(preview.instanceUid) +
        '" e "' +
        metadataUid.text +
        '"): exibicao recusada.'
    );
  }
  const hasRevisions = imgIsFiniteNumber(preview.revision) && imgIsFiniteNumber(metadata.revision);
  if (hasRevisions) {
    if (preview.revision < metadata.revision) {
      return imgRefuse(
        'IMG_PREVIEW_STALE_REVISION',
        'Previa em revisao ' +
          preview.revision +
          ' com metadados em revisao ' +
          metadata.revision +
          ': previa desatualizada.'
      );
    }
    if (preview.revision > metadata.revision) {
      return imgRefuse(
        'IMG_METADATA_STALE_REVISION',
        'Metadados em revisao ' +
          metadata.revision +
          ' com previa em revisao ' +
          preview.revision +
          ': tabela desatualizada.'
      );
    }
  }

  const wantsAgeCheck = options !== null && options !== undefined && imgIsFiniteNumber(options.maxAgeMs);
  let ageMs: number = undefined;
  let verifiedAtMs: number = undefined;
  if (wantsAgeCheck || (options && imgIsFiniteNumber(options.now))) {
    if (!options || !imgIsFiniteNumber(options.now)) {
      return imgRefuse(
        'IMG_NOW_INVALID',
        'Verificacao de idade da previa exige o instante atual explicito (now em ms).'
      );
    }
    verifiedAtMs = options.now;
    if (imgIsFiniteNumber(preview.renderedAtMs)) {
      ageMs = options.now - preview.renderedAtMs;
      if (ageMs < 0) {
        // A preview rendered "in the future" means the two timestamps come
        // from unsynchronised clocks; any staleness conclusion drawn from them
        // is unreliable, so no conclusion is drawn.
        return imgRefuse(
          'IMG_PREVIEW_TIMESTAMP_FUTURE',
          'Previa com instante de renderizacao posterior ao instante atual: relogios inconsistentes.'
        );
      }
      if (wantsAgeCheck && ageMs > options.maxAgeMs) {
        return imgRefuse(
          'IMG_PREVIEW_STALE_AGE',
          'Previa renderizada ha ' + ageMs + ' ms, acima do limite de ' + options.maxAgeMs + ' ms: previa possivelmente desatualizada.'
        );
      }
    } else if (wantsAgeCheck) {
      return imgRefuse(
        'IMG_PREVIEW_STALE_AGE',
        'Previa sem instante de renderizacao: idade nao verificavel com limite definido.'
      );
    }
  }

  return imgOk({
    verified: true,
    instanceUid: metadataUid.text,
    revision: hasRevisions ? metadata.revision : undefined,
    ageMs,
    verifiedAtMs,
  });
}

/* ------------------------------------------------------------------ */
/* Switch to Offline Review (FM-5)                                     */
/* ------------------------------------------------------------------ */

export interface ImgUnsavedReviewState {
  hasUnsavedNote?: boolean;
  hasApprovalInProgress?: boolean;
  noteCharacterCount?: number;
}

export type ImgUnsavedDecision = 'save' | 'discard';

export const IMG_UNSAVED_DECISION_SAVE: ImgUnsavedDecision = 'save';
export const IMG_UNSAVED_DECISION_DISCARD: ImgUnsavedDecision = 'discard';

export type ImgHandoffStatus = 'ready' | 'unsaved-review-pending';

export const IMG_HANDOFF_STATUS_READY: ImgHandoffStatus = 'ready';
export const IMG_HANDOFF_STATUS_UNSAVED_PENDING: ImgHandoffStatus = 'unsaved-review-pending';
export const IMG_HANDOFF_STATUSES: ImgHandoffStatus[] = [
  IMG_HANDOFF_STATUS_READY,
  IMG_HANDOFF_STATUS_UNSAVED_PENDING,
];

/**
 * Every field the Offline Review workspace needs in order to open on exactly
 * the thing the panel was showing. All four identity fields are required;
 * there is no "the workspace will figure it out" path (FM-5).
 */
export const IMG_REQUIRED_OFFLINE_CONTEXT_FIELDS: string[] = [
  'patientId',
  'courseId',
  'sessionId',
  'instanceUid',
];

export const IMG_OFFLINE_CONTEXT_FIELD_LABELS: { [field: string]: string } = {
  patientId: 'identificador do paciente',
  courseId: 'identificador do curso',
  sessionId: 'identificador da sessao',
  instanceUid: 'UID da instancia de imagem',
  eventId: 'identificador do evento de imagem',
};

export interface ImgOfflineReviewContext {
  patientId?: string;
  courseId?: string;
  sessionId?: string;
  instanceUid?: string;
  eventId?: string;
  /** Patient id carried by the imaging event itself, cross-checked below. */
  eventPatientId?: string;
  sessionResolution?: ImgSessionResolution;
  /** Explicit human acknowledgement that the fraction was inferred, not declared. */
  acknowledgedInferredSession?: boolean;
  previewPairing?: ImgPreviewPairing;
  unsavedReview?: ImgUnsavedReviewState;
  unsavedDecision?: ImgUnsavedDecision;
  scopeLabel?: string;
}

export interface ImgOfflineReviewHandoff {
  patientId: string;
  courseId: string;
  sessionId: string;
  instanceUid: string;
  eventId?: string;
  fractionNumber?: number;
  sessionConfidence: ImgSessionConfidence;
  scopeLabel?: string;
  requestedAtMs: number;
  /** False while a decision about unsaved review state is still pending. */
  committed: boolean;
}

export interface ImgOfflineReviewOutcome {
  status: ImgHandoffStatus;
  requiresUserDecision: boolean;
  handoff: ImgOfflineReviewHandoff;
  unsaved?: ImgUnsavedReviewState;
  warnings: string[];
}

export function imgHasUnsavedReview(state: ImgUnsavedReviewState): boolean {
  if (state === null || state === undefined) {
    return false;
  }
  if (state.hasUnsavedNote === true || state.hasApprovalInProgress === true) {
    return true;
  }
  // A note with characters in it but no dirty flag is still unsaved work; the
  // flag is set by UI code and a missed keystroke handler is a common bug.
  return imgIsFiniteNumber(state.noteCharacterCount) && state.noteCharacterCount > 0;
}

export function imgSummarizeUnsavedReview(state: ImgUnsavedReviewState): string {
  if (!imgHasUnsavedReview(state)) {
    return 'Nenhuma alteracao de revisao pendente.';
  }
  const parts: string[] = [];
  if (state.hasApprovalInProgress === true) {
    parts.push('aprovacao em andamento');
  }
  if (state.hasUnsavedNote === true || (imgIsFiniteNumber(state.noteCharacterCount) && state.noteCharacterCount > 0)) {
    parts.push('nota nao salva');
  }
  return 'Revisao com alteracoes pendentes: ' + parts.join(' e ') + '.';
}

/**
 * Prepares the switch into the Offline Review workspace.
 *
 * FM-5, both halves. Incomplete or internally inconsistent context is refused,
 * because arriving at Offline Review with a partial context lands the user on
 * a different patient's data or on a workspace they read as empty. Unsaved
 * review state is not a refusal and not a silent discard: it comes back as a
 * distinct status with `committed: false`, which the UI must resolve by
 * passing `unsavedDecision` - otherwise a half-written approval note for a
 * fraction with a setup error disappears on a workspace switch.
 */
export function imgPrepareOfflineReview(
  context: ImgOfflineReviewContext,
  now: number
): ImgResult<ImgOfflineReviewOutcome> {
  if (context === null || context === undefined) {
    return imgRefuse('IMG_CONTEXT_MISSING', 'Contexto de troca para Revisao Offline ausente.');
  }
  if (!imgIsFiniteNumber(now)) {
    // The handoff record is auditable; stamping it with NaN or with an
    // implicit clock makes the audit trail unusable in a later investigation.
    return imgRefuse('IMG_NOW_INVALID', 'Instante atual (now, em ms) ausente ou invalido.');
  }

  const missing: string[] = [];
  for (let i = 0; i < IMG_REQUIRED_OFFLINE_CONTEXT_FIELDS.length; i++) {
    const field = IMG_REQUIRED_OFFLINE_CONTEXT_FIELDS[i];
    if (imgIsBlank((context as { [key: string]: unknown })[field] as string)) {
      missing.push(IMG_OFFLINE_CONTEXT_FIELD_LABELS[field] || field);
    }
  }
  if (missing.length > 0) {
    return imgRefuse(
      'IMG_CONTEXT_INCOMPLETE',
      'Contexto incompleto para abrir a Revisao Offline: falta ' +
        missing.join(', ') +
        '. Abrir a area de trabalho sem esses dados levaria a um paciente diferente ou a uma area vazia.'
    );
  }

  if (!imgIsBlank(context.eventPatientId) && imgTrim(context.eventPatientId) !== imgTrim(context.patientId)) {
    return imgRefuse(
      'IMG_CONTEXT_PATIENT_MISMATCH',
      'O paciente do evento de imagem ("' +
        imgTrim(context.eventPatientId) +
        '") difere do paciente do contexto ("' +
        imgTrim(context.patientId) +
        '"): troca de area de trabalho recusada.'
    );
  }

  const resolution = context.sessionResolution;
  if (resolution === null || resolution === undefined || imgIsBlank(resolution.sessionId)) {
    return imgRefuse(
      'IMG_CONTEXT_SESSION_UNVERIFIED',
      'Atribuicao de fracao nao verificada: a Revisao Offline rotularia a imagem com uma fracao nao confirmada.'
    );
  }
  if (imgTrim(resolution.sessionId) !== imgTrim(context.sessionId)) {
    return imgRefuse(
      'IMG_CONTEXT_SESSION_MISMATCH',
      'A sessao resolvida ("' +
        imgTrim(resolution.sessionId) +
        '") difere da sessao do contexto ("' +
        imgTrim(context.sessionId) +
        '"): rotulo de fracao inconsistente.'
    );
  }
  if (resolution.confidence === IMG_SESSION_CONFIDENCE_INFERRED && context.acknowledgedInferredSession !== true) {
    // FM-1 carried across the workspace boundary: Offline Review shows the
    // fraction as a fact, with no trace of the inference, so the inference
    // must be acknowledged by a human before it can travel.
    return imgRefuse(
      'IMG_CONTEXT_SESSION_INFERRED',
      'A fracao foi inferida pelo horario e nao declarada pela imagem: e necessario reconhecimento explicito antes de abrir a Revisao Offline.'
    );
  }

  const pairing = context.previewPairing;
  if (
    pairing === null ||
    pairing === undefined ||
    pairing.verified !== true ||
    imgIsBlank(pairing.instanceUid) ||
    imgTrim(pairing.instanceUid) !== imgTrim(context.instanceUid)
  ) {
    return imgRefuse(
      'IMG_CONTEXT_PREVIEW_UNVERIFIED',
      'Emparelhamento previa/metadados nao verificado para esta instancia: a Revisao Offline poderia abrir outra imagem.'
    );
  }

  const warnings: string[] = [];
  for (let i = 0; i < (resolution.warnings || []).length; i++) {
    warnings.push(resolution.warnings[i]);
  }

  const unsaved = context.unsavedReview;
  const hasUnsaved = imgHasUnsavedReview(unsaved);
  const decision = context.unsavedDecision;
  if (hasUnsaved && decision !== IMG_UNSAVED_DECISION_SAVE && decision !== IMG_UNSAVED_DECISION_DISCARD) {
    return imgOk({
      status: IMG_HANDOFF_STATUS_UNSAVED_PENDING,
      requiresUserDecision: true,
      handoff: {
        patientId: imgTrim(context.patientId),
        courseId: imgTrim(context.courseId),
        sessionId: imgTrim(context.sessionId),
        instanceUid: imgTrim(context.instanceUid),
        eventId: imgIsBlank(context.eventId) ? undefined : imgTrim(context.eventId),
        fractionNumber: imgIsFiniteNumber(resolution.fractionNumber) ? resolution.fractionNumber : undefined,
        sessionConfidence: resolution.confidence,
        scopeLabel: context.scopeLabel,
        requestedAtMs: now,
        committed: false,
      },
      unsaved,
      warnings: warnings.concat([imgSummarizeUnsavedReview(unsaved)]),
    });
  }
  if (hasUnsaved && decision === IMG_UNSAVED_DECISION_DISCARD) {
    warnings.push('Revisao nao salva descartada por decisao explicita do usuario.');
  }
  if (hasUnsaved && decision === IMG_UNSAVED_DECISION_SAVE) {
    warnings.push('Revisao salva antes da troca para a Revisao Offline.');
  }

  return imgOk({
    status: IMG_HANDOFF_STATUS_READY,
    requiresUserDecision: false,
    handoff: {
      patientId: imgTrim(context.patientId),
      courseId: imgTrim(context.courseId),
      sessionId: imgTrim(context.sessionId),
      instanceUid: imgTrim(context.instanceUid),
      eventId: imgIsBlank(context.eventId) ? undefined : imgTrim(context.eventId),
      fractionNumber: imgIsFiniteNumber(resolution.fractionNumber) ? resolution.fractionNumber : undefined,
      sessionConfidence: resolution.confidence,
      scopeLabel: context.scopeLabel,
      requestedAtMs: now,
      committed: true,
    },
    unsaved: hasUnsaved ? unsaved : undefined,
    warnings,
  });
}
