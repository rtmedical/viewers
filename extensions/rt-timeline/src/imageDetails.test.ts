import {
  IMG_DISPLAY_ABSENT,
  IMG_DISPLAY_NOT_APPLICABLE,
  IMG_NAVIGATION_BACKWARD,
  IMG_NAVIGATION_FORWARD,
  IMG_REQUIRED_OFFLINE_CONTEXT_FIELDS,
  IMG_SESSION_CONFIDENCE_EXPLICIT,
  IMG_SESSION_CONFIDENCE_INFERRED,
  IMG_UNIT_STATE_DECLARED,
  IMG_UNIT_STATE_NOT_DECLARED,
  IMG_UNIT_STATE_UNRECOGNIZED,
  IMG_VALUE_STATE_ABSENT,
  IMG_VALUE_STATE_NOT_APPLICABLE,
  IMG_VALUE_STATE_PRESENT,
  imgBuildDetailRows,
  imgConvertCGyToGy,
  imgConvertCmToMm,
  imgConvertGyToCGy,
  imgConvertMmToCm,
  imgConvertMsToSeconds,
  imgConvertSecondsToMs,
  imgConvertUnitValue,
  imgFilterEvents,
  imgFindDuplicateAcquisitions,
  imgFindRow,
  imgHasUnsavedReview,
  imgNavigate,
  imgPrepareOfflineReview,
  imgResolveSession,
  imgVerifyPreviewPairing,
  type ImgImagingEvent,
  type ImgOfflineReviewContext,
  type ImgTreatmentSession,
} from './imageDetails';

const T0 = 1_760_000_000_000;
const MIN = 60_000;

function event(over: Partial<ImgImagingEvent> = {}): ImgImagingEvent {
  return {
    eventId: 'EV-1',
    patientId: 'PAC-1',
    courseId: 'CUR-1',
    metadata: {
      instanceUid: '1.2.840.1.1',
      modality: 'KV',
      acquiredAtMs: T0 + 5 * MIN,
      machineName: 'TrueBeam-1',
      sessionRef: 'SES-12',
      fractionNumber: 12,
      kvp: { value: 120, unit: 'kV' },
      tubeCurrent: { value: 80, unit: 'mA' },
      exposure: { value: 25, unit: 'mAs' },
      exposureTime: { value: 320, unit: 'ms' },
      sid: { value: 1000, unit: 'mm' },
      gantryAngle: { value: 0, unit: 'deg' },
      imagingDose: { value: 1.2, unit: 'cGy' },
      revision: 3,
    },
    preview: { instanceUid: '1.2.840.1.1', revision: 3, renderedAtMs: T0 + 6 * MIN },
    ...over,
  };
}

function session(over: Partial<ImgTreatmentSession> = {}): ImgTreatmentSession {
  return {
    sessionId: 'SES-12',
    patientId: 'PAC-1',
    courseId: 'CUR-1',
    fractionNumber: 12,
    startedAtMs: T0,
    endedAtMs: T0 + 20 * MIN,
    ...over,
  };
}

/* ------------------------------------------------------------------ */

describe('imgConvertUnitValue, FM-3', () => {
  it('converts cm to mm by ten', () => {
    expect(imgConvertCmToMm(1.5).value).toBe(15);
  });

  it('converts mm to cm by ten', () => {
    expect(imgConvertMmToCm(15).value).toBe(1.5);
  });

  it('converts seconds to ms by a thousand', () => {
    expect(imgConvertSecondsToMs(0.32).value).toBe(320);
  });

  it('converts ms to seconds by a thousand', () => {
    expect(imgConvertMsToSeconds(320).value).toBe(0.32);
  });

  it('converts Gy to cGy by a hundred, the factor a wrong guess of ten would spoil', () => {
    expect(imgConvertGyToCGy(0.02).value).toBe(2);
  });

  it('converts cGy to Gy by a hundred', () => {
    expect(imgConvertCGyToGy(200).value).toBe(2);
  });

  it('round-trips a distance without drift', () => {
    const there = imgConvertCmToMm(2.54);
    expect(imgConvertMmToCm(there.value).value).toBe(2.54);
  });

  it('is the identity for the same unit', () => {
    expect(imgConvertUnitValue(7, 'mm', 'mm').value).toBe(7);
  });

  it('refuses a conversion across dimensions', () => {
    const result = imgConvertUnitValue(10, 'mm', 'ms');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_UNIT_DIMENSION_MISMATCH');
  });

  it('refuses dose to distance', () => {
    expect(imgConvertUnitValue(1, 'cGy', 'mm').ok).toBe(false);
  });

  it('refuses an unknown unit', () => {
    expect(imgConvertUnitValue(1, 'furlong' as never, 'mm').code).toBe('IMG_UNIT_UNKNOWN');
  });

  it('refuses a non-finite value', () => {
    expect(imgConvertUnitValue(Number.NaN, 'mm', 'cm').code).toBe('IMG_VALUE_NOT_FINITE');
  });

  it('preserves zero, which is a real exposure reading', () => {
    expect(imgConvertGyToCGy(0).value).toBe(0);
  });
});

describe('imgBuildDetailRows, FM-2 three value states', () => {
  it('builds a row per applicable catalogue entry', () => {
    const result = imgBuildDetailRows(event());
    expect(result.ok).toBe(true);
    expect(result.value.rows.length > 5).toBe(true);
    expect(result.value.modalityClass).toBe('kv');
  });

  it('marks a present value present and normalises it to the canonical unit', () => {
    const rows = imgBuildDetailRows(event()).value;
    const sid = imgFindRow(rows, 'sid');
    expect(sid.state).toBe(IMG_VALUE_STATE_PRESENT);
    expect(sid.unitState).toBe(IMG_UNIT_STATE_DECLARED);
    expect(sid.numericValue).toBe(1000);
    expect(sid.unit).toBe('mm');
  });

  it('converts a value given in a non-canonical but compatible unit', () => {
    const e = event();
    e.metadata.sid = { value: 100, unit: 'cm' };
    const sid = imgFindRow(imgBuildDetailRows(e).value, 'sid');
    expect(sid.numericValue).toBe(1000);
    expect(sid.converted).toBe(true);
    expect(sid.rawValue).toBe(100);
    expect(sid.rawUnit).toBe('cm');
  });

  it('marks an absent value absent and never renders it as zero or a dash', () => {
    const e = event();
    e.metadata.tubeCurrent = undefined;
    const row = imgFindRow(imgBuildDetailRows(e).value, 'tubeCurrent');
    expect(row.state).toBe(IMG_VALUE_STATE_ABSENT);
    expect(row.display).toBe(IMG_DISPLAY_ABSENT);
    expect(row.numericValue).toBe(undefined);
    expect(row.display).not.toBe('0');
    expect(row.display).not.toBe('-');
  });

  it('keeps not-applicable distinct from absent', () => {
    const e = event();
    e.metadata.imagingDose = { notApplicable: true };
    const row = imgFindRow(imgBuildDetailRows(e).value, 'imagingDose');
    expect(row.state).toBe(IMG_VALUE_STATE_NOT_APPLICABLE);
    expect(row.display).toBe(IMG_DISPLAY_NOT_APPLICABLE);
    expect(row.display).not.toBe(IMG_DISPLAY_ABSENT);
  });

  it('keeps a genuine zero exposure as a present value, not an absent one', () => {
    const e = event();
    e.metadata.exposure = { value: 0, unit: 'mAs' };
    const row = imgFindRow(imgBuildDetailRows(e).value, 'exposure');
    expect(row.state).toBe(IMG_VALUE_STATE_PRESENT);
    expect(row.numericValue).toBe(0);
  });

  it('does not expose a numeric value when the unit was never declared', () => {
    const e = event();
    e.metadata.sid = 1000 as never;
    const row = imgFindRow(imgBuildDetailRows(e).value, 'sid');
    expect(row.unitState).toBe(IMG_UNIT_STATE_NOT_DECLARED);
    expect(row.numericValue).toBe(undefined);
    expect(row.rawValue).toBe(1000);
  });

  it('says in the display that the unit was not declared', () => {
    const e = event();
    e.metadata.sid = 1000 as never;
    const row = imgFindRow(imgBuildDetailRows(e).value, 'sid');
    expect(row.display).toContain('unidade');
  });

  it('does not expose a numeric value for an unrecognised unit', () => {
    const e = event();
    e.metadata.sid = { value: 1000, unit: 'polegadas' as never };
    const row = imgFindRow(imgBuildDetailRows(e).value, 'sid');
    expect(row.unitState).toBe(IMG_UNIT_STATE_UNRECOGNIZED);
    expect(row.numericValue).toBe(undefined);
  });

  it('does not expose a numeric value for a unit of the wrong dimension', () => {
    const e = event();
    e.metadata.sid = { value: 1000, unit: 'ms' };
    const row = imgFindRow(imgBuildDetailRows(e).value, 'sid');
    expect(row.numericValue).toBe(undefined);
    expect(row.unitState).not.toBe(IMG_UNIT_STATE_DECLARED);
  });

  it('counts unit warnings so the panel can flag the table', () => {
    const e = event();
    e.metadata.sid = 1000 as never;
    expect(imgBuildDetailRows(e).value.unitWarningCount > 0).toBe(true);
  });

  // Not omitted: the row is rendered as not-applicable with a note. An omitted row leaves
  // the physicist wondering whether the panel forgot the parameter, which is the same
  // ambiguity between absent and inapplicable that the three states exist to remove.
  it('marks kV tube parameters not-applicable for an MV image rather than dropping the row', () => {
    const e = event({
      metadata: {
        instanceUid: '1.2.840.1.2',
        modality: 'MV',
        acquiredAtMs: T0,
        beamEnergy: { value: 6, unit: 'MV' },
      },
    });
    const rows = imgBuildDetailRows(e).value;
    expect(rows.modalityClass).toBe('mv');
    const kvp = imgFindRow(rows, 'kvp');
    expect(kvp.state).toBe(IMG_VALUE_STATE_NOT_APPLICABLE);
    expect(kvp.display).toBe(IMG_DISPLAY_NOT_APPLICABLE);
    expect(kvp.note).toContain('inexistente para esta modalidade');
    expect(imgFindRow(rows, 'beamEnergy').state).toBe(IMG_VALUE_STATE_PRESENT);
  });

  it('marks MV beam energy not-applicable on a kV image', () => {
    const beam = imgFindRow(imgBuildDetailRows(event()).value, 'beamEnergy');
    expect(beam.state).toBe(IMG_VALUE_STATE_NOT_APPLICABLE);
  });

  it('refuses a table when the modality is unknown, because absence cannot be read', () => {
    const e = event();
    e.metadata.modality = 'RESSONANCIA';
    const result = imgBuildDetailRows(e);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_MODALITY_UNSUPPORTED');
  });

  it('refuses a table with no modality at all', () => {
    const e = event();
    e.metadata.modality = undefined;
    expect(imgBuildDetailRows(e).code).toBe('IMG_MODALITY_MISSING');
  });

  it('refuses a table with no instance uid', () => {
    const e = event();
    e.metadata.instanceUid = undefined;
    expect(imgBuildDetailRows(e).code).toBe('IMG_INSTANCE_UID_MISSING');
  });

  it('refuses with no metadata', () => {
    expect(imgBuildDetailRows({ eventId: 'EV-1' }).code).toBe('IMG_METADATA_MISSING');
  });

  it('refuses with no event', () => {
    expect(imgBuildDetailRows(undefined as never).code).toBe('IMG_EVENT_MISSING');
  });

  it('formats a timestamp rather than leaving raw epoch on screen', () => {
    const row = imgFindRow(imgBuildDetailRows(event()).value, 'acquiredAt');
    expect(row.display).not.toBe(String(T0 + 5 * MIN));
    expect(row.display.length > 4).toBe(true);
  });

  it('marks an absent timestamp absent', () => {
    const e = event();
    e.metadata.acquiredAtMs = undefined;
    expect(imgFindRow(imgBuildDetailRows(e).value, 'acquiredAt').state).toBe(
      IMG_VALUE_STATE_ABSENT
    );
  });
});

describe('imgResolveSession, FM-1', () => {
  it('resolves an explicit session reference', () => {
    const result = imgResolveSession(event(), [session()]);
    expect(result.ok).toBe(true);
    expect(result.value.sessionId).toBe('SES-12');
    expect(result.value.confidence).toBe(IMG_SESSION_CONFIDENCE_EXPLICIT);
    expect(result.value.fractionNumber).toBe(12);
  });

  it('resolves by time when there is no explicit reference', () => {
    const e = event();
    e.metadata.sessionRef = undefined;
    const result = imgResolveSession(e, [session()]);
    expect(result.ok).toBe(true);
    expect(result.value.confidence).toBe(IMG_SESSION_CONFIDENCE_INFERRED);
  });

  it('refuses when the explicit reference names a session that does not exist', () => {
    const e = event();
    e.metadata.sessionRef = 'SES-99';
    const result = imgResolveSession(e, [session()]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_SESSION_REF_UNKNOWN');
  });

  it('refuses when the explicit reference matches two sessions', () => {
    const result = imgResolveSession(event(), [session(), session({ fractionNumber: 13 })]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_SESSION_REF_AMBIGUOUS');
  });

  it('refuses when the explicit reference contradicts the acquisition time', () => {
    const e = event();
    e.metadata.acquiredAtMs = T0 + 500 * MIN;
    const result = imgResolveSession(e, [session()]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_SESSION_REF_TIME_CONFLICT');
  });

  it('refuses to guess when the time falls between two sessions', () => {
    const e = event();
    e.metadata.sessionRef = undefined;
    e.metadata.acquiredAtMs = T0 + 30 * MIN;
    const result = imgResolveSession(e, [
      session({ sessionId: 'S1', endedAtMs: T0 + 20 * MIN }),
      session({ sessionId: 'S2', startedAtMs: T0 + 40 * MIN, endedAtMs: T0 + 60 * MIN }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_SESSION_TIME_OUTSIDE');
  });

  it('refuses when the time falls inside two overlapping sessions', () => {
    const e = event();
    e.metadata.sessionRef = undefined;
    const result = imgResolveSession(e, [
      session({ sessionId: 'S1' }),
      session({ sessionId: 'S2', fractionNumber: 13 }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_SESSION_TIME_AMBIGUOUS');
  });

  it('refuses when the acquisition has no timestamp and no reference', () => {
    const e = event();
    e.metadata.sessionRef = undefined;
    e.metadata.acquiredAtMs = undefined;
    expect(imgResolveSession(e, [session()]).code).toBe('IMG_SESSION_TIMESTAMP_MISSING');
  });

  it('does not default a tolerance, so setup imaging must be declared explicitly', () => {
    const e = event();
    e.metadata.sessionRef = undefined;
    e.metadata.acquiredAtMs = T0 - 3 * MIN;
    const withoutTolerance = imgResolveSession(e, [session()]);
    const withTolerance = imgResolveSession(e, [session()], { toleranceMs: 5 * MIN });
    expect(withoutTolerance.ok).toBe(false);
    expect(withTolerance.ok).toBe(true);
  });

  it('refuses a session belonging to another patient', () => {
    const result = imgResolveSession(event(), [session({ patientId: 'PAC-9' })]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_SESSION_PATIENT_MISMATCH');
  });

  it('refuses an empty session list', () => {
    expect(imgResolveSession(event(), []).code).toBe('IMG_SESSION_LIST_EMPTY');
  });

  it('refuses a session with no time window', () => {
    const result = imgResolveSession(event(), [session({ startedAtMs: undefined })]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_SESSION_RECORD_INVALID');
  });

  it('refuses a session whose window is inverted', () => {
    const result = imgResolveSession(event(), [
      session({ startedAtMs: T0 + 20 * MIN, endedAtMs: T0 }),
    ]);
    expect(result.code).toBe('IMG_SESSION_RECORD_INVALID');
  });

  it('refuses an event with no id', () => {
    expect(imgResolveSession(event({ eventId: '  ' }), [session()]).code).toBe(
      'IMG_EVENT_ID_BLANK'
    );
  });

  it('carries a sentence the panel can show beside the fraction label', () => {
    const result = imgResolveSession(event(), [session()]);
    expect(result.value.evidence.length > 10).toBe(true);
  });
});

describe('imgFindDuplicateAcquisitions', () => {
  it('finds two images sharing an acquisition timestamp', () => {
    const result = imgFindDuplicateAcquisitions([
      event({ eventId: 'A' }),
      event({ eventId: 'B' }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.value.length).toBe(1);
    expect(result.value[0].eventIds.length).toBe(2);
  });

  it('finds nothing when timestamps differ', () => {
    const b = event({ eventId: 'B' });
    b.metadata.acquiredAtMs = T0 + 9 * MIN;
    expect(imgFindDuplicateAcquisitions([event({ eventId: 'A' }), b]).value.length).toBe(0);
  });

  it('refuses a non-list', () => {
    expect(imgFindDuplicateAcquisitions(undefined as never).ok).toBe(false);
  });
});

describe('imgFilterEvents and imgNavigate, FM-4', () => {
  function threeEvents(): ImgImagingEvent[] {
    const a = event({ eventId: 'A' });
    const b = event({ eventId: 'B' });
    const c = event({ eventId: 'C' });
    a.metadata.acquiredAtMs = T0 + 1 * MIN;
    b.metadata.acquiredAtMs = T0 + 2 * MIN;
    c.metadata.acquiredAtMs = T0 + 3 * MIN;
    b.metadata.instanceUid = '1.2.840.1.2';
    c.metadata.instanceUid = '1.2.840.1.3';
    c.metadata.modality = 'MV';
    return [a, b, c];
  }

  it('lists every event when unfiltered', () => {
    const list = imgFilterEvents(threeEvents()).value;
    expect(list.events.length).toBe(3);
    expect(list.filtered).toBe(false);
    expect(list.hiddenCount).toBe(0);
  });

  it('reports the hidden count and marks the list filtered', () => {
    const list = imgFilterEvents(threeEvents(), { modality: 'KV' }).value;
    expect(list.events.length).toBe(2);
    expect(list.filtered).toBe(true);
    expect(list.hiddenCount).toBe(1);
    expect(list.totalCandidates).toBe(3);
  });

  it('says in words what the arrows navigate within', () => {
    const list = imgFilterEvents(threeEvents(), { modality: 'KV' }).value;
    expect(list.scopeLabel.toLowerCase()).toContain('kv');
  });

  it('navigates the filtered list, not the whole course', () => {
    const list = imgFilterEvents(threeEvents(), { modality: 'KV' }).value;
    const forward = imgNavigate(list, 'A', IMG_NAVIGATION_FORWARD);
    expect(forward.value.targetEventId).toBe('B');
    expect(forward.value.total).toBe(2);
    expect(forward.value.hiddenCount).toBe(1);
  });

  it('carries the scope label onto the navigation outcome', () => {
    const list = imgFilterEvents(threeEvents(), { modality: 'KV' }).value;
    expect(imgNavigate(list, 'A', IMG_NAVIGATION_FORWARD).value.scopeLabel.length > 0).toBe(
      true
    );
  });

  it('reports a 1-based position inside the scope', () => {
    const list = imgFilterEvents(threeEvents()).value;
    const outcome = imgNavigate(list, 'A', IMG_NAVIGATION_FORWARD).value;
    expect(outcome.position).toBe(2);
    expect(outcome.total).toBe(3);
  });

  it('refuses at the last image rather than wrapping to the first', () => {
    const list = imgFilterEvents(threeEvents()).value;
    const result = imgNavigate(list, 'C', IMG_NAVIGATION_FORWARD);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_AT_LAST');
  });

  it('refuses at the first image rather than wrapping to the last', () => {
    const list = imgFilterEvents(threeEvents()).value;
    const result = imgNavigate(list, 'A', IMG_NAVIGATION_BACKWARD);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_AT_FIRST');
  });

  it('navigates backward correctly in the middle', () => {
    const list = imgFilterEvents(threeEvents()).value;
    expect(imgNavigate(list, 'B', IMG_NAVIGATION_BACKWARD).value.targetEventId).toBe('A');
  });

  it('refuses when the current image is not inside the current scope', () => {
    const list = imgFilterEvents(threeEvents(), { modality: 'KV' }).value;
    const result = imgNavigate(list, 'C', IMG_NAVIGATION_FORWARD);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_CURRENT_NOT_IN_SCOPE');
  });

  it('refuses an invalid direction', () => {
    const list = imgFilterEvents(threeEvents()).value;
    expect(imgNavigate(list, 'A', 'sideways' as never).code).toBe('IMG_DIRECTION_INVALID');
  });

  it('refuses an empty event list', () => {
    expect(imgFilterEvents([]).code).toBe('IMG_LIST_EMPTY');
  });

  it('refuses a list with duplicate event ids', () => {
    expect(imgFilterEvents([event({ eventId: 'A' }), event({ eventId: 'A' })]).code).toBe(
      'IMG_LIST_DUPLICATE_ID'
    );
  });

  it('refuses a list mixing two patients', () => {
    const list = threeEvents();
    list[1].patientId = 'PAC-9';
    expect(imgFilterEvents(list).code).toBe('IMG_LIST_MULTIPLE_PATIENTS');
  });

  it('refuses an inverted date window', () => {
    expect(imgFilterEvents(threeEvents(), { fromMs: T0 + 10, toMs: T0 }).code).toBe(
      'IMG_FILTER_WINDOW_INVALID'
    );
  });

  it('filters by date window', () => {
    const list = imgFilterEvents(threeEvents(), {
      fromMs: T0 + 2 * MIN,
      toMs: T0 + 3 * MIN,
    }).value;
    expect(list.events.length).toBe(2);
    expect(list.filtered).toBe(true);
  });

  it('filters by session reference', () => {
    const list = threeEvents();
    list[2].metadata.sessionRef = 'SES-13';
    const filtered = imgFilterEvents(list, { sessionId: 'SES-12' }).value;
    expect(filtered.events.length).toBe(2);
  });
});

describe('imgVerifyPreviewPairing, FM-6', () => {
  it('accepts a preview and metadata from the same instance and revision', () => {
    const e = event();
    const result = imgVerifyPreviewPairing(e.preview, e.metadata);
    expect(result.ok).toBe(true);
    expect(result.value.instanceUid).toBe('1.2.840.1.1');
  });

  it('refuses a preview of a different instance', () => {
    const e = event();
    const result = imgVerifyPreviewPairing({ instanceUid: '9.9.9', revision: 3 }, e.metadata);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_PREVIEW_MISMATCH');
  });

  it('refuses a preview rendered from an older revision', () => {
    const e = event();
    const result = imgVerifyPreviewPairing(
      { instanceUid: '1.2.840.1.1', revision: 2 },
      e.metadata
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_PREVIEW_STALE_REVISION');
  });

  it('refuses metadata older than the preview', () => {
    const e = event();
    const result = imgVerifyPreviewPairing(
      { instanceUid: '1.2.840.1.1', revision: 4 },
      e.metadata
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_METADATA_STALE_REVISION');
  });

  it('refuses a preview with no instance uid', () => {
    const e = event();
    expect(imgVerifyPreviewPairing({ revision: 3 }, e.metadata).code).toBe(
      'IMG_PREVIEW_UID_MISSING'
    );
  });

  it('refuses a missing preview', () => {
    expect(imgVerifyPreviewPairing(undefined as never, event().metadata).code).toBe(
      'IMG_PREVIEW_MISSING'
    );
  });

  it('refuses missing metadata', () => {
    expect(imgVerifyPreviewPairing(event().preview, undefined as never).code).toBe(
      'IMG_METADATA_MISSING'
    );
  });

  it('refuses a preview older than the allowed age', () => {
    const e = event();
    const result = imgVerifyPreviewPairing(e.preview, e.metadata, {
      now: T0 + 600 * MIN,
      maxAgeMs: 5 * MIN,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_PREVIEW_STALE_AGE');
  });

  it('accepts a preview inside the allowed age', () => {
    const e = event();
    expect(
      imgVerifyPreviewPairing(e.preview, e.metadata, { now: T0 + 8 * MIN, maxAgeMs: 5 * MIN }).ok
    ).toBe(true);
  });

  it('refuses a preview rendered in the future', () => {
    const e = event();
    const result = imgVerifyPreviewPairing(e.preview, e.metadata, { now: T0 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_PREVIEW_TIMESTAMP_FUTURE');
  });
});

describe('imgHasUnsavedReview', () => {
  it('is false for a clean state', () => {
    expect(imgHasUnsavedReview({})).toBe(false);
  });

  it('is true for a dirty note flag', () => {
    expect(imgHasUnsavedReview({ hasUnsavedNote: true })).toBe(true);
  });

  it('is true for an approval in progress', () => {
    expect(imgHasUnsavedReview({ hasApprovalInProgress: true })).toBe(true);
  });

  it('is true for a note with characters even when the dirty flag was missed', () => {
    expect(imgHasUnsavedReview({ noteCharacterCount: 12 })).toBe(true);
  });

  it('is false for a missing state', () => {
    expect(imgHasUnsavedReview(undefined as never)).toBe(false);
  });
});

describe('imgPrepareOfflineReview, FM-5', () => {
  function context(over: Partial<ImgOfflineReviewContext> = {}): ImgOfflineReviewContext {
    const e = event();
    const resolution = imgResolveSession(e, [session()]);
    const pairing = imgVerifyPreviewPairing(e.preview, e.metadata);
    return {
      patientId: 'PAC-1',
      courseId: 'CUR-1',
      sessionId: 'SES-12',
      instanceUid: '1.2.840.1.1',
      eventId: 'EV-1',
      eventPatientId: 'PAC-1',
      sessionResolution: resolution.value,
      previewPairing: pairing.value,
      scopeLabel: 'todas as imagens do curso',
      ...over,
    };
  }

  it('prepares a handoff carrying what is being reviewed', () => {
    const result = imgPrepareOfflineReview(context(), T0 + 10 * MIN);
    expect(result.ok).toBe(true);
    expect(result.value.status).toBe('ready');
    expect(result.value.handoff.patientId).toBe('PAC-1');
    expect(result.value.handoff.sessionId).toBe('SES-12');
    expect(result.value.handoff.instanceUid).toBe('1.2.840.1.1');
    expect(result.value.handoff.committed).toBe(true);
  });

  it('refuses each missing identity field in turn', () => {
    for (const field of IMG_REQUIRED_OFFLINE_CONTEXT_FIELDS) {
      const partial = context();
      partial[field] = undefined;
      const result = imgPrepareOfflineReview(partial, T0);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('IMG_CONTEXT_INCOMPLETE');
    }
  });

  it('names the missing field so the caller can fix it', () => {
    const result = imgPrepareOfflineReview(context({ sessionId: undefined }), T0);
    expect(result.reason.length > 10).toBe(true);
  });

  it('refuses when the context patient disagrees with the event patient', () => {
    const result = imgPrepareOfflineReview(context({ eventPatientId: 'PAC-9' }), T0);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_CONTEXT_PATIENT_MISMATCH');
  });

  it('refuses when the session in the context is not the one that was resolved', () => {
    const result = imgPrepareOfflineReview(context({ sessionId: 'SES-13' }), T0);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_CONTEXT_SESSION_MISMATCH');
  });

  it('refuses when the session was never resolved at all', () => {
    const result = imgPrepareOfflineReview(context({ sessionResolution: undefined }), T0);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_CONTEXT_SESSION_UNVERIFIED');
  });

  it('refuses an inferred fraction unless a human acknowledged the inference', () => {
    const e = event();
    e.metadata.sessionRef = undefined;
    const inferred = imgResolveSession(e, [session()]);
    const result = imgPrepareOfflineReview(
      context({ sessionResolution: inferred.value }),
      T0
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_CONTEXT_SESSION_INFERRED');
  });

  it('accepts an inferred fraction once acknowledged', () => {
    const e = event();
    e.metadata.sessionRef = undefined;
    const inferred = imgResolveSession(e, [session()]);
    const result = imgPrepareOfflineReview(
      context({ sessionResolution: inferred.value, acknowledgedInferredSession: true }),
      T0
    );
    expect(result.ok).toBe(true);
    expect(result.value.handoff.sessionConfidence).toBe(IMG_SESSION_CONFIDENCE_INFERRED);
  });

  it('refuses when the preview was never paired with the metadata', () => {
    const result = imgPrepareOfflineReview(context({ previewPairing: undefined }), T0);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('IMG_CONTEXT_PREVIEW_UNVERIFIED');
  });

  it('reports unsaved review as a distinct status rather than discarding it', () => {
    const result = imgPrepareOfflineReview(
      context({ unsavedReview: { hasUnsavedNote: true } }),
      T0
    );
    expect(result.ok).toBe(true);
    expect(result.value.status).toBe('unsaved-review-pending');
    expect(result.value.requiresUserDecision).toBe(true);
    expect(result.value.handoff.committed).toBe(false);
  });

  it('commits once the caller decides to save', () => {
    const result = imgPrepareOfflineReview(
      context({ unsavedReview: { hasUnsavedNote: true }, unsavedDecision: 'save' }),
      T0
    );
    expect(result.value.status).toBe('ready');
    expect(result.value.handoff.committed).toBe(true);
  });

  it('commits once the caller decides to discard, deliberately', () => {
    const result = imgPrepareOfflineReview(
      context({ unsavedReview: { hasApprovalInProgress: true }, unsavedDecision: 'discard' }),
      T0
    );
    expect(result.value.status).toBe('ready');
    expect(result.value.handoff.committed).toBe(true);
  });

  it('stamps the handoff with the instant it was given', () => {
    const result = imgPrepareOfflineReview(context(), T0 + 42);
    expect(result.value.handoff.requestedAtMs).toBe(T0 + 42);
  });

  it('refuses an invalid instant, because the handoff record is auditable', () => {
    expect(imgPrepareOfflineReview(context(), Number.NaN).code).toBe('IMG_NOW_INVALID');
  });

  it('refuses a missing context', () => {
    expect(imgPrepareOfflineReview(undefined as never, T0).code).toBe('IMG_CONTEXT_MISSING');
  });

  it('carries the navigation scope into the workspace', () => {
    const result = imgPrepareOfflineReview(context(), T0);
    expect(result.value.handoff.scopeLabel).toContain('curso');
  });
});
