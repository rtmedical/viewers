import {
  GCP_DEID_ACK_MAX_AGE_MS,
  GCP_HIERARCHY_LEVELS,
  GCP_MAX_BYTES_PER_BATCH,
  GCP_MAX_INSTANCES_PER_BATCH,
  GCP_SCOPE_CLOUD_PLATFORM,
  GCP_SCOPE_CLOUD_PLATFORM_READ_ONLY,
  GCP_SCOPE_HEALTHCARE,
  GCP_TOKEN_LEAD_MARGIN_MS,
  GCP_UPLOAD_MAX_ATTEMPTS,
  gcpApplyUploadResult,
  gcpBuildStorePath,
  gcpCheckDeidentificationDecision,
  gcpCheckScopes,
  gcpClassifyTransportStatus,
  gcpClearLevel,
  gcpConfirmDestination,
  gcpEstimateUploadDurationMs,
  gcpListingAllowsCreation,
  gcpListingFailed,
  gcpListingIsConfirmedEmpty,
  gcpListingItems,
  gcpListingLoaded,
  gcpListingLoading,
  gcpListingNotLoaded,
  gcpParseStorePath,
  gcpPlanRetry,
  gcpPlanUpload,
  gcpSelectLevel,
  gcpSelectionIsComplete,
  gcpStartUploadProgress,
  gcpStorePathsEqual,
  gcpTokenSufficientForUpload,
  gcpTokenWindow,
  gcpUploadVerdict,
  gcpValidateDicomUid,
  gcpValidateResourceId,
  type GcpDeidDecision,
  type GcpSelection,
  type GcpUploadInstance,
} from './gcpDicomStore';

const NOW = 1_760_000_000_000;

const FULL: GcpSelection = {
  project: 'rt-medical-prod',
  location: 'southamerica-east1',
  dataset: 'radiologia',
  dicomStore: 'hosp1-store',
};

const DEID: GcpDeidDecision = {
  dataSensitivity: 'identifiable',
  acknowledgedIdentifiableUpload: true,
  acknowledgedBy: 'FIS-9',
  acknowledgedAtEpochMs: NOW - 60_000,
};

function instance(n: number, over: Partial<GcpUploadInstance> = {}): GcpUploadInstance {
  return {
    sopInstanceUid: '1.2.840.10008.5.1.4.1.1.2.' + n,
    seriesInstanceUid: '1.2.840.113619.2.55.3.1',
    studyInstanceUid: '1.2.840.113619.2.55.3',
    byteLength: 524_288,
    ...over,
  };
}

function planOf(count: number, over: Partial<{ maxInstancesPerBatch: number; maxBytesPerBatch: number }> = {}) {
  const instances: GcpUploadInstance[] = [];
  for (let k = 0; k < count; k += 1) {
    instances.push(instance(k));
  }
  const result = gcpPlanUpload(instances, {
    selection: FULL,
    deidentification: DEID,
    now: NOW,
    ...over,
  });
  if (!result.ok) {
    throw new Error('fixture broken: ' + result.reason);
  }
  return result.value;
}

/* ------------------------------------------------------------------ */

describe('gcpValidateResourceId and path algebra, FM-1', () => {
  it('accepts a well-formed project id', () => {
    expect(gcpValidateResourceId('project', 'rt-medical-prod').ok).toBe(true);
  });

  it('refuses an id containing a slash, which would re-parent the resource', () => {
    const result = gcpValidateResourceId('dataset', 'radiologia/outro');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_ID_CONTAINS_SEPARATOR');
  });

  it('refuses an empty id', () => {
    expect(gcpValidateResourceId('project', '').ok).toBe(false);
  });

  it('refuses a project id that is too short for the GCP grammar', () => {
    expect(gcpValidateResourceId('project', 'abc').ok).toBe(false);
  });

  it('refuses a non-string id', () => {
    expect(gcpValidateResourceId('project', 42).ok).toBe(false);
  });

  it('builds the canonical store path', () => {
    const result = gcpBuildStorePath(FULL);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(
      'projects/rt-medical-prod/locations/southamerica-east1/datasets/radiologia/dicomStores/hosp1-store'
    );
  });

  it('round-trips a store path', () => {
    const path = gcpBuildStorePath(FULL).value;
    const parsed = gcpParseStorePath(path);
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toEqual(FULL);
  });

  it('refuses to build a path from a partially selected hierarchy', () => {
    const result = gcpBuildStorePath({ project: 'rt-medical-prod', location: 'southamerica-east1' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_INCOMPLETE_SELECTION');
  });

  it('refuses a selection with a hole in the middle', () => {
    const result = gcpBuildStorePath({
      project: 'rt-medical-prod',
      dataset: 'radiologia',
      dicomStore: 'hosp1-store',
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a malformed path on parse', () => {
    expect(gcpParseStorePath('projects/a/datasets/b').ok).toBe(false);
  });

  it('refuses a non-string path on parse', () => {
    expect(gcpParseStorePath(undefined).ok).toBe(false);
  });

  it('compares store paths structurally', () => {
    expect(gcpStorePathsEqual(FULL, { ...FULL })).toBe(true);
    expect(gcpStorePathsEqual(FULL, { ...FULL, dicomStore: 'outro' })).toBe(false);
  });

  it('knows when a selection is complete', () => {
    expect(gcpSelectionIsComplete(FULL)).toBe(true);
    expect(gcpSelectionIsComplete({ project: 'rt-medical-prod' })).toBe(false);
  });
});

describe('gcpSelectLevel invalidation, FM-1 cross-tenant', () => {
  it('invalidates every descendant when the project changes', () => {
    const result = gcpSelectLevel(FULL, 'project', 'outro-projeto');
    expect(result.ok).toBe(true);
    expect(result.value.selection.location).toBe(undefined);
    expect(result.value.selection.dataset).toBe(undefined);
    expect(result.value.selection.dicomStore).toBe(undefined);
    expect(result.value.invalidatedLevels).toEqual(['location', 'dataset', 'dicomStore']);
  });

  it('invalidates dataset and store when the location changes', () => {
    const result = gcpSelectLevel(FULL, 'location', 'us-central1');
    expect(result.value.selection.project).toBe('rt-medical-prod');
    expect(result.value.selection.dataset).toBe(undefined);
    expect(result.value.selection.dicomStore).toBe(undefined);
  });

  it('invalidates only the store when the dataset changes', () => {
    const result = gcpSelectLevel(FULL, 'dataset', 'outro-dataset');
    expect(result.value.selection.location).toBe('southamerica-east1');
    expect(result.value.selection.dicomStore).toBe(undefined);
  });

  it('invalidates nothing when the store itself changes', () => {
    const result = gcpSelectLevel(FULL, 'dicomStore', 'outro-store');
    expect(result.value.invalidatedLevels).toEqual([]);
    expect(result.value.selection.dataset).toBe('radiologia');
  });

  it('keeps descendants when the same id is re-selected on a listing refresh', () => {
    const result = gcpSelectLevel(FULL, 'project', 'rt-medical-prod');
    expect(result.value.changed).toBe(false);
    expect(result.value.selection.dicomStore).toBe('hosp1-store');
  });

  it('refuses an invalid id at any level', () => {
    expect(gcpSelectLevel(FULL, 'dataset', 'com/barra').ok).toBe(false);
  });

  it('refuses an unknown level', () => {
    expect(gcpSelectLevel(FULL, 'region' as never, 'x').ok).toBe(false);
  });

  it('clears a level and its descendants', () => {
    const result = gcpClearLevel(FULL, 'location');
    expect(result.value.selection.location).toBe(undefined);
    expect(result.value.selection.dicomStore).toBe(undefined);
    expect(result.value.selection.project).toBe('rt-medical-prod');
  });

  it('invalidates descendants at every level of the hierarchy', () => {
    for (let k = 0; k < GCP_HIERARCHY_LEVELS.length; k += 1) {
      const level = GCP_HIERARCHY_LEVELS[k];
      const result = gcpClearLevel(FULL, level);
      expect(result.ok).toBe(true);
      for (let j = k; j < GCP_HIERARCHY_LEVELS.length; j += 1) {
        expect(result.value.selection[GCP_HIERARCHY_LEVELS[j]]).toBe(undefined);
      }
    }
  });
});

describe('gcpConfirmDestination', () => {
  it('accepts a destination that still matches what was shown', () => {
    const path = gcpBuildStorePath(FULL).value;
    expect(gcpConfirmDestination(FULL, path).ok).toBe(true);
  });

  it('refuses when the destination moved since the operator confirmed', () => {
    const shown = gcpBuildStorePath(FULL).value;
    const moved = gcpSelectLevel(FULL, 'dicomStore', 'outro-store').value.selection;
    const result = gcpConfirmDestination(moved, shown);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_DESTINATION_CHANGED');
  });
});

describe('listing state, FM-5 empty is not unloaded', () => {
  it('keeps not-loaded distinct from loaded-and-empty', () => {
    const notLoaded = gcpListingNotLoaded('dicomStore').value;
    const empty = gcpListingLoaded('dicomStore', [], NOW).value;
    expect(gcpListingIsConfirmedEmpty(notLoaded)).toBe(false);
    expect(gcpListingIsConfirmedEmpty(empty)).toBe(true);
  });

  it('keeps loading distinct from empty', () => {
    expect(gcpListingIsConfirmedEmpty(gcpListingLoading('dataset').value)).toBe(false);
  });

  it('keeps a failed listing distinct from empty', () => {
    const failed = gcpListingFailed('dataset', 'GCP_REFUSAL_MISSING_SCOPE', 'sem escopo', NOW).value;
    expect(gcpListingIsConfirmedEmpty(failed)).toBe(false);
  });

  it('refuses to hand out items from a listing that never loaded', () => {
    const result = gcpListingItems(gcpListingNotLoaded('dataset').value);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_LISTING_NOT_LOADED');
  });

  it('refuses to hand out items from a failed listing', () => {
    const failed = gcpListingFailed('dataset', 'GCP_REFUSAL_MISSING_SCOPE', 'sem escopo', NOW).value;
    const result = gcpListingItems(failed);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_LISTING_FAILED');
  });

  it('hands out items from a loaded listing', () => {
    const loaded = gcpListingLoaded('dataset', [{ id: 'radiologia' }], NOW).value;
    expect(gcpListingItems(loaded).value.length).toBe(1);
  });

  it('only offers creation when the listing is confirmed empty', () => {
    expect(gcpListingAllowsCreation(gcpListingLoaded('dataset', [], NOW).value)).toBe(true);
    expect(gcpListingAllowsCreation(gcpListingNotLoaded('dataset').value)).toBe(false);
    expect(gcpListingAllowsCreation(gcpListingLoading('dataset').value)).toBe(false);
  });

  it('refuses a listing with a duplicate item', () => {
    const result = gcpListingLoaded('dataset', [{ id: 'a' }, { id: 'a' }], NOW);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_DUPLICATE_LISTING_ITEM');
  });

  it('refuses a loaded listing with an invalid instant', () => {
    expect(gcpListingLoaded('dataset', [], Number.NaN).ok).toBe(false);
  });
});

describe('gcpCheckDeidentificationDecision, FM-6', () => {
  it('accepts an explicit, attributed, recent acknowledgement', () => {
    const result = gcpCheckDeidentificationDecision(DEID, NOW);
    expect(result.ok).toBe(true);
    expect(result.value.requiresAcknowledgement).toBe(true);
    expect(result.value.acknowledgedBy).toBe('FIS-9');
  });

  it('refuses identifiable data with no acknowledgement at all', () => {
    const result = gcpCheckDeidentificationDecision({ dataSensitivity: 'identifiable' }, NOW);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_DEID_NOT_ACKNOWLEDGED');
  });

  // Regression: the guard compared the raw length, so a whitespace-only string passed and
  // was stored verbatim as the person who authorised the disclosure.
  it('refuses an acknowledgement with nobody behind it', () => {
    const result = gcpCheckDeidentificationDecision(
      { ...DEID, acknowledgedBy: '   ' },
      NOW
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_DEID_UNATTRIBUTED');
  });

  it('refuses an acknowledgement too old to be about this patient', () => {
    const result = gcpCheckDeidentificationDecision(
      { ...DEID, acknowledgedAtEpochMs: NOW - GCP_DEID_ACK_MAX_AGE_MS - 1 },
      NOW
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_DEID_STALE');
  });

  it('accepts an acknowledgement exactly at the age limit', () => {
    expect(
      gcpCheckDeidentificationDecision(
        { ...DEID, acknowledgedAtEpochMs: NOW - GCP_DEID_ACK_MAX_AGE_MS },
        NOW
      ).ok
    ).toBe(true);
  });

  it('does not require an acknowledgement for de-identified data', () => {
    const result = gcpCheckDeidentificationDecision({ dataSensitivity: 'deidentified' }, NOW);
    expect(result.ok).toBe(true);
    expect(result.value.requiresAcknowledgement).toBe(false);
  });

  it('refuses de-identified data carrying an identifiable acknowledgement', () => {
    const result = gcpCheckDeidentificationDecision(
      { dataSensitivity: 'deidentified', acknowledgedIdentifiableUpload: true, acknowledgedBy: 'X' },
      NOW
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_DEID_CONTRADICTION');
  });

  it('refuses an unknown sensitivity rather than assuming', () => {
    expect(gcpCheckDeidentificationDecision({ dataSensitivity: 'talvez' as never }, NOW).ok).toBe(
      false
    );
  });

  it('refuses a missing decision', () => {
    expect(gcpCheckDeidentificationDecision(undefined, NOW).ok).toBe(false);
  });
});

describe('gcpCheckScopes, FM-4 read-write asymmetry', () => {
  it('accepts the healthcare scope for an upload', () => {
    expect(gcpCheckScopes([GCP_SCOPE_HEALTHCARE], 'uploadInstances').ok).toBe(true);
  });

  it('accepts cloud-platform as a substitute for healthcare', () => {
    expect(gcpCheckScopes([GCP_SCOPE_CLOUD_PLATFORM], 'uploadInstances').ok).toBe(true);
  });

  it('refuses a read-only scope for an upload, naming the missing scope', () => {
    const result = gcpCheckScopes([GCP_SCOPE_CLOUD_PLATFORM_READ_ONLY], 'uploadInstances');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('healthcare');
  });

  it('accepts a read-only scope for listing projects', () => {
    expect(gcpCheckScopes([GCP_SCOPE_CLOUD_PLATFORM_READ_ONLY], 'listProjects').ok).toBe(true);
  });

  it('accepts healthcare for the read-only requirement, since it is broader', () => {
    expect(gcpCheckScopes([GCP_SCOPE_HEALTHCARE], 'listProjects').ok).toBe(true);
  });

  it('refuses an empty scope list', () => {
    expect(gcpCheckScopes([], 'uploadInstances').ok).toBe(false);
  });

  it('refuses an unknown operation', () => {
    const result = gcpCheckScopes([GCP_SCOPE_CLOUD_PLATFORM], 'deleteEverything' as never);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_UNKNOWN_OPERATION');
  });

  it('refuses a non-array scope value', () => {
    expect(gcpCheckScopes('healthcare', 'uploadInstances').ok).toBe(false);
  });
});

describe('token window and sufficiency, FM-4', () => {
  it('reports the usable window as the remaining time minus the lead margin', () => {
    const result = gcpTokenWindow(
      { scopes: [GCP_SCOPE_HEALTHCARE], expiresAtEpochMs: NOW + 10 * 60_000 },
      NOW
    );
    expect(result.ok).toBe(true);
    expect(result.value.usableMs).toBe(10 * 60_000 - GCP_TOKEN_LEAD_MARGIN_MS);
  });

  it('refuses a token whose usable window is exactly zero', () => {
    const result = gcpTokenWindow(
      { scopes: [GCP_SCOPE_HEALTHCARE], expiresAtEpochMs: NOW + GCP_TOKEN_LEAD_MARGIN_MS },
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it('refuses an already-expired token', () => {
    const result = gcpTokenWindow({ scopes: [GCP_SCOPE_HEALTHCARE], expiresAtEpochMs: NOW - 1 }, NOW);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_TOKEN_EXPIRED');
  });

  it('estimates duration from throughput and per-batch overhead', () => {
    const plan = planOf(4);
    const result = gcpEstimateUploadDurationMs(plan, {
      throughputBytesPerSecond: plan.totalBytes,
      perBatchOverheadMs: 100,
    });
    expect(result.value).toBe(1000 + plan.batches.length * 100);
  });

  it('refuses a zero throughput rather than dividing by it', () => {
    expect(gcpEstimateUploadDurationMs(planOf(1), { throughputBytesPerSecond: 0 }).ok).toBe(false);
  });

  it('says up front that a long upload cannot finish before the token dies', () => {
    const result = gcpTokenSufficientForUpload(
      { scopes: [GCP_SCOPE_HEALTHCARE], expiresAtEpochMs: NOW + 5 * 60_000 },
      NOW,
      40 * 60_000
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_TOKEN_TOO_SHORT');
    expect(result.reason).toContain('Renove');
  });

  it('accepts an upload that fits, reporting the slack', () => {
    const result = gcpTokenSufficientForUpload(
      { scopes: [GCP_SCOPE_HEALTHCARE], expiresAtEpochMs: NOW + 30 * 60_000 },
      NOW,
      60_000
    );
    expect(result.ok).toBe(true);
    expect(result.value.slackMs > 0).toBe(true);
  });

  it('checks the scope before the clock, so a read token never looks like a timing problem', () => {
    const result = gcpTokenSufficientForUpload(
      { scopes: [GCP_SCOPE_CLOUD_PLATFORM_READ_ONLY], expiresAtEpochMs: NOW + 30 * 60_000 },
      NOW,
      1000
    );
    expect(result.ok).toBe(false);
    expect(result.code).not.toBe('GCP_REFUSAL_TOKEN_TOO_SHORT');
  });
});

describe('gcpValidateDicomUid', () => {
  it('accepts a real UID', () => {
    expect(gcpValidateDicomUid('sopInstanceUid', '1.2.840.10008.5.1.4.1.1.2').ok).toBe(true);
  });

  it('refuses a UID over 64 characters', () => {
    expect(gcpValidateDicomUid('sopInstanceUid', '1.' + '2'.repeat(70)).ok).toBe(false);
  });

  it('refuses a UID with letters', () => {
    expect(gcpValidateDicomUid('sopInstanceUid', '1.2.abc').ok).toBe(false);
  });

  it('refuses an empty UID', () => {
    expect(gcpValidateDicomUid('sopInstanceUid', '').ok).toBe(false);
  });
});

describe('gcpPlanUpload', () => {
  it('batches instances under the count limit', () => {
    const plan = planOf(120, { maxInstancesPerBatch: 50 });
    expect(plan.batches.length).toBe(3);
    expect(plan.totalInstances).toBe(120);
  });

  it('respects a byte limit even below the count limit', () => {
    const plan = planOf(10, { maxBytesPerBatch: 1_048_576 });
    expect(plan.batches.length).toBe(5);
  });

  it('puts exactly the limit in one batch', () => {
    const plan = planOf(GCP_MAX_INSTANCES_PER_BATCH);
    expect(plan.batches.length).toBe(1);
  });

  it('splits one past the limit', () => {
    const plan = planOf(GCP_MAX_INSTANCES_PER_BATCH + 1);
    expect(plan.batches.length).toBe(2);
  });

  it('records the expected count per study', () => {
    const plan = planOf(3);
    expect(plan.expectedByStudy['1.2.840.113619.2.55.3']).toBe(3);
  });

  it('carries the destination path', () => {
    expect(planOf(1).destination).toBe(gcpBuildStorePath(FULL).value);
  });

  it('refuses an empty upload', () => {
    const result = gcpPlanUpload([], { selection: FULL, deidentification: DEID, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_EMPTY_UPLOAD');
  });

  it('refuses a duplicate SOP Instance UID in the same upload', () => {
    const result = gcpPlanUpload([instance(1), instance(1)], {
      selection: FULL,
      deidentification: DEID,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_DUPLICATE_INSTANCE');
  });

  it('refuses an instance larger than one batch can carry', () => {
    const result = gcpPlanUpload([instance(1, { byteLength: GCP_MAX_BYTES_PER_BATCH + 1 })], {
      selection: FULL,
      deidentification: DEID,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_INSTANCE_TOO_LARGE');
  });

  it('refuses an incomplete destination', () => {
    const result = gcpPlanUpload([instance(1)], {
      selection: { project: 'rt-medical-prod' },
      deidentification: DEID,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_INCOMPLETE_SELECTION');
  });

  it('refuses an upload with no de-identification decision', () => {
    const result = gcpPlanUpload([instance(1)], {
      selection: FULL,
      deidentification: { dataSensitivity: 'identifiable' },
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_DEID_NOT_ACKNOWLEDGED');
  });

  it('refuses an invalid batch limit', () => {
    const result = gcpPlanUpload([instance(1)], {
      selection: FULL,
      deidentification: DEID,
      now: NOW,
      maxInstancesPerBatch: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_INVALID_BATCH_LIMIT');
  });

  it('refuses an instance with an invalid UID', () => {
    const result = gcpPlanUpload([instance(1, { sopInstanceUid: 'nao-e-uid' })], {
      selection: FULL,
      deidentification: DEID,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_INVALID_DICOM_UID');
  });
});

describe('gcpClassifyTransportStatus, FM-3', () => {
  it('calls 2xx success', () => {
    expect(gcpClassifyTransportStatus(200).value).toBe('success');
  });

  it('calls 401 a reauth, not a retry', () => {
    expect(gcpClassifyTransportStatus(401).value).toBe('reauthRequired');
  });

  // 403 is how a grant missing the healthcare scope answers an upload
  // (insufficient_scope), which is FM-4's exact shape. Classifying it permanent would mark
  // every instance in the batch as rejected and tell the operator their files were refused.
  it('calls 403 a reauth, not a rejection of the files', () => {
    expect(gcpClassifyTransportStatus(403).value).toBe('reauthRequired');
  });

  it('calls 429 retryable', () => {
    expect(gcpClassifyTransportStatus(429).value).toBe('retryable');
  });

  it('calls 503 retryable', () => {
    expect(gcpClassifyTransportStatus(503).value).toBe('retryable');
  });

  it('calls 400 permanent, so a malformed instance is not retried forever', () => {
    expect(gcpClassifyTransportStatus(400).value).toBe('permanent');
  });

  it('refuses a nonsense status', () => {
    expect(gcpClassifyTransportStatus(42).ok).toBe(false);
  });
});

describe('gcpApplyUploadResult and gcpUploadVerdict, FM-2 and FM-3', () => {
  function fresh(count: number) {
    const plan = planOf(count, { maxInstancesPerBatch: 50 });
    const progress = gcpStartUploadProgress(plan, NOW);
    if (!progress.ok) {
      throw new Error('fixture broken');
    }
    return { plan, progress: progress.value };
  }

  function accept(plan: ReturnType<typeof planOf>, progress: any, batchIndex: number, uids?: string[]) {
    const sent = uids ?? plan.batches[batchIndex].instanceUids;
    return gcpApplyUploadResult(
      plan,
      progress,
      {
        batchIndex,
        httpStatus: 200,
        sentInstanceUids: sent,
        items: sent.map(uid => ({ sopInstanceUid: uid, outcome: 'accepted' as const })),
      },
      NOW + 1000
    );
  }

  it('reports complete only when every instance was accepted', () => {
    const { plan, progress } = fresh(3);
    const applied = accept(plan, progress, 0);
    const verdict = gcpUploadVerdict(plan, applied.value);
    expect(verdict.value.status).toBe('complete');
    expect(verdict.value.safeToOpenInViewer).toBe(true);
    expect(verdict.value.acceptedInstances).toBe(3);
  });

  it('is not complete while one instance is unaccounted for', () => {
    const { plan, progress } = fresh(3);
    const uids = plan.batches[0].instanceUids;
    const applied = accept(plan, progress, 0, [uids[0], uids[1]]);
    const verdict = gcpUploadVerdict(plan, applied.value);
    expect(verdict.value.status).toBe('inProgress');
    expect(verdict.value.safeToOpenInViewer).toBe(false);
    expect(verdict.value.missingInstanceUids.length).toBe(1);
  });

  it('refuses a 200 whose body omits an instance we sent', () => {
    const { plan, progress } = fresh(3);
    const uids = plan.batches[0].instanceUids;
    const result = gcpApplyUploadResult(
      plan,
      progress,
      {
        batchIndex: 0,
        httpStatus: 200,
        sentInstanceUids: uids,
        items: [{ sopInstanceUid: uids[0], outcome: 'accepted' }],
      },
      NOW + 1000
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_UNREPORTED_INSTANCE');
  });

  it('does not treat a 200 over a rejection as success', () => {
    const { plan, progress } = fresh(2);
    const uids = plan.batches[0].instanceUids;
    const applied = gcpApplyUploadResult(
      plan,
      progress,
      {
        batchIndex: 0,
        httpStatus: 200,
        sentInstanceUids: uids,
        items: [
          { sopInstanceUid: uids[0], outcome: 'accepted' },
          { sopInstanceUid: uids[1], outcome: 'permanent', httpStatus: 400 },
        ],
      },
      NOW + 1000
    );
    expect(applied.ok).toBe(true);
    const verdict = gcpUploadVerdict(plan, applied.value);
    expect(verdict.value.status).toBe('incomplete');
    expect(verdict.value.safeToOpenInViewer).toBe(false);
    expect(verdict.value.permanentlyRejectedUids.length).toBe(1);
  });

  it('refuses a response about an instance we never sent', () => {
    const { plan, progress } = fresh(2);
    const uids = plan.batches[0].instanceUids;
    const result = gcpApplyUploadResult(
      plan,
      progress,
      {
        batchIndex: 0,
        httpStatus: 200,
        sentInstanceUids: [uids[0]],
        items: [
          { sopInstanceUid: uids[0], outcome: 'accepted' },
          { sopInstanceUid: uids[1], outcome: 'accepted' },
        ],
      },
      NOW + 1000
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_UNSENT_INSTANCE_REPORTED');
  });

  it('counts a re-sent instance as a duplicate, not a second acceptance', () => {
    const { plan, progress } = fresh(2);
    const once = accept(plan, progress, 0);
    const twice = accept(plan, once.value, 0);
    expect(twice.ok).toBe(true);
    expect(twice.value.acceptedInstances).toBe(2);
    expect(twice.value.duplicateAcceptances > 0).toBe(true);
    const verdict = gcpUploadVerdict(plan, twice.value);
    expect(verdict.value.acceptedInstances).toBe(2);
    expect(verdict.value.status).toBe('complete');
  });

  it('refuses a report that an already-accepted instance was rejected', () => {
    const { plan, progress } = fresh(2);
    const once = accept(plan, progress, 0);
    const uids = plan.batches[0].instanceUids;
    const contradiction = gcpApplyUploadResult(
      plan,
      once.value,
      {
        batchIndex: 0,
        httpStatus: 200,
        sentInstanceUids: [uids[0]],
        items: [{ sopInstanceUid: uids[0], outcome: 'permanent', httpStatus: 400 }],
      },
      NOW + 2000
    );
    expect(contradiction.ok).toBe(false);
    expect(contradiction.code).toBe('GCP_REFUSAL_RESULT_CONTRADICTION');
  });

  it('refuses progress from another upload', () => {
    const a = fresh(2);
    const b = fresh(3);
    expect(gcpUploadVerdict(a.plan, b.progress).ok).toBe(false);
  });

  it('refuses an unknown batch index', () => {
    const { plan, progress } = fresh(2);
    const result = gcpApplyUploadResult(
      plan,
      progress,
      { batchIndex: 99, httpStatus: 200, sentInstanceUids: [], items: [] },
      NOW
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('GCP_REFUSAL_UNKNOWN_BATCH');
  });

  it('reports an incomplete study by name', () => {
    const { plan, progress } = fresh(3);
    const uids = plan.batches[0].instanceUids;
    const applied = accept(plan, progress, 0, [uids[0]]);
    const verdict = gcpUploadVerdict(plan, applied.value);
    expect(verdict.value.incompleteStudies.length).toBe(1);
    expect(verdict.value.incompleteStudies[0].expected).toBe(3);
    expect(verdict.value.incompleteStudies[0].accepted).toBe(1);
  });

  it('never says safe to open while a study is short a slice', () => {
    const { plan, progress } = fresh(20);
    const uids = plan.batches[0].instanceUids;
    const applied = accept(plan, progress, 0, uids.slice(0, 19));
    expect(gcpUploadVerdict(plan, applied.value).value.safeToOpenInViewer).toBe(false);
  });
});

describe('gcpPlanRetry, FM-3', () => {
  it('retries a retryable failure with backoff', () => {
    const result = gcpPlanRetry({ attempt: 1, outcome: 'retryable' });
    expect(result.value.shouldRetry).toBe(true);
    expect(result.value.delayMs > 0).toBe(true);
  });

  it('doubles the delay with the attempt', () => {
    const one = gcpPlanRetry({ attempt: 1, outcome: 'retryable' }).value.delayMs;
    const two = gcpPlanRetry({ attempt: 2, outcome: 'retryable' }).value.delayMs;
    expect(two).toBe(one * 2);
  });

  it('adds injected jitter rather than generating any', () => {
    const bare = gcpPlanRetry({ attempt: 1, outcome: 'retryable' }).value.delayMs;
    const jittered = gcpPlanRetry({ attempt: 1, outcome: 'retryable', jitterMs: 250 }).value.delayMs;
    expect(jittered).toBe(bare + 250);
  });

  it('never retries a permanent rejection', () => {
    const result = gcpPlanRetry({ attempt: 1, outcome: 'permanent' });
    expect(result.value.shouldRetry).toBe(false);
    expect(result.value.terminalReason).toContain('definitiv');
  });

  it('distinguishes a permanent rejection from an exhausted budget', () => {
    const permanent = gcpPlanRetry({ attempt: 1, outcome: 'permanent' }).value;
    const exhausted = gcpPlanRetry({
      attempt: GCP_UPLOAD_MAX_ATTEMPTS,
      outcome: 'retryable',
    }).value;
    expect(permanent.shouldRetry).toBe(false);
    expect(exhausted.shouldRetry).toBe(false);
    expect(permanent.terminalReason).not.toBe(exhausted.terminalReason);
  });

  it('asks for reauth instead of burning the budget on a dead token', () => {
    const result = gcpPlanRetry({ attempt: 1, outcome: 'reauthRequired' });
    expect(result.value.requiresReauth).toBe(true);
    expect(result.value.shouldRetry).toBe(false);
  });

  it('stops at the maximum attempt count', () => {
    expect(
      gcpPlanRetry({ attempt: GCP_UPLOAD_MAX_ATTEMPTS - 1, outcome: 'retryable' }).value.shouldRetry
    ).toBe(true);
    expect(
      gcpPlanRetry({ attempt: GCP_UPLOAD_MAX_ATTEMPTS, outcome: 'retryable' }).value.shouldRetry
    ).toBe(false);
  });

  it('refuses an invalid input', () => {
    expect(gcpPlanRetry(undefined).ok).toBe(false);
  });

  it('refuses an unknown outcome', () => {
    expect(gcpPlanRetry({ attempt: 1, outcome: 'talvez' }).ok).toBe(false);
  });
});
