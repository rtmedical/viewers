/**
 * RTV-158 - Google Cloud Healthcare DICOM Store integration: pure core.
 *
 * This module holds the whole decision layer of the GCP DICOM Store feature
 * (hierarchy picker, uploader, OAuth gating) with no HTTP client, no Google
 * SDK, no React and no browser API. It is framework-free on purpose: every
 * rule below is a patient-safety or data-protection rule, and rules that live
 * inside a component re-render, get skipped by a memo, or get bypassed by the
 * next caller.
 *
 * Failure modes this module exists to prevent:
 *
 * FM-1 - Uploading a patient into another institution's store. The GCP
 *   hierarchy is projects/{p}/locations/{l}/datasets/{d}/dicomStores/{s}, four
 *   opaque IDs with no self-describing content. A picker that keeps a stale
 *   child selection when the parent changes uploads to
 *   projectA/.../storeFromProjectB and gets a normal 200 back: a cross-tenant
 *   patient data leak with no error anywhere. So: selecting a level
 *   invalidates every descendant, building a path from a partial selection is
 *   a refusal (never a string with a hole in it), and any ID containing a
 *   path separator is refused because it silently re-parents the resource.
 *
 * FM-2 - "Upload complete" when it was not. A study missing instances still
 *   opens and still renders; the radiologist reads an incomplete study and
 *   cannot tell. So progress separates "sent" from "accepted", the terminal
 *   verdict is complete only when every planned instance is accounted for, a
 *   store-level 2xx over a body that rejects instances is not success, and a
 *   response that fails to mention an instance we sent is a refusal rather
 *   than an optimistic assumption.
 *
 * FM-3 - Retry that duplicates instead of resuming. DICOM instances are
 *   idempotent by SOP Instance UID, so retries are keyed by UID and a
 *   re-accepted instance is recorded as a duplicate acceptance, never counted
 *   twice: a double count is what turns an incomplete upload into a
 *   "complete" one. Attempts are bounded, backoff is derived from the attempt
 *   number, and a permanent rejection is never retried because retrying it
 *   forever hides it behind a spinner.
 *
 * FM-4 - OAuth scope and expiry. A token scoped for reading fails only at the
 *   moment of upload, after the user has waited and after the acquisition
 *   workflow has moved on. Required scopes are checked before the first byte,
 *   the refusal names the missing scope, expiry is evaluated against a lead
 *   margin, and the core can say "this upload cannot finish before the token
 *   expires" up front instead of dying mid-study.
 *
 * FM-5 - The empty listing. "No stores in this dataset" and "the listing
 *   query failed" look identical once both are rendered as an empty list, and
 *   the second one makes the user create a duplicate store next to the real
 *   one. "Not loaded" and "failed" are therefore distinct states from "loaded
 *   and empty", as elsewhere in this codebase.
 *
 * FM-6 - De-identification is never implied. Sending identifiable patient
 *   data to a cloud store is a regulated act (LGPD). The core carries an
 *   explicit, attributable, time-stamped decision; an upload of identifiable
 *   data without one is a refusal. No de-identification algorithm is invented
 *   here - the only thing enforced is that the decision cannot be implicit.
 *
 * FM-7 - The destination that moved. Store listings resolve asynchronously
 *   and pickers like to auto-select the first item; if the selection is read
 *   again at send time it may no longer be the store the user confirmed. The
 *   confirmed destination is therefore compared against the live selection
 *   before sending.
 *
 * FM-8 - NaN arithmetic that reads as valid. With strictNullChecks off and a
 *   missing field, every comparison against NaN is false, so a NaN "now" or a
 *   NaN byte count makes an expiry check pass and a size limit pass. Numeric
 *   inputs are therefore range-checked, not just typed.
 */

/* ------------------------------------------------------------------ */
/* Result algebra                                                      */
/* ------------------------------------------------------------------ */

export type GcpRefusalCode =
  | 'GCP_REFUSAL_INVALID_ARGUMENT'
  | 'GCP_REFUSAL_INVALID_RESOURCE_ID'
  | 'GCP_REFUSAL_ID_CONTAINS_SEPARATOR'
  | 'GCP_REFUSAL_INCOMPLETE_SELECTION'
  | 'GCP_REFUSAL_ORPHAN_SELECTION'
  | 'GCP_REFUSAL_MALFORMED_PATH'
  | 'GCP_REFUSAL_DESTINATION_CHANGED'
  | 'GCP_REFUSAL_INVALID_DICOM_UID'
  | 'GCP_REFUSAL_DUPLICATE_INSTANCE'
  | 'GCP_REFUSAL_COLLAPSED_UID_HIERARCHY'
  | 'GCP_REFUSAL_EMPTY_UPLOAD'
  | 'GCP_REFUSAL_INSTANCE_TOO_LARGE'
  | 'GCP_REFUSAL_INVALID_BATCH_LIMIT'
  | 'GCP_REFUSAL_PLAN_MISMATCH'
  | 'GCP_REFUSAL_UNKNOWN_BATCH'
  | 'GCP_REFUSAL_UNKNOWN_INSTANCE'
  | 'GCP_REFUSAL_UNSENT_INSTANCE_REPORTED'
  | 'GCP_REFUSAL_UNREPORTED_INSTANCE'
  | 'GCP_REFUSAL_RESULT_CONTRADICTION'
  | 'GCP_REFUSAL_RETRY_BUDGET_EXHAUSTED'
  | 'GCP_REFUSAL_PERMANENT_REJECTION'
  | 'GCP_REFUSAL_REAUTH_REQUIRED'
  | 'GCP_REFUSAL_MISSING_SCOPE'
  | 'GCP_REFUSAL_READ_ONLY_TOKEN'
  | 'GCP_REFUSAL_UNKNOWN_OPERATION'
  | 'GCP_REFUSAL_TOKEN_EXPIRED'
  | 'GCP_REFUSAL_TOKEN_TOO_SHORT'
  | 'GCP_REFUSAL_DEID_NOT_ACKNOWLEDGED'
  | 'GCP_REFUSAL_DEID_UNATTRIBUTED'
  | 'GCP_REFUSAL_DEID_STALE'
  | 'GCP_REFUSAL_DEID_CONTRADICTION'
  | 'GCP_REFUSAL_LISTING_NOT_LOADED'
  | 'GCP_REFUSAL_LISTING_FAILED'
  | 'GCP_REFUSAL_DUPLICATE_LISTING_ITEM';

/**
 * The `value?: undefined` / `reason?: undefined` members are load-bearing:
 * strictNullChecks is off in this repo, so a union discriminated only by a
 * boolean literal does not narrow and `result.value` would be typed on the
 * refusal arm too.
 */
export type GcpResult<T> =
  | { ok: true; value: T; code?: undefined; reason?: undefined }
  | { ok: false; code: GcpRefusalCode; reason: string; value?: undefined };

export function gcpOk<T>(value: T): GcpResult<T> {
  return { ok: true, value };
}

export function gcpRefuse<T>(code: GcpRefusalCode, reason: string): GcpResult<T> {
  return { ok: false, code, reason };
}

export const GCP_REFUSAL_CODE_LIST: GcpRefusalCode[] = [
  'GCP_REFUSAL_INVALID_ARGUMENT',
  'GCP_REFUSAL_INVALID_RESOURCE_ID',
  'GCP_REFUSAL_ID_CONTAINS_SEPARATOR',
  'GCP_REFUSAL_INCOMPLETE_SELECTION',
  'GCP_REFUSAL_ORPHAN_SELECTION',
  'GCP_REFUSAL_MALFORMED_PATH',
  'GCP_REFUSAL_DESTINATION_CHANGED',
  'GCP_REFUSAL_INVALID_DICOM_UID',
  'GCP_REFUSAL_DUPLICATE_INSTANCE',
  'GCP_REFUSAL_COLLAPSED_UID_HIERARCHY',
  'GCP_REFUSAL_EMPTY_UPLOAD',
  'GCP_REFUSAL_INSTANCE_TOO_LARGE',
  'GCP_REFUSAL_INVALID_BATCH_LIMIT',
  'GCP_REFUSAL_PLAN_MISMATCH',
  'GCP_REFUSAL_UNKNOWN_BATCH',
  'GCP_REFUSAL_UNKNOWN_INSTANCE',
  'GCP_REFUSAL_UNSENT_INSTANCE_REPORTED',
  'GCP_REFUSAL_UNREPORTED_INSTANCE',
  'GCP_REFUSAL_RESULT_CONTRADICTION',
  'GCP_REFUSAL_RETRY_BUDGET_EXHAUSTED',
  'GCP_REFUSAL_PERMANENT_REJECTION',
  'GCP_REFUSAL_REAUTH_REQUIRED',
  'GCP_REFUSAL_MISSING_SCOPE',
  'GCP_REFUSAL_READ_ONLY_TOKEN',
  'GCP_REFUSAL_UNKNOWN_OPERATION',
  'GCP_REFUSAL_TOKEN_EXPIRED',
  'GCP_REFUSAL_TOKEN_TOO_SHORT',
  'GCP_REFUSAL_DEID_NOT_ACKNOWLEDGED',
  'GCP_REFUSAL_DEID_UNATTRIBUTED',
  'GCP_REFUSAL_DEID_STALE',
  'GCP_REFUSAL_DEID_CONTRADICTION',
  'GCP_REFUSAL_LISTING_NOT_LOADED',
  'GCP_REFUSAL_LISTING_FAILED',
  'GCP_REFUSAL_DUPLICATE_LISTING_ITEM',
];

/* ------------------------------------------------------------------ */
/* Internal numeric guards (FM-8)                                      */
/* ------------------------------------------------------------------ */

function isFiniteNumber(candidate: any): boolean {
  return typeof candidate === 'number' && isFinite(candidate) && !isNaN(candidate);
}

function isNonNegativeInteger(candidate: any): boolean {
  return isFiniteNumber(candidate) && Math.floor(candidate) === candidate && candidate >= 0;
}

function isPlainObject(candidate: any): boolean {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
}

/**
 * Every epoch input crosses this gate. FM-8: with strictNullChecks off a
 * missing `now` arrives as undefined and `undefined > x` is false, so an
 * expiry check silently reports "not expired" and a long upload starts on a
 * dead token.
 */
function checkEpochMs<T>(label: string, value: any): GcpResult<T> {
  if (!isNonNegativeInteger(value)) {
    return gcpRefuse<T>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'O instante "' + label + '" deve ser um inteiro de milissegundos desde a epoca; recebido: ' + describe(value)
    );
  }
  return null;
}

function describe(value: any): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'undefined') {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return '"' + value + '"';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return 'lista de ' + value.length + ' item(ns)';
  }
  return typeof value;
}

function sortedCopy(values: string[]): string[] {
  const copy = values.slice();
  copy.sort();
  return copy;
}

/* ------------------------------------------------------------------ */
/* FM-1 - hierarchy levels, resource IDs and paths                     */
/* ------------------------------------------------------------------ */

export type GcpHierarchyLevel = 'project' | 'location' | 'dataset' | 'dicomStore';

/** Ordered ancestor-to-descendant; the order is what makes invalidation work. */
export const GCP_HIERARCHY_LEVELS: GcpHierarchyLevel[] = ['project', 'location', 'dataset', 'dicomStore'];

/** URL collection keyword for each level, as the Healthcare API spells it. */
export const GCP_LEVEL_SEGMENTS: { [level: string]: string } = {
  project: 'projects',
  location: 'locations',
  dataset: 'datasets',
  dicomStore: 'dicomStores',
};

export const GCP_MAX_PROJECT_ID_LENGTH = 30;
export const GCP_MIN_PROJECT_ID_LENGTH = 6;
export const GCP_MAX_LOCATION_ID_LENGTH = 32;
export const GCP_MAX_DATASET_ID_LENGTH = 256;
export const GCP_MAX_STORE_ID_LENGTH = 256;

/**
 * Characters that must never reach a resource path. `/` is the sharp one
 * (FM-1: an ID of "b/dicomStores/x" re-parents the resource and the request
 * still succeeds), the rest smuggle a different URL out of a valid-looking
 * picker value: `%` re-encodes a separator, `\` is a separator on the caller
 * side, `?` and `#` truncate the path, `:` starts a custom API verb, and
 * whitespace makes two visually identical stores non-identical.
 */
const GCP_FORBIDDEN_ID_CHARACTERS: string[] = ['/', '\\', '%', '?', '#', ':', '..'];

const GCP_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const GCP_LOCATION_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const GCP_DATASET_ID_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/**
 * Validates one opaque hierarchy ID. Refuses instead of sanitising: silently
 * stripping a bad character produces a *different, existing* store ID at
 * another tenant, which is the FM-1 leak with an extra step.
 */
export function gcpValidateResourceId(level: GcpHierarchyLevel, id: any): GcpResult<string> {
  if (GCP_HIERARCHY_LEVELS.indexOf(level) === -1) {
    return gcpRefuse<string>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Nivel de hierarquia desconhecido: ' + describe(level)
    );
  }
  if (typeof id !== 'string') {
    return gcpRefuse<string>(
      'GCP_REFUSAL_INVALID_RESOURCE_ID',
      'O identificador de "' + level + '" deve ser texto; recebido: ' + describe(id)
    );
  }
  if (id.length === 0) {
    return gcpRefuse<string>(
      'GCP_REFUSAL_INVALID_RESOURCE_ID',
      'O identificador de "' + level + '" esta vazio.'
    );
  }
  for (let index = 0; index < GCP_FORBIDDEN_ID_CHARACTERS.length; index += 1) {
    const forbidden = GCP_FORBIDDEN_ID_CHARACTERS[index];
    if (id.indexOf(forbidden) !== -1) {
      return gcpRefuse<string>(
        'GCP_REFUSAL_ID_CONTAINS_SEPARATOR',
        'O identificador de "' + level + '" contem o caractere proibido "' + forbidden +
          '", que reescreve o caminho do recurso e pode enviar dados para outro projeto: ' + describe(id)
      );
    }
  }
  if (/\s/.test(id)) {
    return gcpRefuse<string>(
      'GCP_REFUSAL_INVALID_RESOURCE_ID',
      'O identificador de "' + level + '" contem espaco em branco: ' + describe(id)
    );
  }
  if (level === 'project') {
    if (id.length < GCP_MIN_PROJECT_ID_LENGTH || id.length > GCP_MAX_PROJECT_ID_LENGTH) {
      return gcpRefuse<string>(
        'GCP_REFUSAL_INVALID_RESOURCE_ID',
        'O identificador de projeto deve ter entre ' + GCP_MIN_PROJECT_ID_LENGTH + ' e ' +
          GCP_MAX_PROJECT_ID_LENGTH + ' caracteres; recebido ' + id.length + '.'
      );
    }
    if (!GCP_PROJECT_ID_PATTERN.test(id)) {
      return gcpRefuse<string>(
        'GCP_REFUSAL_INVALID_RESOURCE_ID',
        'Identificador de projeto invalido (use minusculas, digitos e hifens, iniciando por letra): ' + describe(id)
      );
    }
    return gcpOk(id);
  }
  if (level === 'location') {
    if (id.length < 2 || id.length > GCP_MAX_LOCATION_ID_LENGTH) {
      return gcpRefuse<string>(
        'GCP_REFUSAL_INVALID_RESOURCE_ID',
        'O identificador de localizacao deve ter entre 2 e ' + GCP_MAX_LOCATION_ID_LENGTH +
          ' caracteres; recebido ' + id.length + '.'
      );
    }
    if (!GCP_LOCATION_ID_PATTERN.test(id)) {
      return gcpRefuse<string>(
        'GCP_REFUSAL_INVALID_RESOURCE_ID',
        'Identificador de localizacao invalido (exemplo esperado: "southamerica-east1"): ' + describe(id)
      );
    }
    return gcpOk(id);
  }
  const maxLength = level === 'dataset' ? GCP_MAX_DATASET_ID_LENGTH : GCP_MAX_STORE_ID_LENGTH;
  if (id.length > maxLength) {
    return gcpRefuse<string>(
      'GCP_REFUSAL_INVALID_RESOURCE_ID',
      'O identificador de "' + level + '" excede ' + maxLength + ' caracteres; recebido ' + id.length + '.'
    );
  }
  if (!GCP_DATASET_ID_PATTERN.test(id)) {
    return gcpRefuse<string>(
      'GCP_REFUSAL_INVALID_RESOURCE_ID',
      'Identificador de "' + level + '" invalido (letras, digitos, "_", "-" e "." apos o primeiro caractere): ' + describe(id)
    );
  }
  // A trailing dot is dropped by some HTTP stacks, so "store." and "store"
  // would resolve to two different UI entries pointing at one resource - the
  // user then believes the previous upload landed somewhere else.
  if (id.charAt(id.length - 1) === '.') {
    return gcpRefuse<string>(
      'GCP_REFUSAL_INVALID_RESOURCE_ID',
      'O identificador de "' + level + '" nao pode terminar com ponto: ' + describe(id)
    );
  }
  return gcpOk(id);
}

/**
 * A picker selection. Absent levels are absent keys, never empty strings: an
 * empty string concatenates into "datasets//dicomStores" and that path is
 * accepted by some proxies as the parent collection (FM-1).
 */
export type GcpSelection = {
  project?: string;
  location?: string;
  dataset?: string;
  dicomStore?: string;
};

export type GcpProjectPath = { project: string };
export type GcpLocationPath = { project: string; location: string };
export type GcpDatasetPath = { project: string; location: string; dataset: string };
export type GcpStorePath = { project: string; location: string; dataset: string; dicomStore: string };

export type GcpParsedPath = {
  level: GcpHierarchyLevel;
  selection: GcpSelection;
  path: string;
};

function levelIndex(level: GcpHierarchyLevel): number {
  return GCP_HIERARCHY_LEVELS.indexOf(level);
}

function selectionValue(selection: GcpSelection, level: GcpHierarchyLevel): any {
  return (selection as any)[level];
}

/**
 * Builds the canonical resource name up to `level`.
 *
 * Refuses a partial selection rather than emitting a path with a hole. FM-1:
 * a template that renders "projects/p/locations//datasets/d" reaches the API
 * as a *different, sometimes valid* resource name, and the upload lands in a
 * store nobody chose.
 */
export function gcpBuildResourcePath(selection: GcpSelection, level: GcpHierarchyLevel): GcpResult<string> {
  if (!isPlainObject(selection)) {
    return gcpRefuse<string>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'A selecao deve ser um objeto; recebido: ' + describe(selection)
    );
  }
  const target = levelIndex(level);
  if (target === -1) {
    return gcpRefuse<string>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Nivel de hierarquia desconhecido: ' + describe(level)
    );
  }
  const segments: string[] = [];
  for (let index = 0; index <= target; index += 1) {
    const current = GCP_HIERARCHY_LEVELS[index];
    const raw = selectionValue(selection, current);
    if (typeof raw === 'undefined' || raw === null || raw === '') {
      return gcpRefuse<string>(
        'GCP_REFUSAL_INCOMPLETE_SELECTION',
        'Selecao incompleta: falta escolher "' + current + '" antes de montar o caminho de "' + level + '".'
      );
    }
    const validated = gcpValidateResourceId(current, raw);
    if (!validated.ok) {
      return gcpRefuse<string>(validated.code, validated.reason);
    }
    segments.push(GCP_LEVEL_SEGMENTS[current]);
    segments.push(validated.value);
  }
  return gcpOk(segments.join('/'));
}

export function gcpBuildDatasetPath(selection: GcpSelection): GcpResult<string> {
  return gcpBuildResourcePath(selection, 'dataset');
}

export function gcpBuildStorePath(selection: GcpSelection): GcpResult<string> {
  return gcpBuildResourcePath(selection, 'dicomStore');
}

/**
 * Parses a canonical resource name back into a selection.
 *
 * Strict on shape because this is the paste-a-path entry point: a path copied
 * from another environment, or one with a trailing slash that makes the last
 * ID empty, must not become a half-populated selection that the picker then
 * "completes" with leftovers from the previous session (FM-1).
 */
export function gcpParseResourcePath(path: any): GcpResult<GcpParsedPath> {
  if (typeof path !== 'string') {
    return gcpRefuse<GcpParsedPath>(
      'GCP_REFUSAL_MALFORMED_PATH',
      'O caminho do recurso deve ser texto; recebido: ' + describe(path)
    );
  }
  if (path.length === 0) {
    return gcpRefuse<GcpParsedPath>('GCP_REFUSAL_MALFORMED_PATH', 'O caminho do recurso esta vazio.');
  }
  if (path.charAt(0) === '/' || path.charAt(path.length - 1) === '/') {
    return gcpRefuse<GcpParsedPath>(
      'GCP_REFUSAL_MALFORMED_PATH',
      'O caminho do recurso nao pode comecar nem terminar com "/": ' + describe(path)
    );
  }
  const segments = path.split('/');
  if (segments.length % 2 !== 0 || segments.length < 2 || segments.length > 8) {
    return gcpRefuse<GcpParsedPath>(
      'GCP_REFUSAL_MALFORMED_PATH',
      'O caminho deve ter pares "colecao/identificador" de 1 a 4 niveis; recebido ' + segments.length + ' segmento(s).'
    );
  }
  const selection: GcpSelection = {};
  let deepest: GcpHierarchyLevel = 'project';
  for (let pair = 0; pair * 2 < segments.length; pair += 1) {
    const expectedLevel = GCP_HIERARCHY_LEVELS[pair];
    const keyword = segments[pair * 2];
    const id = segments[pair * 2 + 1];
    if (keyword !== GCP_LEVEL_SEGMENTS[expectedLevel]) {
      return gcpRefuse<GcpParsedPath>(
        'GCP_REFUSAL_MALFORMED_PATH',
        'Segmento ' + (pair * 2 + 1) + ' deveria ser "' + GCP_LEVEL_SEGMENTS[expectedLevel] +
          '" e veio como ' + describe(keyword) + '.'
      );
    }
    const validated = gcpValidateResourceId(expectedLevel, id);
    if (!validated.ok) {
      return gcpRefuse<GcpParsedPath>(validated.code, validated.reason);
    }
    (selection as any)[expectedLevel] = validated.value;
    deepest = expectedLevel;
  }
  return gcpOk({ level: deepest, selection, path });
}

export function gcpParseStorePath(path: any): GcpResult<GcpStorePath> {
  const parsed = gcpParseResourcePath(path);
  if (!parsed.ok) {
    return gcpRefuse<GcpStorePath>(parsed.code, parsed.reason);
  }
  if (parsed.value.level !== 'dicomStore') {
    return gcpRefuse<GcpStorePath>(
      'GCP_REFUSAL_INCOMPLETE_SELECTION',
      'O caminho aponta para "' + parsed.value.level + '" e nao para um DICOM store completo: ' + describe(path)
    );
  }
  const selection = parsed.value.selection;
  return gcpOk({
    project: selection.project,
    location: selection.location,
    dataset: selection.dataset,
    dicomStore: selection.dicomStore,
  });
}

export function gcpStorePathsEqual(left: any, right: any): boolean {
  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }
  for (let index = 0; index < GCP_HIERARCHY_LEVELS.length; index += 1) {
    const level = GCP_HIERARCHY_LEVELS[index];
    if (selectionValue(left, level) !== selectionValue(right, level)) {
      return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* FM-1 - selection state machine                                      */
/* ------------------------------------------------------------------ */

export type GcpSelectionChange = {
  selection: GcpSelection;
  changed: boolean;
  invalidatedLevels: GcpHierarchyLevel[];
};

/**
 * Selects `id` at `level` and invalidates every descendant.
 *
 * The invalidation is the whole point (FM-1): the user picks project A,
 * dataset A1, store S1, then switches to project B. Store S1 does not exist
 * under project B, but the path built from the stale selection is
 * syntactically perfect and the API resolves each ID independently, so the
 * upload can land in another tenant's store and answer 200.
 *
 * Re-selecting the identical ID is a no-op that keeps descendants: a picker
 * that wipes downstream choices on every listing refresh forces the operator
 * to re-pick the store under time pressure, which is how the wrong store gets
 * picked in the first place.
 */
export function gcpSelectLevel(
  selection: GcpSelection,
  level: GcpHierarchyLevel,
  id: any
): GcpResult<GcpSelectionChange> {
  if (!isPlainObject(selection)) {
    return gcpRefuse<GcpSelectionChange>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'A selecao deve ser um objeto; recebido: ' + describe(selection)
    );
  }
  const target = levelIndex(level);
  if (target === -1) {
    return gcpRefuse<GcpSelectionChange>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Nivel de hierarquia desconhecido: ' + describe(level)
    );
  }
  const validated = gcpValidateResourceId(level, id);
  if (!validated.ok) {
    return gcpRefuse<GcpSelectionChange>(validated.code, validated.reason);
  }
  // An orphan selection is refused because the picker would hold a dataset
  // with no project; when the project is chosen later the dataset is silently
  // re-parented under it and the operator never sees the reassignment.
  for (let index = 0; index < target; index += 1) {
    const ancestor = GCP_HIERARCHY_LEVELS[index];
    const ancestorId = selectionValue(selection, ancestor);
    if (typeof ancestorId === 'undefined' || ancestorId === null || ancestorId === '') {
      return gcpRefuse<GcpSelectionChange>(
        'GCP_REFUSAL_ORPHAN_SELECTION',
        'Nao e possivel escolher "' + level + '" antes de "' + ancestor + '".'
      );
    }
  }
  const previous = selectionValue(selection, level);
  const next: GcpSelection = {};
  for (let index = 0; index < GCP_HIERARCHY_LEVELS.length; index += 1) {
    const current = GCP_HIERARCHY_LEVELS[index];
    if (index < target) {
      (next as any)[current] = selectionValue(selection, current);
    }
  }
  (next as any)[level] = validated.value;
  if (previous === validated.value) {
    for (let index = target + 1; index < GCP_HIERARCHY_LEVELS.length; index += 1) {
      const descendant = GCP_HIERARCHY_LEVELS[index];
      const kept = selectionValue(selection, descendant);
      if (typeof kept !== 'undefined' && kept !== null && kept !== '') {
        (next as any)[descendant] = kept;
      }
    }
    return gcpOk({ selection: next, changed: false, invalidatedLevels: [] });
  }
  const invalidated: GcpHierarchyLevel[] = [];
  for (let index = target + 1; index < GCP_HIERARCHY_LEVELS.length; index += 1) {
    const descendant = GCP_HIERARCHY_LEVELS[index];
    const dropped = selectionValue(selection, descendant);
    if (typeof dropped !== 'undefined' && dropped !== null && dropped !== '') {
      invalidated.push(descendant);
    }
  }
  return gcpOk({ selection: next, changed: true, invalidatedLevels: invalidated });
}

/** Clears `level` and everything below it (the "change project" button). */
export function gcpClearLevel(selection: GcpSelection, level: GcpHierarchyLevel): GcpResult<GcpSelectionChange> {
  if (!isPlainObject(selection)) {
    return gcpRefuse<GcpSelectionChange>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'A selecao deve ser um objeto; recebido: ' + describe(selection)
    );
  }
  const target = levelIndex(level);
  if (target === -1) {
    return gcpRefuse<GcpSelectionChange>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Nivel de hierarquia desconhecido: ' + describe(level)
    );
  }
  const next: GcpSelection = {};
  const invalidated: GcpHierarchyLevel[] = [];
  for (let index = 0; index < GCP_HIERARCHY_LEVELS.length; index += 1) {
    const current = GCP_HIERARCHY_LEVELS[index];
    const value = selectionValue(selection, current);
    const present = typeof value !== 'undefined' && value !== null && value !== '';
    if (index < target) {
      if (present) {
        (next as any)[current] = value;
      }
      continue;
    }
    if (present) {
      invalidated.push(current);
    }
  }
  return gcpOk({ selection: next, changed: invalidated.length > 0, invalidatedLevels: invalidated });
}

/** Deepest fully-selected level, or null when nothing is selected. */
export function gcpSelectionDepth(selection: GcpSelection): GcpHierarchyLevel {
  if (!isPlainObject(selection)) {
    return null;
  }
  let deepest: GcpHierarchyLevel = null;
  for (let index = 0; index < GCP_HIERARCHY_LEVELS.length; index += 1) {
    const level = GCP_HIERARCHY_LEVELS[index];
    const value = selectionValue(selection, level);
    if (typeof value === 'undefined' || value === null || value === '') {
      break;
    }
    deepest = level;
  }
  return deepest;
}

export function gcpSelectionIsComplete(selection: GcpSelection): boolean {
  return gcpSelectionDepth(selection) === 'dicomStore';
}

/**
 * FM-7: the destination the operator confirmed is compared against the live
 * picker selection immediately before sending. Listings resolve
 * asynchronously and pickers auto-select the first item, so the selection
 * read at send time is not always the one the confirmation dialog showed.
 */
export function gcpConfirmDestination(selection: GcpSelection, confirmedPath: any): GcpResult<GcpStorePath> {
  const confirmed = gcpParseStorePath(confirmedPath);
  if (!confirmed.ok) {
    return gcpRefuse<GcpStorePath>(confirmed.code, confirmed.reason);
  }
  const live = gcpBuildStorePath(selection);
  if (!live.ok) {
    return gcpRefuse<GcpStorePath>(live.code, live.reason);
  }
  if (live.value !== confirmed.value.dicomStore && live.value !== confirmedPath) {
    return gcpRefuse<GcpStorePath>(
      'GCP_REFUSAL_DESTINATION_CHANGED',
      'O destino confirmado (' + confirmedPath + ') nao e mais o destino selecionado (' + live.value +
        '); confirme novamente antes de enviar.'
    );
  }
  return gcpOk(confirmed.value);
}

/* ------------------------------------------------------------------ */
/* FM-5 - listing state                                                */
/* ------------------------------------------------------------------ */

export type GcpListingItem = {
  id: string;
  displayName?: string;
};

export type GcpListingStatus = 'notLoaded' | 'loading' | 'loaded' | 'failed';

export type GcpListingState = {
  level: GcpHierarchyLevel;
  status: GcpListingStatus;
  items: GcpListingItem[];
  loadedAtEpochMs?: number;
  failure?: { code: GcpRefusalCode; reason: string; atEpochMs: number };
};

export function gcpListingNotLoaded(level: GcpHierarchyLevel): GcpResult<GcpListingState> {
  if (levelIndex(level) === -1) {
    return gcpRefuse<GcpListingState>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Nivel de hierarquia desconhecido: ' + describe(level)
    );
  }
  return gcpOk({ level, status: 'notLoaded', items: [] });
}

export function gcpListingLoading(level: GcpHierarchyLevel): GcpResult<GcpListingState> {
  if (levelIndex(level) === -1) {
    return gcpRefuse<GcpListingState>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Nivel de hierarquia desconhecido: ' + describe(level)
    );
  }
  return gcpOk({ level, status: 'loading', items: [] });
}

/**
 * A successful listing. Validates each ID at the given level and refuses
 * duplicates: a repeated ID means a paginated listing replayed a page, and
 * the operator then sees two identical stores, picks one, and cannot tell
 * which of the two "previous uploads" went where (FM-5, FM-1).
 */
export function gcpListingLoaded(level: GcpHierarchyLevel, items: any, now: number): GcpResult<GcpListingState> {
  if (levelIndex(level) === -1) {
    return gcpRefuse<GcpListingState>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Nivel de hierarquia desconhecido: ' + describe(level)
    );
  }
  const epoch = checkEpochMs<GcpListingState>('now', now);
  if (epoch) {
    return epoch;
  }
  if (!Array.isArray(items)) {
    return gcpRefuse<GcpListingState>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'A listagem de "' + level + '" deve ser uma lista; recebido: ' + describe(items)
    );
  }
  const seen: { [id: string]: boolean } = {};
  const normalized: GcpListingItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!isPlainObject(item)) {
      return gcpRefuse<GcpListingState>(
        'GCP_REFUSAL_INVALID_ARGUMENT',
        'Item ' + index + ' da listagem de "' + level + '" nao e um objeto: ' + describe(item)
      );
    }
    const validated = gcpValidateResourceId(level, item.id);
    if (!validated.ok) {
      return gcpRefuse<GcpListingState>(validated.code, validated.reason);
    }
    if (seen[validated.value]) {
      return gcpRefuse<GcpListingState>(
        'GCP_REFUSAL_DUPLICATE_LISTING_ITEM',
        'A listagem de "' + level + '" repete o identificador ' + describe(validated.value) +
          '; a paginacao provavelmente reenviou uma pagina.'
      );
    }
    seen[validated.value] = true;
    const entry: GcpListingItem = { id: validated.value };
    if (typeof item.displayName === 'string') {
      entry.displayName = item.displayName;
    }
    normalized.push(entry);
  }
  return gcpOk({ level, status: 'loaded', items: normalized, loadedAtEpochMs: now });
}

export function gcpListingFailed(
  level: GcpHierarchyLevel,
  code: GcpRefusalCode,
  reason: string,
  now: number
): GcpResult<GcpListingState> {
  if (levelIndex(level) === -1) {
    return gcpRefuse<GcpListingState>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Nivel de hierarquia desconhecido: ' + describe(level)
    );
  }
  const epoch = checkEpochMs<GcpListingState>('now', now);
  if (epoch) {
    return epoch;
  }
  if (typeof reason !== 'string' || reason.length === 0) {
    return gcpRefuse<GcpListingState>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'A falha de listagem precisa de um motivo legivel para o operador.'
    );
  }
  // items stays empty AND status is "failed": FM-5 forbids collapsing the two
  // into one empty array, because "no stores here" invites the operator to
  // create a duplicate store next to the real one.
  return gcpOk({ level, status: 'failed', items: [], failure: { code, reason, atEpochMs: now } });
}

/** True only for a listing that really loaded and really has no items. */
export function gcpListingIsConfirmedEmpty(state: any): boolean {
  return isPlainObject(state) && state.status === 'loaded' && Array.isArray(state.items) && state.items.length === 0;
}

/** Reading items out of a listing is a refusal unless the listing loaded. */
export function gcpListingItems(state: any): GcpResult<GcpListingItem[]> {
  if (!isPlainObject(state)) {
    return gcpRefuse<GcpListingItem[]>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Estado de listagem invalido: ' + describe(state)
    );
  }
  if (state.status === 'failed') {
    const failureReason = state.failure && state.failure.reason ? state.failure.reason : 'motivo nao informado';
    return gcpRefuse<GcpListingItem[]>(
      'GCP_REFUSAL_LISTING_FAILED',
      'A listagem de "' + state.level + '" falhou e nao pode ser lida como vazia: ' + failureReason
    );
  }
  if (state.status !== 'loaded') {
    return gcpRefuse<GcpListingItem[]>(
      'GCP_REFUSAL_LISTING_NOT_LOADED',
      'A listagem de "' + state.level + '" ainda nao foi carregada (' + describe(state.status) + ').'
    );
  }
  return gcpOk(state.items);
}

/** Whether the UI may offer "create a new store" for this listing. */
export function gcpListingAllowsCreation(state: any): boolean {
  return gcpListingIsConfirmedEmpty(state) || (isPlainObject(state) && state.status === 'loaded');
}

/* ------------------------------------------------------------------ */
/* FM-6 - de-identification decision                                   */
/* ------------------------------------------------------------------ */

export type GcpDataSensitivity = 'identifiable' | 'deidentified';

export type GcpDeidDecision = {
  dataSensitivity: GcpDataSensitivity;
  acknowledgedIdentifiableUpload?: boolean;
  acknowledgedBy?: string;
  acknowledgedAtEpochMs?: number;
};

/** An acknowledgement older than this is not reused for the next patient. */
export const GCP_DEID_ACK_MAX_AGE_MS = 3600000;

export type GcpDeidVerdict = {
  dataSensitivity: GcpDataSensitivity;
  requiresAcknowledgement: boolean;
  acknowledgedBy?: string;
  acknowledgedAtEpochMs?: number;
};

/**
 * FM-6. Sending identifiable images to a cloud store is a regulated
 * disclosure under the LGPD, and the failure mode is that nobody ever
 * decides: the flag defaults to permissive, the upload succeeds, and the
 * institution discovers the disclosure during an audit with no record of who
 * authorised it. So the decision must be explicit, attributable and recent.
 */
export function gcpCheckDeidentificationDecision(decision: any, now: number): GcpResult<GcpDeidVerdict> {
  const epoch = checkEpochMs<GcpDeidVerdict>('now', now);
  if (epoch) {
    return epoch;
  }
  if (!isPlainObject(decision)) {
    return gcpRefuse<GcpDeidVerdict>(
      'GCP_REFUSAL_DEID_NOT_ACKNOWLEDGED',
      'Nenhuma decisao de anonimizacao foi registrada para este envio.'
    );
  }
  const sensitivity = decision.dataSensitivity;
  if (sensitivity !== 'identifiable' && sensitivity !== 'deidentified') {
    return gcpRefuse<GcpDeidVerdict>(
      'GCP_REFUSAL_DEID_NOT_ACKNOWLEDGED',
      'A sensibilidade dos dados deve ser "identifiable" ou "deidentified"; recebido: ' + describe(sensitivity)
    );
  }
  if (sensitivity === 'deidentified') {
    if (decision.acknowledgedIdentifiableUpload === true) {
      return gcpRefuse<GcpDeidVerdict>(
        'GCP_REFUSAL_DEID_CONTRADICTION',
        'Registro contraditorio: dados marcados como anonimizados com aceite de envio identificavel.'
      );
    }
    return gcpOk({ dataSensitivity: 'deidentified', requiresAcknowledgement: false });
  }
  if (decision.acknowledgedIdentifiableUpload !== true) {
    return gcpRefuse<GcpDeidVerdict>(
      'GCP_REFUSAL_DEID_NOT_ACKNOWLEDGED',
      'Envio de dados identificaveis exige aceite explicito registrado (LGPD); nenhum aceite foi informado.'
    );
  }
  // Trimmed, not raw length. A whitespace-only string is present, has a non-zero length and
  // is not an attribution: it would be stored verbatim as the person who authorised
  // disclosing identifiable patient images to a cloud store, and the audit that asks who
  // authorised it would answer with a blank. The refusal code below exists for exactly this
  // case, so it has to fire for it.
  if (typeof decision.acknowledgedBy !== 'string' || decision.acknowledgedBy.trim().length === 0) {
    return gcpRefuse<GcpDeidVerdict>(
      'GCP_REFUSAL_DEID_UNATTRIBUTED',
      'O aceite de envio identificavel precisa identificar o responsavel; nenhum operador foi registrado.'
    );
  }
  const ackEpoch = checkEpochMs<GcpDeidVerdict>('acknowledgedAtEpochMs', decision.acknowledgedAtEpochMs);
  if (ackEpoch) {
    return gcpRefuse<GcpDeidVerdict>(
      'GCP_REFUSAL_DEID_UNATTRIBUTED',
      'O aceite de envio identificavel precisa de data e hora auditaveis: ' + ackEpoch.reason
    );
  }
  if (decision.acknowledgedAtEpochMs > now) {
    return gcpRefuse<GcpDeidVerdict>(
      'GCP_REFUSAL_DEID_UNATTRIBUTED',
      'O aceite esta datado no futuro (' + decision.acknowledgedAtEpochMs + ' > ' + now +
        '), portanto nao serve como registro de auditoria.'
    );
  }
  if (now - decision.acknowledgedAtEpochMs > GCP_DEID_ACK_MAX_AGE_MS) {
    return gcpRefuse<GcpDeidVerdict>(
      'GCP_REFUSAL_DEID_STALE',
      'O aceite de envio identificavel expirou (mais de ' + GCP_DEID_ACK_MAX_AGE_MS +
        ' ms); um aceite antigo nao vale para outro paciente.'
    );
  }
  return gcpOk({
    dataSensitivity: 'identifiable',
    requiresAcknowledgement: true,
    acknowledgedBy: decision.acknowledgedBy,
    acknowledgedAtEpochMs: decision.acknowledgedAtEpochMs,
  });
}

/* ------------------------------------------------------------------ */
/* FM-4 - OAuth scopes and token lifetime                              */
/* ------------------------------------------------------------------ */

export const GCP_SCOPE_CLOUD_PLATFORM = 'https://www.googleapis.com/auth/cloud-platform';
export const GCP_SCOPE_CLOUD_PLATFORM_READ_ONLY = 'https://www.googleapis.com/auth/cloud-platform.read-only';
export const GCP_SCOPE_HEALTHCARE = 'https://www.googleapis.com/auth/cloud-healthcare';

export type GcpOperation =
  | 'listProjects'
  | 'listLocations'
  | 'listDatasets'
  | 'listDicomStores'
  | 'readStudy'
  | 'uploadInstances';

export const GCP_OPERATION_LIST: GcpOperation[] = [
  'listProjects',
  'listLocations',
  'listDatasets',
  'listDicomStores',
  'readStudy',
  'uploadInstances',
];

/** Minimum scope each operation needs, before substitutions. */
export const GCP_OPERATION_REQUIRED_SCOPES: { [operation: string]: string[] } = {
  listProjects: [GCP_SCOPE_CLOUD_PLATFORM_READ_ONLY],
  listLocations: [GCP_SCOPE_CLOUD_PLATFORM_READ_ONLY],
  listDatasets: [GCP_SCOPE_HEALTHCARE],
  listDicomStores: [GCP_SCOPE_HEALTHCARE],
  readStudy: [GCP_SCOPE_HEALTHCARE],
  uploadInstances: [GCP_SCOPE_HEALTHCARE],
};

/** Operations that mutate the store; a read-only scope can never cover these. */
export const GCP_WRITE_OPERATIONS: GcpOperation[] = ['uploadInstances'];

/**
 * Broader scopes that satisfy a requirement. cloud-platform subsumes both
 * healthcare and the read-only variant; the read-only variant subsumes
 * nothing else, which is exactly the FM-4 asymmetry - a read token must never
 * be accepted for an upload just because it lists stores fine.
 */
export const GCP_SCOPE_SUBSTITUTES: { [requiredScope: string]: string[] } = {};
GCP_SCOPE_SUBSTITUTES[GCP_SCOPE_HEALTHCARE] = [GCP_SCOPE_CLOUD_PLATFORM];
GCP_SCOPE_SUBSTITUTES[GCP_SCOPE_CLOUD_PLATFORM_READ_ONLY] = [
  GCP_SCOPE_CLOUD_PLATFORM,
  GCP_SCOPE_HEALTHCARE,
];

export const GCP_REQUIRED_UPLOAD_SCOPES: string[] = GCP_OPERATION_REQUIRED_SCOPES.uploadInstances;

export type GcpScopeCheck = {
  operation: GcpOperation;
  isWrite: boolean;
  satisfiedBy: { [requiredScope: string]: string };
};

/**
 * FM-4. Checked before the upload starts, because the alternative is a 403
 * after the operator has waited through a multi-gigabyte transfer, by which
 * point the acquisition session has moved on and the study is neither local
 * nor remote.
 */
export function gcpCheckScopes(grantedScopes: any, operation: GcpOperation): GcpResult<GcpScopeCheck> {
  if (GCP_OPERATION_LIST.indexOf(operation) === -1) {
    return gcpRefuse<GcpScopeCheck>(
      'GCP_REFUSAL_UNKNOWN_OPERATION',
      'Operacao GCP desconhecida: ' + describe(operation)
    );
  }
  if (!Array.isArray(grantedScopes)) {
    return gcpRefuse<GcpScopeCheck>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Os escopos concedidos devem ser uma lista de textos; recebido: ' + describe(grantedScopes)
    );
  }
  const granted: { [scope: string]: boolean } = {};
  for (let index = 0; index < grantedScopes.length; index += 1) {
    const scope = grantedScopes[index];
    if (typeof scope !== 'string') {
      return gcpRefuse<GcpScopeCheck>(
        'GCP_REFUSAL_INVALID_ARGUMENT',
        'Escopo ' + index + ' nao e texto: ' + describe(scope)
      );
    }
    const trimmed = scope.trim();
    if (trimmed.length > 0) {
      granted[trimmed] = true;
    }
  }
  const isWrite = GCP_WRITE_OPERATIONS.indexOf(operation) !== -1;
  const required = GCP_OPERATION_REQUIRED_SCOPES[operation];
  const satisfiedBy: { [requiredScope: string]: string } = {};
  for (let index = 0; index < required.length; index += 1) {
    const requiredScope = required[index];
    let match: string = null;
    if (granted[requiredScope]) {
      match = requiredScope;
    } else {
      const substitutes = GCP_SCOPE_SUBSTITUTES[requiredScope] || [];
      for (let sub = 0; sub < substitutes.length; sub += 1) {
        if (granted[substitutes[sub]]) {
          match = substitutes[sub];
          break;
        }
      }
    }
    if (match === null) {
      if (isWrite && granted[GCP_SCOPE_CLOUD_PLATFORM_READ_ONLY]) {
        return gcpRefuse<GcpScopeCheck>(
          'GCP_REFUSAL_READ_ONLY_TOKEN',
          'O token concedido e somente leitura (' + GCP_SCOPE_CLOUD_PLATFORM_READ_ONLY +
            ') e a operacao "' + operation + '" grava dados; falta o escopo "' + requiredScope + '".'
        );
      }
      return gcpRefuse<GcpScopeCheck>(
        'GCP_REFUSAL_MISSING_SCOPE',
        'Escopo OAuth ausente para a operacao "' + operation + '": falta "' + requiredScope + '".'
      );
    }
    satisfiedBy[requiredScope] = match;
  }
  return gcpOk({ operation, isWrite, satisfiedBy });
}

export type GcpAccessToken = {
  /**
   * Scopes and expiry only. The token string is deliberately absent: this
   * core is logged and snapshotted in tests, and a bearer token that reaches
   * a snapshot or a bug report is a live credential for a patient data store.
   */
  scopes: string[];
  expiresAtEpochMs: number;
};

/**
 * A request in flight when the token dies is lost, so the token is treated as
 * unusable this many ms before its real expiry.
 */
export const GCP_TOKEN_LEAD_MARGIN_MS = 120000;

export type GcpTokenWindow = {
  expiresAtEpochMs: number;
  remainingMs: number;
  /** Time actually usable: remaining minus the lead margin. */
  usableMs: number;
  leadMarginMs: number;
};

/**
 * Boundary note: usableMs is expiresAt - margin - now, and the token is
 * usable only when usableMs is strictly positive. A token whose usable window
 * is exactly zero is refused, because "starts right at the margin" is the
 * case where the first request is already inside the danger zone.
 */
export function gcpTokenWindow(token: any, now: number): GcpResult<GcpTokenWindow> {
  const epoch = checkEpochMs<GcpTokenWindow>('now', now);
  if (epoch) {
    return epoch;
  }
  if (!isPlainObject(token)) {
    return gcpRefuse<GcpTokenWindow>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Token de acesso invalido: ' + describe(token)
    );
  }
  const expiry = checkEpochMs<GcpTokenWindow>('expiresAtEpochMs', token.expiresAtEpochMs);
  if (expiry) {
    return expiry;
  }
  const remainingMs = token.expiresAtEpochMs - now;
  const usableMs = remainingMs - GCP_TOKEN_LEAD_MARGIN_MS;
  if (usableMs <= 0) {
    return gcpRefuse<GcpTokenWindow>(
      'GCP_REFUSAL_TOKEN_EXPIRED',
      'O token expira em ' + remainingMs + ' ms, dentro da margem de seguranca de ' + GCP_TOKEN_LEAD_MARGIN_MS +
        ' ms; renove a autenticacao antes de continuar.'
    );
  }
  return gcpOk({
    expiresAtEpochMs: token.expiresAtEpochMs,
    remainingMs,
    usableMs,
    leadMarginMs: GCP_TOKEN_LEAD_MARGIN_MS,
  });
}

export type GcpThroughputEstimate = {
  throughputBytesPerSecond: number;
  perBatchOverheadMs?: number;
};

/**
 * Duration estimate for a plan. Throughput must be strictly positive: a zero
 * or negative value yields Infinity or a negative duration, and a negative
 * duration makes every token look sufficient - which is exactly the upload
 * that dies half way through a study (FM-2 by way of FM-4).
 */
export function gcpEstimateUploadDurationMs(plan: any, estimate: any): GcpResult<number> {
  if (!isPlainObject(plan) || !Array.isArray(plan.batches) || !isFiniteNumber(plan.totalBytes)) {
    return gcpRefuse<number>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Plano de envio invalido para estimativa de duracao: ' + describe(plan)
    );
  }
  if (!isPlainObject(estimate)) {
    return gcpRefuse<number>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Estimativa de vazao invalida: ' + describe(estimate)
    );
  }
  if (!isFiniteNumber(estimate.throughputBytesPerSecond) || estimate.throughputBytesPerSecond <= 0) {
    return gcpRefuse<number>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'A vazao estimada deve ser positiva e finita; recebido: ' + describe(estimate.throughputBytesPerSecond)
    );
  }
  const overhead = typeof estimate.perBatchOverheadMs === 'undefined' ? 0 : estimate.perBatchOverheadMs;
  if (!isNonNegativeInteger(overhead)) {
    return gcpRefuse<number>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'O custo fixo por lote deve ser um inteiro nao negativo de milissegundos; recebido: ' + describe(overhead)
    );
  }
  const transferMs = Math.ceil((plan.totalBytes / estimate.throughputBytesPerSecond) * 1000);
  return gcpOk(transferMs + plan.batches.length * overhead);
}

export type GcpTokenSufficiency = {
  window: GcpTokenWindow;
  estimatedDurationMs: number;
  slackMs: number;
};

/**
 * FM-4's headline check: can this upload finish before the token dies, asked
 * before the first byte leaves. Without it a 40-minute study upload starts on
 * a token with 3 minutes left, fails at instance 900 of 1200, and leaves a
 * partial study in the cloud that opens and renders (FM-2).
 */
export function gcpTokenSufficientForUpload(
  token: any,
  now: number,
  estimatedDurationMs: any,
  operation?: GcpOperation
): GcpResult<GcpTokenSufficiency> {
  const targetOperation: GcpOperation = typeof operation === 'undefined' ? 'uploadInstances' : operation;
  if (!isPlainObject(token)) {
    return gcpRefuse<GcpTokenSufficiency>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Token de acesso invalido: ' + describe(token)
    );
  }
  const scopes = gcpCheckScopes(token.scopes, targetOperation);
  if (!scopes.ok) {
    return gcpRefuse<GcpTokenSufficiency>(scopes.code, scopes.reason);
  }
  const windowResult = gcpTokenWindow(token, now);
  if (!windowResult.ok) {
    return gcpRefuse<GcpTokenSufficiency>(windowResult.code, windowResult.reason);
  }
  if (!isNonNegativeInteger(estimatedDurationMs)) {
    return gcpRefuse<GcpTokenSufficiency>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'A duracao estimada deve ser um inteiro nao negativo de milissegundos; recebido: ' + describe(estimatedDurationMs)
    );
  }
  const slackMs = windowResult.value.usableMs - estimatedDurationMs;
  if (slackMs < 0) {
    return gcpRefuse<GcpTokenSufficiency>(
      'GCP_REFUSAL_TOKEN_TOO_SHORT',
      'O envio estimado em ' + estimatedDurationMs + ' ms nao termina antes da expiracao do token (' +
        windowResult.value.usableMs + ' ms uteis); faltam ' + (-slackMs) + ' ms. Renove a autenticacao antes de iniciar.'
    );
  }
  return gcpOk({ window: windowResult.value, estimatedDurationMs, slackMs });
}

/* ------------------------------------------------------------------ */
/* DICOM UID grammar                                                   */
/* ------------------------------------------------------------------ */

export const GCP_MAX_DICOM_UID_LENGTH = 64;

const GCP_DICOM_UID_PATTERN = /^[0-9]+(\.[0-9]+)*$/;

/**
 * DICOM UID (VR UI) grammar. Enforced because the SOP Instance UID is the
 * idempotency key of the whole uploader: a UID the store normalises
 * differently (leading zeros in a component, a trailing dot, over 64 bytes)
 * comes back under another spelling, the retry logic fails to match it, and
 * the instance is uploaded twice while the counter says one - which is how an
 * incomplete study reports complete (FM-3).
 */
export function gcpValidateDicomUid(label: string, uid: any): GcpResult<string> {
  if (typeof uid !== 'string') {
    return gcpRefuse<string>(
      'GCP_REFUSAL_INVALID_DICOM_UID',
      'O UID "' + label + '" deve ser texto; recebido: ' + describe(uid)
    );
  }
  if (uid.length === 0) {
    return gcpRefuse<string>('GCP_REFUSAL_INVALID_DICOM_UID', 'O UID "' + label + '" esta vazio.');
  }
  if (uid.length > GCP_MAX_DICOM_UID_LENGTH) {
    return gcpRefuse<string>(
      'GCP_REFUSAL_INVALID_DICOM_UID',
      'O UID "' + label + '" excede ' + GCP_MAX_DICOM_UID_LENGTH + ' caracteres; recebido ' + uid.length + '.'
    );
  }
  if (!GCP_DICOM_UID_PATTERN.test(uid)) {
    return gcpRefuse<string>(
      'GCP_REFUSAL_INVALID_DICOM_UID',
      'O UID "' + label + '" deve conter apenas digitos separados por ponto: ' + describe(uid)
    );
  }
  const components = uid.split('.');
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component.length > 1 && component.charAt(0) === '0') {
      return gcpRefuse<string>(
        'GCP_REFUSAL_INVALID_DICOM_UID',
        'O componente ' + (index + 1) + ' do UID "' + label + '" tem zero a esquerda (' + component +
          '), o que gera duas grafias para o mesmo UID.'
      );
    }
  }
  return gcpOk(uid);
}

/* ------------------------------------------------------------------ */
/* FM-2 / FM-3 - upload planning                                       */
/* ------------------------------------------------------------------ */

export const GCP_MAX_INSTANCES_PER_BATCH = 50;
export const GCP_MAX_BYTES_PER_BATCH = 52428800;

export type GcpUploadInstance = {
  sopInstanceUid: string;
  seriesInstanceUid: string;
  studyInstanceUid: string;
  byteLength: number;
};

export type GcpPlannedInstance = {
  sopInstanceUid: string;
  seriesInstanceUid: string;
  studyInstanceUid: string;
  byteLength: number;
  batchIndex: number;
};

export type GcpUploadBatch = {
  index: number;
  instanceUids: string[];
  byteLength: number;
};

export type GcpUploadPlan = {
  destination: string;
  planKey: string;
  batches: GcpUploadBatch[];
  instances: { [sopInstanceUid: string]: GcpPlannedInstance };
  totalInstances: number;
  totalBytes: number;
  studyInstanceUids: string[];
  expectedByStudy: { [studyInstanceUid: string]: number };
  maxInstancesPerBatch: number;
  maxBytesPerBatch: number;
  deidentification: GcpDeidVerdict;
};

export type GcpPlanUploadOptions = {
  selection: GcpSelection;
  deidentification: GcpDeidDecision;
  now: number;
  maxInstancesPerBatch?: number;
  maxBytesPerBatch?: number;
};

/**
 * Deterministic identity of a plan. Progress carries it so that a verdict can
 * never be computed from another upload's progress (which would report the
 * previous, finished study's numbers over the current, partial one).
 */
export function gcpPlanKey(plan: any): string {
  if (!isPlainObject(plan)) {
    return '';
  }
  return String(plan.destination) + '|' + String(plan.totalInstances) + '|' + String(plan.totalBytes);
}

/**
 * Splits instances into batches honouring both limits.
 *
 * Guard notes:
 * - A duplicate SOP Instance UID in the input is refused: two different files
 *   claiming one UID means the store keeps one and drops the other, while the
 *   counter says both landed - an instance vanishes from a study that reports
 *   complete (FM-2).
 * - A zero-byte instance is refused: it is a truncated file, and it uploads
 *   fine and then fails to render at read time.
 * - An instance larger than the batch byte limit is refused up front, because
 *   the alternative is a batch that can never be built and a progress bar
 *   that never advances past it.
 * - Limits above the store maxima are refused: a caller that raises the batch
 *   size gets the entire batch rejected, so the UI shows "1 batch sent" for
 *   zero instances stored.
 */
export function gcpPlanUpload(instances: any, options: any): GcpResult<GcpUploadPlan> {
  if (!isPlainObject(options)) {
    return gcpRefuse<GcpUploadPlan>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Opcoes de planejamento invalidas: ' + describe(options)
    );
  }
  const epoch = checkEpochMs<GcpUploadPlan>('now', options.now);
  if (epoch) {
    return epoch;
  }
  const destination = gcpBuildStorePath(options.selection);
  if (!destination.ok) {
    return gcpRefuse<GcpUploadPlan>(destination.code, destination.reason);
  }
  const deid = gcpCheckDeidentificationDecision(options.deidentification, options.now);
  if (!deid.ok) {
    return gcpRefuse<GcpUploadPlan>(deid.code, deid.reason);
  }
  const maxInstancesPerBatch =
    typeof options.maxInstancesPerBatch === 'undefined' ? GCP_MAX_INSTANCES_PER_BATCH : options.maxInstancesPerBatch;
  const maxBytesPerBatch =
    typeof options.maxBytesPerBatch === 'undefined' ? GCP_MAX_BYTES_PER_BATCH : options.maxBytesPerBatch;
  if (!isNonNegativeInteger(maxInstancesPerBatch) || maxInstancesPerBatch < 1 || maxInstancesPerBatch > GCP_MAX_INSTANCES_PER_BATCH) {
    return gcpRefuse<GcpUploadPlan>(
      'GCP_REFUSAL_INVALID_BATCH_LIMIT',
      'O limite de instancias por lote deve ser inteiro entre 1 e ' + GCP_MAX_INSTANCES_PER_BATCH +
        '; recebido: ' + describe(maxInstancesPerBatch)
    );
  }
  if (!isNonNegativeInteger(maxBytesPerBatch) || maxBytesPerBatch < 1 || maxBytesPerBatch > GCP_MAX_BYTES_PER_BATCH) {
    return gcpRefuse<GcpUploadPlan>(
      'GCP_REFUSAL_INVALID_BATCH_LIMIT',
      'O limite de bytes por lote deve ser inteiro entre 1 e ' + GCP_MAX_BYTES_PER_BATCH +
        '; recebido: ' + describe(maxBytesPerBatch)
    );
  }
  if (!Array.isArray(instances)) {
    return gcpRefuse<GcpUploadPlan>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'A lista de instancias deve ser uma lista; recebido: ' + describe(instances)
    );
  }
  // An empty plan would produce zero batches and a trivially "complete"
  // verdict: the operator sees "envio concluido" for a study that was never
  // read from disk (FM-2).
  if (instances.length === 0) {
    return gcpRefuse<GcpUploadPlan>(
      'GCP_REFUSAL_EMPTY_UPLOAD',
      'Nenhuma instancia DICOM foi selecionada para envio.'
    );
  }
  const planned: { [uid: string]: GcpPlannedInstance } = {};
  const order: GcpPlannedInstance[] = [];
  const expectedByStudy: { [uid: string]: number } = {};
  const studyUids: string[] = [];
  let totalBytes = 0;
  for (let index = 0; index < instances.length; index += 1) {
    const raw = instances[index];
    if (!isPlainObject(raw)) {
      return gcpRefuse<GcpUploadPlan>(
        'GCP_REFUSAL_INVALID_ARGUMENT',
        'Instancia ' + index + ' nao e um objeto: ' + describe(raw)
      );
    }
    const sop = gcpValidateDicomUid('SOPInstanceUID', raw.sopInstanceUid);
    if (!sop.ok) {
      return gcpRefuse<GcpUploadPlan>(sop.code, sop.reason);
    }
    const series = gcpValidateDicomUid('SeriesInstanceUID', raw.seriesInstanceUid);
    if (!series.ok) {
      return gcpRefuse<GcpUploadPlan>(series.code, series.reason);
    }
    const study = gcpValidateDicomUid('StudyInstanceUID', raw.studyInstanceUid);
    if (!study.ok) {
      return gcpRefuse<GcpUploadPlan>(study.code, study.reason);
    }
    // A broken anonymiser that reuses one UID across levels collapses the
    // patient/study/series tree: the study becomes unnavigable in the viewer
    // and instances overwrite each other in the store.
    if (sop.value === series.value || sop.value === study.value || series.value === study.value) {
      return gcpRefuse<GcpUploadPlan>(
        'GCP_REFUSAL_COLLAPSED_UID_HIERARCHY',
        'A instancia ' + index + ' reutiliza o mesmo UID em niveis diferentes (' + sop.value +
          '), o que colapsa a hierarquia estudo/serie/instancia.'
      );
    }
    if (planned[sop.value]) {
      return gcpRefuse<GcpUploadPlan>(
        'GCP_REFUSAL_DUPLICATE_INSTANCE',
        'SOPInstanceUID repetido na selecao: ' + sop.value +
          '. Dois arquivos com o mesmo UID fazem o store guardar apenas um deles.'
      );
    }
    if (!isNonNegativeInteger(raw.byteLength) || raw.byteLength <= 0) {
      return gcpRefuse<GcpUploadPlan>(
        'GCP_REFUSAL_INVALID_ARGUMENT',
        'A instancia ' + sop.value + ' tem tamanho invalido (' + describe(raw.byteLength) +
          '); um arquivo vazio ou truncado e aceito pelo store e falha na leitura.'
      );
    }
    if (raw.byteLength > maxBytesPerBatch) {
      return gcpRefuse<GcpUploadPlan>(
        'GCP_REFUSAL_INSTANCE_TOO_LARGE',
        'A instancia ' + sop.value + ' tem ' + raw.byteLength + ' bytes e nao cabe no limite de ' +
          maxBytesPerBatch + ' bytes por lote.'
      );
    }
    const entry: GcpPlannedInstance = {
      sopInstanceUid: sop.value,
      seriesInstanceUid: series.value,
      studyInstanceUid: study.value,
      byteLength: raw.byteLength,
      batchIndex: -1,
    };
    planned[sop.value] = entry;
    order.push(entry);
    totalBytes += raw.byteLength;
    if (typeof expectedByStudy[study.value] === 'undefined') {
      expectedByStudy[study.value] = 0;
      studyUids.push(study.value);
    }
    expectedByStudy[study.value] += 1;
  }
  const batches: GcpUploadBatch[] = [];
  let current: GcpUploadBatch = null;
  for (let index = 0; index < order.length; index += 1) {
    const entry = order[index];
    const fitsCount = current !== null && current.instanceUids.length < maxInstancesPerBatch;
    const fitsBytes = current !== null && current.byteLength + entry.byteLength <= maxBytesPerBatch;
    if (current === null || !fitsCount || !fitsBytes) {
      current = { index: batches.length, instanceUids: [], byteLength: 0 };
      batches.push(current);
    }
    current.instanceUids.push(entry.sopInstanceUid);
    current.byteLength += entry.byteLength;
    entry.batchIndex = current.index;
  }
  const plan: GcpUploadPlan = {
    destination: destination.value,
    planKey: '',
    batches,
    instances: planned,
    totalInstances: order.length,
    totalBytes,
    studyInstanceUids: sortedCopy(studyUids),
    expectedByStudy,
    maxInstancesPerBatch,
    maxBytesPerBatch,
    deidentification: deid.value,
  };
  plan.planKey = gcpPlanKey(plan);
  return gcpOk(plan);
}

/* ------------------------------------------------------------------ */
/* FM-2 / FM-3 - progress accumulation                                 */
/* ------------------------------------------------------------------ */

export type GcpInstanceOutcome = 'accepted' | 'retryable' | 'permanent';
export type GcpInstanceUploadState = 'pending' | 'accepted' | 'retryable' | 'permanent';

export type GcpUploadResultItem = {
  sopInstanceUid: string;
  outcome: GcpInstanceOutcome;
  httpStatus?: number;
  detail?: string;
};

export type GcpBatchResult = {
  batchIndex: number;
  /** HTTP status of the batch request itself. */
  httpStatus: number;
  /** Exactly the instances this attempt put on the wire. */
  sentInstanceUids: string[];
  /** Per-instance verdicts parsed from the response body. */
  items: GcpUploadResultItem[];
};

export type GcpInstanceUploadRecord = {
  sopInstanceUid: string;
  studyInstanceUid: string;
  byteLength: number;
  batchIndex: number;
  state: GcpInstanceUploadState;
  attempts: number;
  acceptedCount: number;
  lastDetail?: string;
};

export type GcpUploadProgress = {
  planKey: string;
  destination: string;
  expectedInstances: number;
  /** Distinct instances that have been on the wire at least once. */
  sentInstances: number;
  /** Distinct instances the store acknowledged. Never incremented twice. */
  acceptedInstances: number;
  /** Idempotent re-acceptances observed (FM-3 evidence, not a count). */
  duplicateAcceptances: number;
  permanentRejections: number;
  retryableFailures: number;
  acceptedBytes: number;
  records: { [sopInstanceUid: string]: GcpInstanceUploadRecord };
  attemptsByBatch: { [batchIndex: string]: number };
  lastUpdatedAtEpochMs: number;
};

export function gcpStartUploadProgress(plan: any, now: number): GcpResult<GcpUploadProgress> {
  const epoch = checkEpochMs<GcpUploadProgress>('now', now);
  if (epoch) {
    return epoch;
  }
  if (!isPlainObject(plan) || !isPlainObject(plan.instances) || !Array.isArray(plan.batches)) {
    return gcpRefuse<GcpUploadProgress>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Plano de envio invalido: ' + describe(plan)
    );
  }
  const records: { [uid: string]: GcpInstanceUploadRecord } = {};
  const uids = Object.keys(plan.instances);
  for (let index = 0; index < uids.length; index += 1) {
    const entry = plan.instances[uids[index]];
    records[entry.sopInstanceUid] = {
      sopInstanceUid: entry.sopInstanceUid,
      studyInstanceUid: entry.studyInstanceUid,
      byteLength: entry.byteLength,
      batchIndex: entry.batchIndex,
      state: 'pending',
      attempts: 0,
      acceptedCount: 0,
    };
  }
  return gcpOk({
    planKey: gcpPlanKey(plan),
    destination: plan.destination,
    expectedInstances: plan.totalInstances,
    sentInstances: 0,
    acceptedInstances: 0,
    duplicateAcceptances: 0,
    permanentRejections: 0,
    retryableFailures: 0,
    acceptedBytes: 0,
    records,
    attemptsByBatch: {},
    lastUpdatedAtEpochMs: now,
  });
}

export const GCP_UPLOAD_MAX_ATTEMPTS = 4;

/**
 * Which instances of a batch still need to go on the wire.
 *
 * FM-3: accepted instances are excluded, so a retry resumes instead of
 * re-sending. Instances that already burned the attempt budget are excluded
 * too, so a retry loop cannot spin forever on the same failure while the
 * progress bar sits at 99 percent.
 */
export function gcpNextSendForBatch(plan: any, progress: any, batchIndex: any): GcpResult<string[]> {
  if (!isPlainObject(plan) || !Array.isArray(plan.batches)) {
    return gcpRefuse<string[]>('GCP_REFUSAL_INVALID_ARGUMENT', 'Plano de envio invalido: ' + describe(plan));
  }
  if (!isPlainObject(progress) || !isPlainObject(progress.records)) {
    return gcpRefuse<string[]>('GCP_REFUSAL_INVALID_ARGUMENT', 'Progresso invalido: ' + describe(progress));
  }
  if (progress.planKey !== gcpPlanKey(plan)) {
    return gcpRefuse<string[]>(
      'GCP_REFUSAL_PLAN_MISMATCH',
      'O progresso pertence a outro plano de envio (' + describe(progress.planKey) + ').'
    );
  }
  if (!isNonNegativeInteger(batchIndex) || batchIndex >= plan.batches.length) {
    return gcpRefuse<string[]>(
      'GCP_REFUSAL_UNKNOWN_BATCH',
      'Lote inexistente: ' + describe(batchIndex) + ' (o plano tem ' + plan.batches.length + ' lote(s)).'
    );
  }
  const batch = plan.batches[batchIndex];
  const pending: string[] = [];
  for (let index = 0; index < batch.instanceUids.length; index += 1) {
    const uid = batch.instanceUids[index];
    const record = progress.records[uid];
    if (!record) {
      return gcpRefuse<string[]>(
        'GCP_REFUSAL_UNKNOWN_INSTANCE',
        'A instancia ' + uid + ' do lote ' + batchIndex + ' nao existe no progresso.'
      );
    }
    if (record.state === 'accepted' || record.state === 'permanent') {
      continue;
    }
    if (record.attempts >= GCP_UPLOAD_MAX_ATTEMPTS) {
      continue;
    }
    pending.push(uid);
  }
  return gcpOk(pending);
}

const GCP_RETRYABLE_HTTP_STATUSES: number[] = [408, 425, 429, 500, 502, 503, 504];
/**
 * 403 belongs here with 401, not in the permanent bucket.
 *
 * An OAuth grant that is missing the healthcare scope answers an upload with 403
 * `insufficient_scope` -- which is the exact shape FM-4 describes, a read-capable token that
 * only fails at the moment of writing. Classifying it as permanent marks every instance in
 * the batch as permanently rejected, and the operator is then told their files were refused
 * when the files are fine and the grant is wrong. Reauth is also the safe reading of the
 * other 403, a genuine IAM denial: it does not burn the retry budget, and it points at the
 * credential rather than at the study.
 */
const GCP_REAUTH_HTTP_STATUSES: number[] = [401, 403];

export type GcpTransportClass = 'success' | 'retryable' | 'permanent' | 'reauthRequired';

/**
 * Classifies a transport status. The three-way split matters: retrying a 400
 * forever hides a malformed instance behind a spinner, and retrying a 401
 * with the same dead token burns the whole budget so the operator is told
 * "tentativas esgotadas" instead of "faca login novamente" (FM-3, FM-4).
 */
export function gcpClassifyTransportStatus(httpStatus: any): GcpResult<GcpTransportClass> {
  if (!isNonNegativeInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) {
    return gcpRefuse<GcpTransportClass>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Status HTTP invalido: ' + describe(httpStatus)
    );
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    return gcpOk<GcpTransportClass>('success');
  }
  if (GCP_REAUTH_HTTP_STATUSES.indexOf(httpStatus) !== -1) {
    return gcpOk<GcpTransportClass>('reauthRequired');
  }
  if (GCP_RETRYABLE_HTTP_STATUSES.indexOf(httpStatus) !== -1) {
    return gcpOk<GcpTransportClass>('retryable');
  }
  return gcpOk<GcpTransportClass>('permanent');
}

/**
 * Folds one batch response into progress.
 *
 * This is where FM-2 is actually enforced:
 * - every instance we sent must appear in the response body, otherwise we
 *   refuse; a store-level 200 that simply omits an instance is the exact
 *   shape of "upload complete" over a study missing a slice;
 * - a 2xx status over a body containing rejections is not success, it is
 *   recorded per instance and the verdict stays incomplete;
 * - a response reporting an instance we did not send is refused, because it
 *   means responses got matched to the wrong request and counting it inflates
 *   the accepted total;
 * - an already-accepted instance reported as rejected is a refusal, because
 *   the two reports describe different bytes under one UID and picking either
 *   one silently loses an instance;
 * - re-acceptance of an accepted instance is recorded as a duplicate, not as
 *   a second acceptance (FM-3).
 */
export function gcpApplyUploadResult(
  plan: any,
  progress: any,
  result: any,
  now: number
): GcpResult<GcpUploadProgress> {
  const epoch = checkEpochMs<GcpUploadProgress>('now', now);
  if (epoch) {
    return epoch;
  }
  if (!isPlainObject(plan) || !Array.isArray(plan.batches) || !isPlainObject(plan.instances)) {
    return gcpRefuse<GcpUploadProgress>('GCP_REFUSAL_INVALID_ARGUMENT', 'Plano de envio invalido: ' + describe(plan));
  }
  if (!isPlainObject(progress) || !isPlainObject(progress.records)) {
    return gcpRefuse<GcpUploadProgress>('GCP_REFUSAL_INVALID_ARGUMENT', 'Progresso invalido: ' + describe(progress));
  }
  if (progress.planKey !== gcpPlanKey(plan)) {
    return gcpRefuse<GcpUploadProgress>(
      'GCP_REFUSAL_PLAN_MISMATCH',
      'O progresso pertence a outro plano de envio (' + describe(progress.planKey) +
        ' em vez de ' + describe(gcpPlanKey(plan)) + ').'
    );
  }
  if (!isPlainObject(result)) {
    return gcpRefuse<GcpUploadProgress>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Resultado de lote invalido: ' + describe(result)
    );
  }
  if (!isNonNegativeInteger(result.batchIndex) || result.batchIndex >= plan.batches.length) {
    return gcpRefuse<GcpUploadProgress>(
      'GCP_REFUSAL_UNKNOWN_BATCH',
      'Lote inexistente: ' + describe(result.batchIndex) + ' (o plano tem ' + plan.batches.length + ' lote(s)).'
    );
  }
  const transport = gcpClassifyTransportStatus(result.httpStatus);
  if (!transport.ok) {
    return gcpRefuse<GcpUploadProgress>(transport.code, transport.reason);
  }
  const batch = plan.batches[result.batchIndex];
  const inBatch: { [uid: string]: boolean } = {};
  for (let index = 0; index < batch.instanceUids.length; index += 1) {
    inBatch[batch.instanceUids[index]] = true;
  }
  if (!Array.isArray(result.sentInstanceUids) || result.sentInstanceUids.length === 0) {
    return gcpRefuse<GcpUploadProgress>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'O resultado precisa declarar quais instancias foram enviadas neste lote.'
    );
  }
  const sent: { [uid: string]: boolean } = {};
  for (let index = 0; index < result.sentInstanceUids.length; index += 1) {
    const uid = result.sentInstanceUids[index];
    if (!inBatch[uid]) {
      return gcpRefuse<GcpUploadProgress>(
        'GCP_REFUSAL_UNKNOWN_INSTANCE',
        'A instancia ' + describe(uid) + ' nao pertence ao lote ' + result.batchIndex + '.'
      );
    }
    if (sent[uid]) {
      return gcpRefuse<GcpUploadProgress>(
        'GCP_REFUSAL_DUPLICATE_INSTANCE',
        'A instancia ' + uid + ' aparece duas vezes na lista de enviadas do lote ' + result.batchIndex + '.'
      );
    }
    sent[uid] = true;
  }
  if (!Array.isArray(result.items)) {
    return gcpRefuse<GcpUploadProgress>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'O corpo da resposta do lote deve trazer a lista de instancias relatadas; recebido: ' + describe(result.items)
    );
  }
  const reported: { [uid: string]: GcpUploadResultItem } = {};
  for (let index = 0; index < result.items.length; index += 1) {
    const item = result.items[index];
    if (!isPlainObject(item)) {
      return gcpRefuse<GcpUploadProgress>(
        'GCP_REFUSAL_INVALID_ARGUMENT',
        'Item ' + index + ' da resposta do lote nao e um objeto: ' + describe(item)
      );
    }
    const uid = item.sopInstanceUid;
    if (typeof uid !== 'string' || !plan.instances[uid]) {
      return gcpRefuse<GcpUploadProgress>(
        'GCP_REFUSAL_UNKNOWN_INSTANCE',
        'A resposta relata a instancia ' + describe(uid) + ', que nao faz parte deste envio.'
      );
    }
    if (!sent[uid]) {
      return gcpRefuse<GcpUploadProgress>(
        'GCP_REFUSAL_UNSENT_INSTANCE_REPORTED',
        'A resposta relata a instancia ' + uid + ', que nao foi enviada neste lote; ' +
          'respostas trocadas de requisicao inflam a contagem de aceitas.'
      );
    }
    if (reported[uid]) {
      return gcpRefuse<GcpUploadProgress>(
        'GCP_REFUSAL_DUPLICATE_INSTANCE',
        'A resposta relata a instancia ' + uid + ' duas vezes no mesmo lote.'
      );
    }
    if (item.outcome !== 'accepted' && item.outcome !== 'retryable' && item.outcome !== 'permanent') {
      return gcpRefuse<GcpUploadProgress>(
        'GCP_REFUSAL_INVALID_ARGUMENT',
        'Desfecho invalido para a instancia ' + uid + ': ' + describe(item.outcome)
      );
    }
    reported[uid] = item;
  }
  const sentUids = Object.keys(sent);
  const unreported: string[] = [];
  for (let index = 0; index < sentUids.length; index += 1) {
    if (!reported[sentUids[index]]) {
      unreported.push(sentUids[index]);
    }
  }
  if (unreported.length > 0) {
    return gcpRefuse<GcpUploadProgress>(
      'GCP_REFUSAL_UNREPORTED_INSTANCE',
      'A resposta do lote ' + result.batchIndex + ' nao informa o desfecho de ' + unreported.length +
        ' instancia(s) enviada(s): ' + sortedCopy(unreported).join(', ') +
        '. Sem esse desfecho o envio nao pode ser considerado concluido.'
    );
  }
  let allAccepted = true;
  for (let index = 0; index < sentUids.length; index += 1) {
    if (reported[sentUids[index]].outcome !== 'accepted') {
      allAccepted = false;
      break;
    }
  }
  // A transport-level failure whose body claims every instance landed is a
  // contradiction: the optimistic body would mark instances accepted that
  // never reached the store.
  if (transport.value !== 'success' && allAccepted) {
    return gcpRefuse<GcpUploadProgress>(
      'GCP_REFUSAL_RESULT_CONTRADICTION',
      'O lote ' + result.batchIndex + ' retornou status ' + result.httpStatus +
        ' mas relata todas as instancias como aceitas; o envio nao pode ser contado como sucesso.'
    );
  }
  const records: { [uid: string]: GcpInstanceUploadRecord } = {};
  const existingUids = Object.keys(progress.records);
  for (let index = 0; index < existingUids.length; index += 1) {
    const uid = existingUids[index];
    const record = progress.records[uid];
    records[uid] = {
      sopInstanceUid: record.sopInstanceUid,
      studyInstanceUid: record.studyInstanceUid,
      byteLength: record.byteLength,
      batchIndex: record.batchIndex,
      state: record.state,
      attempts: record.attempts,
      acceptedCount: record.acceptedCount,
      lastDetail: record.lastDetail,
    };
  }
  let acceptedInstances = progress.acceptedInstances;
  let duplicateAcceptances = progress.duplicateAcceptances;
  let acceptedBytes = progress.acceptedBytes;
  let sentInstances = progress.sentInstances;
  for (let index = 0; index < sentUids.length; index += 1) {
    const uid = sentUids[index];
    const record = records[uid];
    if (!record) {
      return gcpRefuse<GcpUploadProgress>(
        'GCP_REFUSAL_UNKNOWN_INSTANCE',
        'A instancia ' + uid + ' nao existe no progresso deste envio.'
      );
    }
    const item = reported[uid];
    if (record.state === 'accepted' && item.outcome !== 'accepted') {
      return gcpRefuse<GcpUploadProgress>(
        'GCP_REFUSAL_RESULT_CONTRADICTION',
        'A instancia ' + uid + ' ja havia sido aceita e agora foi relatada como "' + item.outcome +
          '"; os dois relatos descrevem conteudos diferentes sob o mesmo UID.'
      );
    }
    if (record.attempts === 0) {
      sentInstances += 1;
    }
    record.attempts += 1;
    if (typeof item.detail === 'string') {
      record.lastDetail = item.detail;
    }
    if (item.outcome === 'accepted') {
      if (record.state === 'accepted') {
        // FM-3: an idempotent re-send. Counted as evidence, never as a second
        // instance, because a double count turns an incomplete upload into a
        // complete-looking one.
        duplicateAcceptances += 1;
        record.acceptedCount += 1;
      } else {
        record.state = 'accepted';
        record.acceptedCount += 1;
        acceptedInstances += 1;
        acceptedBytes += record.byteLength;
      }
      continue;
    }
    record.state = item.outcome;
  }
  let permanentRejections = 0;
  let retryableFailures = 0;
  const allUids = Object.keys(records);
  for (let index = 0; index < allUids.length; index += 1) {
    const state = records[allUids[index]].state;
    if (state === 'permanent') {
      permanentRejections += 1;
    } else if (state === 'retryable') {
      retryableFailures += 1;
    }
  }
  const attemptsByBatch: { [batchIndex: string]: number } = {};
  const batchKeys = Object.keys(progress.attemptsByBatch || {});
  for (let index = 0; index < batchKeys.length; index += 1) {
    attemptsByBatch[batchKeys[index]] = progress.attemptsByBatch[batchKeys[index]];
  }
  const key = String(result.batchIndex);
  attemptsByBatch[key] = (attemptsByBatch[key] || 0) + 1;
  return gcpOk({
    planKey: progress.planKey,
    destination: progress.destination,
    expectedInstances: progress.expectedInstances,
    sentInstances,
    acceptedInstances,
    duplicateAcceptances,
    permanentRejections,
    retryableFailures,
    acceptedBytes,
    records,
    attemptsByBatch,
    lastUpdatedAtEpochMs: now,
  });
}

/* ------------------------------------------------------------------ */
/* FM-2 - terminal verdict                                             */
/* ------------------------------------------------------------------ */

export type GcpUploadVerdictStatus = 'inProgress' | 'complete' | 'incomplete';

export type GcpStudyCompletion = {
  studyInstanceUid: string;
  expected: number;
  accepted: number;
};

export type GcpUploadVerdict = {
  status: GcpUploadVerdictStatus;
  expectedInstances: number;
  acceptedInstances: number;
  duplicateAcceptances: number;
  missingInstanceUids: string[];
  permanentlyRejectedUids: string[];
  retryExhaustedUids: string[];
  unresolvedUids: string[];
  incompleteStudies: GcpStudyCompletion[];
  /**
   * The clinical bottom line. False whenever a single planned instance is
   * unaccounted for, because an incomplete study opens and renders and the
   * radiologist has no way to notice the missing slices (FM-2).
   */
  safeToOpenInViewer: boolean;
  summary: string;
};

/**
 * The terminal verdict. "complete" requires every planned instance accepted:
 * not "no errors seen", not "all batches returned 200", and never a count
 * inflated by duplicate acceptances.
 */
export function gcpUploadVerdict(plan: any, progress: any): GcpResult<GcpUploadVerdict> {
  if (!isPlainObject(plan) || !isPlainObject(plan.instances)) {
    return gcpRefuse<GcpUploadVerdict>('GCP_REFUSAL_INVALID_ARGUMENT', 'Plano de envio invalido: ' + describe(plan));
  }
  if (!isPlainObject(progress) || !isPlainObject(progress.records)) {
    return gcpRefuse<GcpUploadVerdict>('GCP_REFUSAL_INVALID_ARGUMENT', 'Progresso invalido: ' + describe(progress));
  }
  if (progress.planKey !== gcpPlanKey(plan)) {
    return gcpRefuse<GcpUploadVerdict>(
      'GCP_REFUSAL_PLAN_MISMATCH',
      'Nao e possivel julgar este envio com o progresso de outro plano (' + describe(progress.planKey) + ').'
    );
  }
  const missing: string[] = [];
  const permanent: string[] = [];
  const exhausted: string[] = [];
  const unresolved: string[] = [];
  const acceptedByStudy: { [uid: string]: number } = {};
  const uids = sortedCopy(Object.keys(plan.instances));
  let accepted = 0;
  for (let index = 0; index < uids.length; index += 1) {
    const uid = uids[index];
    const record = progress.records[uid];
    if (!record) {
      return gcpRefuse<GcpUploadVerdict>(
        'GCP_REFUSAL_UNKNOWN_INSTANCE',
        'O progresso nao contem a instancia planejada ' + uid + '.'
      );
    }
    if (record.state === 'accepted') {
      accepted += 1;
      const study = record.studyInstanceUid;
      acceptedByStudy[study] = (acceptedByStudy[study] || 0) + 1;
      continue;
    }
    missing.push(uid);
    if (record.state === 'permanent') {
      permanent.push(uid);
      continue;
    }
    if (record.attempts >= GCP_UPLOAD_MAX_ATTEMPTS) {
      exhausted.push(uid);
      continue;
    }
    unresolved.push(uid);
  }
  const incompleteStudies: GcpStudyCompletion[] = [];
  const studyUids = sortedCopy(Object.keys(plan.expectedByStudy || {}));
  for (let index = 0; index < studyUids.length; index += 1) {
    const study = studyUids[index];
    const expected = plan.expectedByStudy[study];
    const got = acceptedByStudy[study] || 0;
    if (got !== expected) {
      incompleteStudies.push({ studyInstanceUid: study, expected, accepted: got });
    }
  }
  let status: GcpUploadVerdictStatus;
  let summary: string;
  if (missing.length === 0) {
    status = 'complete';
    summary =
      'Envio concluido: ' + accepted + ' de ' + plan.totalInstances + ' instancia(s) aceitas em ' +
      progress.destination + '.';
  } else if (unresolved.length > 0) {
    status = 'inProgress';
    summary =
      'Envio em andamento: ' + accepted + ' de ' + plan.totalInstances + ' instancia(s) aceitas, ' +
      unresolved.length + ' pendente(s).';
  } else {
    status = 'incomplete';
    const parts: string[] = [];
    parts.push(
      'Envio INCOMPLETO: ' + accepted + ' de ' + plan.totalInstances + ' instancia(s) aceitas'
    );
    if (permanent.length > 0) {
      parts.push('rejeitadas definitivamente: ' + permanent.join(', '));
    }
    if (exhausted.length > 0) {
      parts.push('sem tentativas restantes: ' + exhausted.join(', '));
    }
    if (incompleteStudies.length > 0) {
      const studyParts: string[] = [];
      for (let index = 0; index < incompleteStudies.length; index += 1) {
        const entry = incompleteStudies[index];
        studyParts.push(entry.studyInstanceUid + ' (' + entry.accepted + '/' + entry.expected + ')');
      }
      parts.push('estudos incompletos: ' + studyParts.join('; '));
    }
    parts.push('nao abra este estudo para laudo');
    summary = parts.join('. ') + '.';
  }
  return gcpOk({
    status,
    expectedInstances: plan.totalInstances,
    acceptedInstances: accepted,
    duplicateAcceptances: progress.duplicateAcceptances,
    missingInstanceUids: missing,
    permanentlyRejectedUids: permanent,
    retryExhaustedUids: exhausted,
    unresolvedUids: unresolved,
    incompleteStudies,
    safeToOpenInViewer: status === 'complete',
    summary,
  });
}

/* ------------------------------------------------------------------ */
/* FM-3 - retry policy                                                 */
/* ------------------------------------------------------------------ */

export const GCP_RETRY_BASE_DELAY_MS = 1000;
export const GCP_RETRY_MAX_DELAY_MS = 30000;
export const GCP_RETRY_MAX_JITTER_MS = 1000;

export type GcpRetryPlan = {
  attempt: number;
  shouldRetry: boolean;
  nextAttempt: number;
  delayMs: number;
  requiresReauth: boolean;
  terminalReason?: string;
};

export type GcpRetryInput = {
  attempt: number;
  outcome: 'retryable' | 'permanent' | 'reauthRequired';
  /**
   * Jitter is injected, never generated here: this core has no randomness, and
   * a non-deterministic backoff cannot be reproduced when investigating a
   * failed transfer.
   */
  jitterMs?: number;
};

/**
 * Decides whether to retry and how long to wait.
 *
 * The terminal reasons are distinct on purpose (FM-3): "rejeitada
 * definitivamente" tells the operator to fix or exclude the file, while
 * "tentativas esgotadas" tells them to retry later. Collapsing them into one
 * generic failure is what makes a malformed instance retry forever, hidden
 * behind a progress bar that never completes.
 */
export function gcpPlanRetry(input: any): GcpResult<GcpRetryPlan> {
  if (!isPlainObject(input)) {
    return gcpRefuse<GcpRetryPlan>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Entrada de politica de retentativa invalida: ' + describe(input)
    );
  }
  const attempt = input.attempt;
  if (!isNonNegativeInteger(attempt) || attempt < 1) {
    return gcpRefuse<GcpRetryPlan>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'O numero da tentativa deve ser um inteiro maior ou igual a 1; recebido: ' + describe(attempt)
    );
  }
  if (attempt > GCP_UPLOAD_MAX_ATTEMPTS) {
    return gcpRefuse<GcpRetryPlan>(
      'GCP_REFUSAL_RETRY_BUDGET_EXHAUSTED',
      'A tentativa ' + attempt + ' ja excede o limite de ' + GCP_UPLOAD_MAX_ATTEMPTS +
        ' tentativas; o envio deveria ter parado antes.'
    );
  }
  const outcome = input.outcome;
  if (outcome !== 'retryable' && outcome !== 'permanent' && outcome !== 'reauthRequired') {
    return gcpRefuse<GcpRetryPlan>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'Desfecho de tentativa invalido: ' + describe(outcome)
    );
  }
  const jitterMs = typeof input.jitterMs === 'undefined' ? 0 : input.jitterMs;
  if (!isNonNegativeInteger(jitterMs) || jitterMs > GCP_RETRY_MAX_JITTER_MS) {
    return gcpRefuse<GcpRetryPlan>(
      'GCP_REFUSAL_INVALID_ARGUMENT',
      'O jitter injetado deve ser um inteiro entre 0 e ' + GCP_RETRY_MAX_JITTER_MS + ' ms; recebido: ' + describe(jitterMs)
    );
  }
  if (outcome === 'permanent') {
    return gcpOk({
      attempt,
      shouldRetry: false,
      nextAttempt: attempt,
      delayMs: 0,
      requiresReauth: false,
      terminalReason:
        'Instancia rejeitada definitivamente pelo store; repetir o envio nao muda o resultado e apenas esconde o erro.',
    });
  }
  if (outcome === 'reauthRequired') {
    return gcpOk({
      attempt,
      shouldRetry: false,
      nextAttempt: attempt,
      delayMs: 0,
      requiresReauth: true,
      terminalReason:
        'O store recusou a credencial; e preciso renovar a autenticacao antes de qualquer nova tentativa.',
    });
  }
  if (attempt >= GCP_UPLOAD_MAX_ATTEMPTS) {
    return gcpOk({
      attempt,
      shouldRetry: false,
      nextAttempt: attempt,
      delayMs: 0,
      requiresReauth: false,
      terminalReason:
        'Tentativas esgotadas (' + GCP_UPLOAD_MAX_ATTEMPTS + ' de ' + GCP_UPLOAD_MAX_ATTEMPTS +
        '); o envio esta incompleto e precisa ser retomado mais tarde.',
    });
  }
  const exponential = GCP_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
  const capped = exponential > GCP_RETRY_MAX_DELAY_MS ? GCP_RETRY_MAX_DELAY_MS : exponential;
  return gcpOk({
    attempt,
    shouldRetry: true,
    nextAttempt: attempt + 1,
    delayMs: capped + jitterMs,
    requiresReauth: false,
  });
}

/** Whether a specific instance still has attempts left. */
export function gcpRetryBudgetRemaining(progress: any, sopInstanceUid: any): GcpResult<number> {
  if (!isPlainObject(progress) || !isPlainObject(progress.records)) {
    return gcpRefuse<number>('GCP_REFUSAL_INVALID_ARGUMENT', 'Progresso invalido: ' + describe(progress));
  }
  const record = progress.records[sopInstanceUid];
  if (!record) {
    return gcpRefuse<number>(
      'GCP_REFUSAL_UNKNOWN_INSTANCE',
      'A instancia ' + describe(sopInstanceUid) + ' nao pertence a este envio.'
    );
  }
  if (record.state === 'permanent') {
    return gcpRefuse<number>(
      'GCP_REFUSAL_PERMANENT_REJECTION',
      'A instancia ' + record.sopInstanceUid + ' foi rejeitada definitivamente e nao deve ser reenviada.'
    );
  }
  const remaining = GCP_UPLOAD_MAX_ATTEMPTS - record.attempts;
  if (remaining <= 0) {
    return gcpRefuse<number>(
      'GCP_REFUSAL_RETRY_BUDGET_EXHAUSTED',
      'A instancia ' + record.sopInstanceUid + ' esgotou as ' + GCP_UPLOAD_MAX_ATTEMPTS + ' tentativas permitidas.'
    );
  }
  return gcpOk(remaining);
}

/* ------------------------------------------------------------------ */
/* Progress event (FM-2) - emitted by the caller, never logged here    */
/* ------------------------------------------------------------------ */

export type GcpUploadProgressEvent = {
  destination: string;
  expectedInstances: number;
  sentInstances: number;
  acceptedInstances: number;
  duplicateAcceptances: number;
  /** Fraction of *accepted* instances, never of sent ones. */
  acceptedFraction: number;
  acceptedBytes: number;
  totalBytes: number;
  atEpochMs: number;
};

/**
 * Builds the value the caller emits to the UI. The fraction is computed from
 * accepted instances rather than sent ones: a bar driven by "sent" reaches
 * 100 percent while instances are still being rejected, and the operator
 * closes the dialog on an incomplete study (FM-2).
 */
export function gcpUploadProgressEvent(plan: any, progress: any, now: number): GcpResult<GcpUploadProgressEvent> {
  const epoch = checkEpochMs<GcpUploadProgressEvent>('now', now);
  if (epoch) {
    return epoch;
  }
  if (!isPlainObject(plan) || !isFiniteNumber(plan.totalInstances)) {
    return gcpRefuse<GcpUploadProgressEvent>('GCP_REFUSAL_INVALID_ARGUMENT', 'Plano de envio invalido: ' + describe(plan));
  }
  if (!isPlainObject(progress)) {
    return gcpRefuse<GcpUploadProgressEvent>('GCP_REFUSAL_INVALID_ARGUMENT', 'Progresso invalido: ' + describe(progress));
  }
  if (progress.planKey !== gcpPlanKey(plan)) {
    return gcpRefuse<GcpUploadProgressEvent>(
      'GCP_REFUSAL_PLAN_MISMATCH',
      'O progresso pertence a outro plano de envio (' + describe(progress.planKey) + ').'
    );
  }
  const fraction = plan.totalInstances === 0 ? 0 : progress.acceptedInstances / plan.totalInstances;
  return gcpOk({
    destination: plan.destination,
    expectedInstances: plan.totalInstances,
    sentInstances: progress.sentInstances,
    acceptedInstances: progress.acceptedInstances,
    duplicateAcceptances: progress.duplicateAcceptances,
    acceptedFraction: fraction,
    acceptedBytes: progress.acceptedBytes,
    totalBytes: plan.totalBytes,
    atEpochMs: now,
  });
}
