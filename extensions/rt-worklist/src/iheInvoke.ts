/**
 * Pure helpers for the IHE Invoke Image Display (IID) integration profile
 * (RTV-157) — no React, no OHIF, no browser globals beyond URLSearchParams
 * (available in every supported runtime), fully unit-testable (RTV-114
 * zero-fork discipline).
 *
 * The IID profile defines an HTTP GET "Invoke Image Display" request whose
 * query parameters select what the Image Display (this viewer) shall open:
 *
 *   requestType=STUDY&studyUID=<uid>[,<uid>...]
 *   requestType=STUDYBASE64&studyUID=<base64(uid[,uid...])>
 *   requestType=PATIENT&patientID=<id>
 *
 * Parsing is deliberately tolerant (best-effort conformance):
 *   - `requestType` values are matched case-insensitively;
 *   - parameter NAMES are also looked up case-insensitively (the profile
 *     spells them `requestType`/`studyUID`/`patientID`, but invokers in the
 *     wild disagree on casing);
 *   - repeated `studyUID` parameters are accepted in addition to the
 *     comma-separated form;
 *   - base64 values may be URL-safe (-/_) and/or unpadded;
 *   - any extra/unknown query parameters are ignored, and the
 *     deployment-driving ones (PRESERVED_QUERY_PARAMS) are carried over to
 *     the target route by studyPath()/worklistPathForPatient().
 *
 * What is NOT tolerated: study UIDs that are not valid DICOM UIDs (digits and
 * dots only, no empty items) — a malformed UID would silently open nothing in
 * the viewer, so the request is rejected up-front with a reason instead.
 */

export type IheRequest =
  | { kind: 'study'; studyUids: string[] }
  | { kind: 'patient'; patientId: string }
  | { kind: 'invalid'; reason: string };

/** Base64 → binary string decoder, injectable for pure unit tests. */
export type Base64Decode = (value: string) => string;

/**
 * DICOM UID character repertoire (PS3.5 §9.1 uses digits and '.'); kept
 * intentionally loose (no leading-zero / 64-char checks) — the goal is to
 * reject garbage, not to lint marginally non-conformant PACS UIDs.
 */
export const DICOM_UID_PATTERN = /^[0-9.]+$/;

/** Query params carried over to the target route (same set the stock OHIF
 * WorkList preserves via preserveQueryParameters). */
export const PRESERVED_QUERY_PARAMS = [
  'configUrl',
  'multimonitor',
  'screenNumber',
  'hangingProtocolId',
  'datasources',
] as const;

/** Modalities that route a study to the radiotherapy mode. */
const RT_MODALITIES = new Set(['RTPLAN', 'RTDOSE', 'RTSTRUCT', 'RTIMAGE']);

export function isValidDicomUid(uid: unknown): boolean {
  return typeof uid === 'string' && DICOM_UID_PATTERN.test(uid);
}

/**
 * Default base64 decoder: browser/jsdom `atob` when present, Node Buffer
 * otherwise. Normalizes URL-safe alphabets (-/_) and missing padding before
 * decoding; throws on anything that is still not base64.
 */
export function defaultBase64Decode(value: string): string {
  const normalized = String(value ?? '')
    .trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded) || padded.length % 4 !== 0) {
    throw new Error('Invalid base64 value');
  }
  const atobImpl = (globalThis as { atob?: Base64Decode }).atob;
  if (typeof atobImpl === 'function') {
    return atobImpl(padded);
  }
  // Node without atob (very old runtimes) — Buffer is always there.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return Buffer.from(padded, 'base64').toString('binary');
}

/** All values of a query parameter, with the NAME matched case-insensitively. */
function getAllParamsCaseInsensitive(params: URLSearchParams, name: string): string[] {
  const wanted = name.toLowerCase();
  const values: string[] = [];
  params.forEach((value, key) => {
    if (key.toLowerCase() === wanted) {
      values.push(value);
    }
  });
  return values;
}

/** Split raw studyUID values on commas, trim, drop empties, de-duplicate. */
function splitStudyUids(rawValues: string[]): string[] {
  const uids: string[] = [];
  for (const raw of rawValues) {
    for (const token of String(raw ?? '').split(',')) {
      const uid = token.trim();
      if (uid && !uids.includes(uid)) {
        uids.push(uid);
      }
    }
  }
  return uids;
}

/**
 * Parse an IHE IID request from a URL query string (`location.search`, with
 * or without the leading '?').
 *
 * @param search - the raw query string of the invocation URL.
 * @param decode - base64 decoder (injected in tests; defaults to atob/Buffer).
 * @returns a discriminated union: 'study' (validated Study Instance UIDs),
 *   'patient' (PatientID as sent — HL7 CX values pass through untouched), or
 *   'invalid' with a human-readable reason.
 */
export function parseIheRequest(
  search: string,
  decode: Base64Decode = defaultBase64Decode
): IheRequest {
  const params = new URLSearchParams(search ?? '');

  const requestTypeRaw = getAllParamsCaseInsensitive(params, 'requestType')
    .map(value => value.trim())
    .find(Boolean);
  if (!requestTypeRaw) {
    return { kind: 'invalid', reason: 'Missing requestType parameter.' };
  }
  const requestType = requestTypeRaw.toUpperCase();

  if (requestType === 'STUDY' || requestType === 'STUDYBASE64') {
    let rawValues = getAllParamsCaseInsensitive(params, 'studyUID')
      .map(value => value.trim())
      .filter(Boolean);
    if (rawValues.length === 0) {
      return {
        kind: 'invalid',
        reason: `Missing studyUID parameter for requestType=${requestType}.`,
      };
    }
    if (requestType === 'STUDYBASE64') {
      try {
        rawValues = rawValues.map(value => decode(value));
      } catch (error) {
        return {
          kind: 'invalid',
          reason: 'studyUID is not valid base64 (requestType=STUDYBASE64).',
        };
      }
    }
    const studyUids = splitStudyUids(rawValues);
    if (studyUids.length === 0) {
      return { kind: 'invalid', reason: 'studyUID contains no Study Instance UIDs.' };
    }
    const invalid = studyUids.find(uid => !isValidDicomUid(uid));
    if (invalid !== undefined) {
      return {
        kind: 'invalid',
        reason: `Invalid Study Instance UID "${invalid}" (digits and dots only).`,
      };
    }
    return { kind: 'study', studyUids };
  }

  if (requestType === 'PATIENT') {
    const patientId = getAllParamsCaseInsensitive(params, 'patientID')
      .map(value => value.trim())
      .find(Boolean);
    if (!patientId) {
      return { kind: 'invalid', reason: 'Missing patientID parameter for requestType=PATIENT.' };
    }
    return { kind: 'patient', patientId };
  }

  return {
    kind: 'invalid',
    reason: `Unsupported requestType "${requestTypeRaw}" (expected STUDY, STUDYBASE64 or PATIENT).`,
  };
}

/**
 * Mode auto-selection (RTV-157 acceptance): a study set containing any
 * radiotherapy modality (RTPLAN/RTDOSE/RTSTRUCT/RTIMAGE) opens in the
 * radiotherapy mode; everything else (including an EMPTY list — e.g. when
 * QIDO failed and modalities are unknown) opens in the radiology mode.
 */
export function modeRouteForStudy(modalities: string[]): string {
  const hasRt = (modalities || []).some(modality =>
    RT_MODALITIES.has(String(modality ?? '').trim().toUpperCase())
  );
  return hasRt ? 'rtmedical-radiotherapy' : 'rtmedical-radiology';
}

/** Copy the deployment-driving params of `currentSearch` into `query`. */
function preserveQueryParams(query: URLSearchParams, currentSearch: string): void {
  try {
    const current = new URLSearchParams(currentSearch ?? '');
    for (const key of PRESERVED_QUERY_PARAMS) {
      const value = current.get(key);
      if (value) {
        query.set(key, value);
      }
    }
  } catch (error) {
    /* preservation is best-effort — never block navigation on it */
  }
}

/**
 * Build the viewer-mode path for one or more studies. Navigation MUST go
 * through the react-router navigate() with this app-relative path: the app
 * mounts under a basename (production serves at /viewer), so a raw
 * location.href would 404. Deployment-driving params (configUrl,
 * datasources, ...) are preserved from `currentSearch` like the stock list.
 */
export function studyPath(
  routeName: string,
  studyUids: string | string[],
  currentSearch: string = ''
): string {
  const uids = Array.isArray(studyUids) ? studyUids : [studyUids];
  const query = new URLSearchParams();
  query.set('StudyInstanceUIDs', uids.join(','));
  preserveQueryParams(query, currentSearch);
  return `/${routeName}?${query.toString()}`;
}

/**
 * Path to the RT worklist pre-filtered by MRN — the PATIENT fallback when an
 * IID request resolves to zero or multiple studies (the user picks there).
 */
export function worklistPathForPatient(patientId: string, currentSearch: string = ''): string {
  const query = new URLSearchParams();
  query.set('mrn', patientId);
  preserveQueryParams(query, currentSearch);
  return `/worklist-rt?${query.toString()}`;
}
