import {
  AUDIO_DURATION_TOLERANCE_MS,
  AUDIO_MAX_DURATION_MS,
  AUDIO_MIN_VOICED_FRACTION,
  AUDIO_PREFERRED_MIME,
  AUDIO_SILENCE_PEAK_FLOOR,
  AUDIO_SIGNAL_SILENT,
  AUDIO_SIGNAL_UNKNOWN,
  AUDIO_SIGNAL_VOICED,
  AUDIO_STORAGE_FAILED,
  AUDIO_STORAGE_LOCAL_ONLY,
  AUDIO_STORAGE_PENDING,
  AUDIO_STORAGE_STORED,
  audioAssessSignal,
  audioAttachToReport,
  audioBindingsMatch,
  audioCheckVersion,
  audioDecideRetention,
  audioDescribeCapture,
  audioDescribeStorage,
  audioEvaluateReadiness,
  audioFinishSession,
  audioIsDurable,
  audioReconcileDuration,
  audioStartSession,
  audioStorageState,
  audioValidateBinding,
  type AudioBinding,
  type AudioCapture,
  type AudioEnvironment,
  type AudioSession,
} from './audioCapture';

const T0 = 1_760_000_000_000;

const BINDING: AudioBinding = {
  patientId: 'PAC-1',
  studyInstanceUid: '1.2.840.113619.2.55.3.1',
  reportId: 'LAU-77',
  reportVersion: 1,
};

function environment(over: Partial<AudioEnvironment> = {}): AudioEnvironment {
  return {
    permission: 'granted',
    devices: [{ deviceId: 'mic-1', label: 'Headset', enabled: true }],
    platform: 'web',
    supportedMimeTypes: [AUDIO_PREFERRED_MIME],
    ...over,
  };
}

function startedSession(over: Partial<AudioSession> = {}): AudioSession {
  const ready = audioEvaluateReadiness(environment());
  if (!ready.ok) {
    throw new Error('fixture broken');
  }
  const started = audioStartSession({
    sessionId: 'SES-1',
    binding: BINDING,
    readiness: ready.value,
    startedAt: T0,
  });
  if (!started.ok) {
    throw new Error('fixture broken: ' + started.reason);
  }
  return { ...started.value, ...over };
}

function finishedCapture(over: {
  recordedMs?: number;
  stoppedAt?: number;
  peakLevel?: number;
  voicedFraction?: number;
  samples?: number;
} = {}): AudioCapture {
  const session = startedSession();
  const recordedMs = over.recordedMs ?? 60_000;
  const result = audioFinishSession({
    session,
    stoppedAt: over.stoppedAt ?? T0 + recordedMs,
    recordedMs,
    byteSize: 240_000,
    signal: {
      peakLevel: over.peakLevel ?? 0.4,
      voicedFraction: over.voicedFraction ?? 0.6,
      samples: over.samples ?? 120,
    },
  });
  if (!result.ok) {
    throw new Error('fixture broken: ' + result.reason);
  }
  return result.value;
}

function stored(capture: AudioCapture): AudioCapture {
  return { ...capture, storage: AUDIO_STORAGE_STORED };
}

describe('audioValidateBinding', () => {
  it('accepts a complete binding and trims it', () => {
    const result = audioValidateBinding({ ...BINDING, patientId: '  PAC-1  ' });
    expect(result.ok).toBe(true);
    expect(result.value.patientId).toBe('PAC-1');
  });

  it('refuses a missing binding', () => {
    const result = audioValidateBinding(undefined as unknown as AudioBinding);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid-binding');
  });

  it('refuses three fields out of four', () => {
    const result = audioValidateBinding({ ...BINDING, reportId: '' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid-binding');
  });

  it('refuses a missing study uid', () => {
    expect(audioValidateBinding({ ...BINDING, studyInstanceUid: '   ' }).ok).toBe(false);
  });

  it('refuses a non-integer report version', () => {
    const result = audioValidateBinding({ ...BINDING, reportVersion: 1.5 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid-binding');
  });

  it('refuses version zero because the first version is 1', () => {
    expect(audioValidateBinding({ ...BINDING, reportVersion: 0 }).ok).toBe(false);
  });
});

describe('audioBindingsMatch', () => {
  it('matches identical bindings', () => {
    expect(audioBindingsMatch(BINDING, { ...BINDING })).toBe(true);
  });

  it('does not match on report id alone when the patient differs', () => {
    expect(audioBindingsMatch(BINDING, { ...BINDING, patientId: 'PAC-2' })).toBe(false);
  });

  it('does not match when the study was reloaded as a different study', () => {
    expect(audioBindingsMatch(BINDING, { ...BINDING, studyInstanceUid: '1.2.3' })).toBe(false);
  });

  it('does not match across report versions', () => {
    expect(audioBindingsMatch(BINDING, { ...BINDING, reportVersion: 2 })).toBe(false);
  });

  it('does not match a missing binding', () => {
    expect(audioBindingsMatch(BINDING, undefined as unknown as AudioBinding)).toBe(false);
  });
});

describe('audioEvaluateReadiness', () => {
  it('accepts a granted permission with a usable device', () => {
    const result = audioEvaluateReadiness(environment());
    expect(result.ok).toBe(true);
    expect(result.value.mimeType).toBe(AUDIO_PREFERRED_MIME);
    expect(result.value.device.deviceId).toBe('mic-1');
  });

  it('distinguishes denied permission from missing device', () => {
    const denied = audioEvaluateReadiness(environment({ permission: 'denied' }));
    const noDevice = audioEvaluateReadiness(environment({ devices: [] }));
    expect(denied.code).toBe('permission-denied');
    expect(noDevice.code).toBe('no-input-device');
    expect(denied.reason).not.toBe(noDevice.reason);
  });

  it('treats a not-yet-granted prompt as its own state', () => {
    const result = audioEvaluateReadiness(environment({ permission: 'prompt' }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('permission-unknown');
  });

  it('refuses an unknown permission state rather than trying', () => {
    const result = audioEvaluateReadiness(environment({ permission: 'unknown' }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('permission-unknown');
  });

  it('refuses a present but OS-muted microphone, naming the silent-file outcome', () => {
    const result = audioEvaluateReadiness(
      environment({ devices: [{ deviceId: 'mic-1', label: 'Headset', enabled: false }] })
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('no-input-device');
    expect(result.reason).toContain('silencio');
  });

  it('picks the first usable device when one is muted', () => {
    const result = audioEvaluateReadiness(
      environment({
        devices: [
          { deviceId: 'mic-muted', label: 'Monitor', enabled: false },
          { deviceId: 'mic-2', label: 'Headset', enabled: true },
        ],
      })
    );
    expect(result.ok).toBe(true);
    expect(result.value.device.deviceId).toBe('mic-2');
  });

  it('falls back to a supported mime and advises when Opus is unavailable', () => {
    const result = audioEvaluateReadiness(
      environment({ supportedMimeTypes: ['audio/mp4'] })
    );
    expect(result.ok).toBe(true);
    expect(result.value.mimeType).toBe('audio/mp4');
    expect(result.value.advisory).toContain('Opus');
  });

  it('does not advise when Opus is available', () => {
    expect(audioEvaluateReadiness(environment()).value.advisory).toBe(undefined);
  });

  it('carries the platform through', () => {
    expect(audioEvaluateReadiness(environment({ platform: 'desktop' })).value.platform).toBe(
      'desktop'
    );
  });

  it('refuses a missing environment', () => {
    const result = audioEvaluateReadiness(undefined as unknown as AudioEnvironment);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('permission-unknown');
  });
});

describe('audioStartSession', () => {
  it('starts a session bound to patient, study and report', () => {
    const session = startedSession();
    expect(session.sessionId).toBe('SES-1');
    expect(session.binding.reportId).toBe('LAU-77');
    expect(session.startedAt).toBe(T0);
    expect(session.stoppedAt).toBe(undefined);
  });

  it('refuses a second recorder while one is live', () => {
    const ready = audioEvaluateReadiness(environment());
    const result = audioStartSession({
      sessionId: 'SES-2',
      binding: BINDING,
      readiness: ready.value,
      startedAt: T0 + 1000,
      active: startedSession(),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('already-recording');
  });

  it('allows a new session once the previous one stopped', () => {
    const ready = audioEvaluateReadiness(environment());
    const result = audioStartSession({
      sessionId: 'SES-2',
      binding: BINDING,
      readiness: ready.value,
      startedAt: T0 + 1000,
      active: startedSession({ stoppedAt: T0 + 500 }),
    });
    expect(result.ok).toBe(true);
  });

  it('refuses an invalid start timestamp', () => {
    const ready = audioEvaluateReadiness(environment());
    const result = audioStartSession({
      sessionId: 'SES-1',
      binding: BINDING,
      readiness: ready.value,
      startedAt: 0,
    });
    expect(result.code).toBe('invalid-timestamp');
  });

  it('refuses an incomplete binding', () => {
    const ready = audioEvaluateReadiness(environment());
    const result = audioStartSession({
      sessionId: 'SES-1',
      binding: { ...BINDING, patientId: '' },
      readiness: ready.value,
      startedAt: T0,
    });
    expect(result.code).toBe('invalid-binding');
  });

  it('refuses when readiness carries no mime type', () => {
    const result = audioStartSession({
      sessionId: 'SES-1',
      binding: BINDING,
      readiness: { mimeType: '', device: { deviceId: 'mic-1', label: 'x' }, platform: 'web' },
      startedAt: T0,
    });
    expect(result.code).toBe('no-input-device');
  });

  it('refuses a session with no id', () => {
    const ready = audioEvaluateReadiness(environment());
    const result = audioStartSession({
      sessionId: '  ',
      binding: BINDING,
      readiness: ready.value,
      startedAt: T0,
    });
    expect(result.code).toBe('invalid-binding');
  });
});

describe('audioAssessSignal', () => {
  it('calls a real dictation voiced', () => {
    const assessment = audioAssessSignal({ peakLevel: 0.5, voicedFraction: 0.6, samples: 100 });
    expect(assessment.verdict).toBe(AUDIO_SIGNAL_VOICED);
    expect(assessment.message).toContain('60%');
  });

  it('calls a muted microphone silent', () => {
    const assessment = audioAssessSignal({ peakLevel: 0.001, voicedFraction: 0, samples: 100 });
    expect(assessment.verdict).toBe(AUDIO_SIGNAL_SILENT);
  });

  it('is silent exactly at the peak floor because the floor is exclusive below', () => {
    const atFloor = audioAssessSignal({
      peakLevel: AUDIO_SILENCE_PEAK_FLOOR,
      voicedFraction: 0.5,
      samples: 100,
    });
    const belowFloor = audioAssessSignal({
      peakLevel: AUDIO_SILENCE_PEAK_FLOOR - 0.001,
      voicedFraction: 0.5,
      samples: 100,
    });
    expect(atFloor.verdict).toBe(AUDIO_SIGNAL_VOICED);
    expect(belowFloor.verdict).toBe(AUDIO_SIGNAL_SILENT);
  });

  it('rejects a single click as a dictation via the voiced fraction', () => {
    const assessment = audioAssessSignal({
      peakLevel: 0.9,
      voicedFraction: AUDIO_MIN_VOICED_FRACTION - 0.001,
      samples: 500,
    });
    expect(assessment.verdict).toBe(AUDIO_SIGNAL_SILENT);
  });

  it('accepts exactly the minimum voiced fraction', () => {
    const assessment = audioAssessSignal({
      peakLevel: 0.9,
      voicedFraction: AUDIO_MIN_VOICED_FRACTION,
      samples: 500,
    });
    expect(assessment.verdict).toBe(AUDIO_SIGNAL_VOICED);
  });

  it('reports unknown, not silent, when nothing was measured', () => {
    const assessment = audioAssessSignal({ peakLevel: 0, voicedFraction: 0, samples: 0 });
    expect(assessment.verdict).toBe(AUDIO_SIGNAL_UNKNOWN);
    expect(assessment.message).toContain('nao observado');
  });

  it('reports unknown for a missing summary', () => {
    expect(audioAssessSignal(undefined as never).verdict).toBe(AUDIO_SIGNAL_UNKNOWN);
  });

  it('reports unknown for a non-finite peak', () => {
    const assessment = audioAssessSignal({
      peakLevel: Number.NaN,
      voicedFraction: 0.5,
      samples: 10,
    });
    expect(assessment.verdict).toBe(AUDIO_SIGNAL_UNKNOWN);
  });
});

describe('audioReconcileDuration', () => {
  it('accepts a recording that matches its session span', () => {
    const result = audioReconcileDuration({
      startedAt: T0,
      stoppedAt: T0 + 60_000,
      recordedMs: 60_000,
    });
    expect(result.ok).toBe(true);
    expect(result.value.truncated).toBe(false);
    expect(result.value.gapMs).toBe(0);
  });

  it('accepts a gap exactly at the tolerance', () => {
    const result = audioReconcileDuration({
      startedAt: T0,
      stoppedAt: T0 + 60_000,
      recordedMs: 60_000 - AUDIO_DURATION_TOLERANCE_MS,
    });
    expect(result.value.truncated).toBe(false);
  });

  it('flags a gap one millisecond past the tolerance', () => {
    const result = audioReconcileDuration({
      startedAt: T0,
      stoppedAt: T0 + 60_000,
      recordedMs: 60_000 - AUDIO_DURATION_TOLERANCE_MS - 1,
    });
    expect(result.value.truncated).toBe(true);
  });

  it('names the impression as what is lost when a recorder stops early', () => {
    const result = audioReconcileDuration({
      startedAt: T0,
      stoppedAt: T0 + 240_000,
      recordedMs: 100_000,
    });
    expect(result.value.truncated).toBe(true);
    expect(result.value.message).toContain('impressao');
  });

  it('honours an explicit tolerance', () => {
    const result = audioReconcileDuration({
      startedAt: T0,
      stoppedAt: T0 + 60_000,
      recordedMs: 50_000,
      toleranceMs: 20_000,
    });
    expect(result.value.truncated).toBe(false);
  });

  it('refuses a stop before the start', () => {
    const result = audioReconcileDuration({
      startedAt: T0,
      stoppedAt: T0 - 1,
      recordedMs: 10,
    });
    expect(result.code).toBe('invalid-timestamp');
  });

  it('refuses a negative recorded duration', () => {
    const result = audioReconcileDuration({
      startedAt: T0,
      stoppedAt: T0 + 10,
      recordedMs: -1,
    });
    expect(result.code).toBe('invalid-duration');
  });

  it('refuses an invalid timestamp', () => {
    expect(
      audioReconcileDuration({ startedAt: 0, stoppedAt: T0, recordedMs: 1 }).code
    ).toBe('invalid-timestamp');
  });
});

describe('audioFinishSession', () => {
  it('closes a session into a capture that is pending storage', () => {
    const capture = finishedCapture();
    expect(capture.storage).toBe(AUDIO_STORAGE_PENDING);
    expect(capture.signal.verdict).toBe(AUDIO_SIGNAL_VOICED);
    expect(capture.recordedMs).toBe(60_000);
  });

  it('keeps a silent capture instead of discarding the only copy', () => {
    const capture = finishedCapture({ peakLevel: 0.0005, voicedFraction: 0, samples: 50 });
    expect(capture.signal.verdict).toBe(AUDIO_SIGNAL_SILENT);
  });

  it('keeps a truncated capture and records the gap', () => {
    const capture = finishedCapture({ recordedMs: 10_000, stoppedAt: T0 + 240_000 });
    expect(capture.duration.truncated).toBe(true);
    expect(capture.duration.gapMs).toBe(230_000);
  });

  it('refuses to close a session twice', () => {
    const result = audioFinishSession({
      session: startedSession({ stoppedAt: T0 + 10 }),
      stoppedAt: T0 + 20,
      recordedMs: 10,
      byteSize: 100,
      signal: { peakLevel: 0.5, voicedFraction: 0.5, samples: 10 },
    });
    expect(result.code).toBe('not-recording');
  });

  it('refuses with no session at all', () => {
    const result = audioFinishSession({
      session: undefined as unknown as AudioSession,
      stoppedAt: T0,
      recordedMs: 1,
      byteSize: 1,
      signal: { peakLevel: 1, voicedFraction: 1, samples: 1 },
    });
    expect(result.code).toBe('not-recording');
  });

  it('refuses a negative byte size', () => {
    const result = audioFinishSession({
      session: startedSession(),
      stoppedAt: T0 + 1000,
      recordedMs: 1000,
      byteSize: -5,
      signal: { peakLevel: 0.5, voicedFraction: 0.5, samples: 10 },
    });
    expect(result.code).toBe('invalid-duration');
  });

  it('accepts a recording exactly at the maximum duration', () => {
    const session = startedSession();
    const result = audioFinishSession({
      session,
      stoppedAt: T0 + AUDIO_MAX_DURATION_MS,
      recordedMs: AUDIO_MAX_DURATION_MS,
      byteSize: 1,
      signal: { peakLevel: 0.5, voicedFraction: 0.5, samples: 10 },
    });
    expect(result.ok).toBe(true);
  });

  it('refuses one millisecond past the maximum, naming the open microphone', () => {
    const session = startedSession();
    const result = audioFinishSession({
      session,
      stoppedAt: T0 + AUDIO_MAX_DURATION_MS + 1,
      recordedMs: AUDIO_MAX_DURATION_MS + 1,
      byteSize: 1,
      signal: { peakLevel: 0.5, voicedFraction: 0.5, samples: 10 },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('over-max-duration');
    expect(result.reason).toContain('microfone');
  });
});

describe('audioStorageState and audioIsDurable', () => {
  it('accepts stored with a remote id', () => {
    const result = audioStorageState({ state: AUDIO_STORAGE_STORED, remoteId: 'obj-1' });
    expect(result.ok).toBe(true);
  });

  it('refuses stored without a remote id', () => {
    const result = audioStorageState({ state: AUDIO_STORAGE_STORED });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('storage-target-unresolved');
    expect(result.reason).toContain('evidencia');
  });

  it('refuses local-only without a local artefact id', () => {
    expect(audioStorageState({ state: AUDIO_STORAGE_LOCAL_ONLY }).ok).toBe(false);
  });

  it('accepts local-only with a local id', () => {
    expect(
      audioStorageState({ state: AUDIO_STORAGE_LOCAL_ONLY, localId: 'enc-1' }).ok
    ).toBe(true);
  });

  it('accepts pending and failed without identifiers', () => {
    expect(audioStorageState({ state: AUDIO_STORAGE_PENDING }).ok).toBe(true);
    expect(audioStorageState({ state: AUDIO_STORAGE_FAILED }).ok).toBe(true);
  });

  it('refuses an unknown state', () => {
    const result = audioStorageState({ state: 'synced' as never });
    expect(result.ok).toBe(false);
  });

  it('refuses a missing outcome', () => {
    expect(audioStorageState(undefined as never).ok).toBe(false);
  });

  it('treats only stored as durable, local-only included', () => {
    expect(audioIsDurable(AUDIO_STORAGE_STORED)).toBe(true);
    expect(audioIsDurable(AUDIO_STORAGE_LOCAL_ONLY)).toBe(false);
    expect(audioIsDurable(AUDIO_STORAGE_PENDING)).toBe(false);
    expect(audioIsDurable(AUDIO_STORAGE_FAILED)).toBe(false);
  });

  it('says out loud that local-only is not evidence off this workstation', () => {
    const text = audioDescribeStorage({
      ...finishedCapture(),
      storage: AUDIO_STORAGE_LOCAL_ONLY,
    });
    expect(text).toContain('nao e evidencia');
  });
});

describe('audioDecideRetention', () => {
  const base = {
    action: 'keep' as const,
    retainDays: 365,
    decidedBy: 'CRM-12345',
    decidedAt: T0,
    justification: 'Ditado mantido como parte do prontuario.',
  };

  it('accepts a keep decision with a period', () => {
    expect(audioDecideRetention(base).ok).toBe(true);
  });

  it('refuses keep without a period because that is keeping forever', () => {
    const result = audioDecideRetention({ ...base, retainDays: undefined });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('para sempre');
  });

  it('refuses keep with a fractional period', () => {
    expect(audioDecideRetention({ ...base, retainDays: 0.5 }).ok).toBe(false);
  });

  it('accepts a discard decision without a period', () => {
    const result = audioDecideRetention({
      ...base,
      action: 'discard-on-signature',
      retainDays: undefined,
    });
    expect(result.ok).toBe(true);
    expect(result.value.retainDays).toBe(undefined);
  });

  it('drops retainDays for a discard action', () => {
    const result = audioDecideRetention({ ...base, action: 'discard-after-transcription' });
    expect(result.value.retainDays).toBe(undefined);
  });

  it('refuses a decision with no author', () => {
    const result = audioDecideRetention({ ...base, decidedBy: '  ' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('autor');
  });

  it('refuses a decision with no justification', () => {
    expect(audioDecideRetention({ ...base, justification: '' }).ok).toBe(false);
  });

  it('refuses an unknown action', () => {
    expect(audioDecideRetention({ ...base, action: 'archive' as never }).ok).toBe(false);
  });

  it('refuses an invalid timestamp', () => {
    expect(audioDecideRetention({ ...base, decidedAt: 0 }).ok).toBe(false);
  });

  it('refuses a missing decision', () => {
    expect(audioDecideRetention(undefined as never).code).toBe('retention-undecided');
  });
});

describe('audioAttachToReport', () => {
  it('attaches a voiced, stored capture to the matching report', () => {
    const result = audioAttachToReport({
      capture: stored(finishedCapture()),
      currentBinding: BINDING,
      attachedAt: T0 + 90_000,
    });
    expect(result.ok).toBe(true);
    expect(result.value.acknowledgedDefect).toBe(undefined);
  });

  it('refuses when the report in focus changed during the dictation', () => {
    const result = audioAttachToReport({
      capture: stored(finishedCapture()),
      currentBinding: { ...BINDING, patientId: 'PAC-9', reportId: 'LAU-99' },
      attachedAt: T0 + 90_000,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('binding-mismatch');
    expect(result.reason).toContain('outro');
  });

  it('checks the binding before durability, because wrong patient outranks everything', () => {
    const result = audioAttachToReport({
      capture: finishedCapture(),
      currentBinding: { ...BINDING, patientId: 'PAC-9' },
      attachedAt: T0 + 90_000,
    });
    expect(result.code).toBe('binding-mismatch');
  });

  it('refuses a capture that is only in the local queue', () => {
    const result = audioAttachToReport({
      capture: { ...finishedCapture(), storage: AUDIO_STORAGE_LOCAL_ONLY },
      currentBinding: BINDING,
      attachedAt: T0 + 90_000,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not-durable');
    expect(result.reason).toContain('uma unica maquina');
  });

  it('refuses a pending capture', () => {
    const result = audioAttachToReport({
      capture: finishedCapture(),
      currentBinding: BINDING,
      attachedAt: T0 + 90_000,
    });
    expect(result.code).toBe('not-durable');
  });

  it('refuses a silent capture without acknowledgement', () => {
    const result = audioAttachToReport({
      capture: stored(finishedCapture({ peakLevel: 0.001, voicedFraction: 0, samples: 60 })),
      currentBinding: BINDING,
      attachedAt: T0 + 90_000,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('silent-capture');
  });

  it('attaches a silent capture when someone explicitly takes responsibility', () => {
    const result = audioAttachToReport({
      capture: stored(finishedCapture({ peakLevel: 0.001, voicedFraction: 0, samples: 60 })),
      currentBinding: BINDING,
      attachedAt: T0 + 90_000,
      acknowledgeDefect: 'silent-capture',
      acknowledgedBy: 'CRM-12345',
    });
    expect(result.ok).toBe(true);
    expect(result.value.acknowledgedBy).toBe('CRM-12345');
  });

  it('does not accept an acknowledgement with no one behind it', () => {
    const result = audioAttachToReport({
      capture: stored(finishedCapture({ peakLevel: 0.001, voicedFraction: 0, samples: 60 })),
      currentBinding: BINDING,
      attachedAt: T0 + 90_000,
      acknowledgeDefect: 'silent-capture',
      acknowledgedBy: '   ',
    });
    expect(result.ok).toBe(false);
  });

  it('does not accept an acknowledgement of the wrong defect', () => {
    const result = audioAttachToReport({
      capture: stored(finishedCapture({ peakLevel: 0.001, voicedFraction: 0, samples: 60 })),
      currentBinding: BINDING,
      attachedAt: T0 + 90_000,
      acknowledgeDefect: 'truncated-capture',
      acknowledgedBy: 'CRM-12345',
    });
    expect(result.code).toBe('silent-capture');
  });

  it('refuses an unmeasured capture the same way as a silent one', () => {
    const result = audioAttachToReport({
      capture: stored(finishedCapture({ samples: 0, peakLevel: 0, voicedFraction: 0 })),
      currentBinding: BINDING,
      attachedAt: T0 + 90_000,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('silent-capture');
    expect(result.reason).toContain('nao foi observado');
  });

  it('refuses a truncated capture without acknowledgement', () => {
    const result = audioAttachToReport({
      capture: stored(finishedCapture({ recordedMs: 10_000, stoppedAt: T0 + 240_000 })),
      currentBinding: BINDING,
      attachedAt: T0 + 250_000,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('truncated-capture');
  });

  it('attaches a truncated capture with the matching acknowledgement', () => {
    const result = audioAttachToReport({
      capture: stored(finishedCapture({ recordedMs: 10_000, stoppedAt: T0 + 240_000 })),
      currentBinding: BINDING,
      attachedAt: T0 + 250_000,
      acknowledgeDefect: 'truncated-capture',
      acknowledgedBy: 'CRM-12345',
    });
    expect(result.ok).toBe(true);
  });

  it('refuses to leave audio on a signed report with no retention decision', () => {
    const result = audioAttachToReport({
      capture: stored(finishedCapture()),
      currentBinding: BINDING,
      attachedAt: T0 + 90_000,
      reportSigned: true,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('retention-undecided');
  });

  it('allows a signed report once retention was decided', () => {
    const retention = audioDecideRetention({
      action: 'discard-on-signature',
      decidedBy: 'CRM-12345',
      decidedAt: T0,
      justification: 'Transcricao conferida.',
    });
    const result = audioAttachToReport({
      capture: { ...stored(finishedCapture()), retention: retention.value },
      currentBinding: BINDING,
      attachedAt: T0 + 90_000,
      reportSigned: true,
    });
    expect(result.ok).toBe(true);
  });

  it('refuses an invalid attach timestamp', () => {
    const result = audioAttachToReport({
      capture: stored(finishedCapture()),
      currentBinding: BINDING,
      attachedAt: 0,
    });
    expect(result.code).toBe('invalid-timestamp');
  });

  it('refuses an incomplete current binding', () => {
    const result = audioAttachToReport({
      capture: stored(finishedCapture()),
      currentBinding: { ...BINDING, reportId: '' },
      attachedAt: T0 + 1,
    });
    expect(result.code).toBe('invalid-binding');
  });

  it('refuses with no capture', () => {
    const result = audioAttachToReport({
      capture: undefined as unknown as AudioCapture,
      currentBinding: BINDING,
      attachedAt: T0,
    });
    expect(result.code).toBe('not-recording');
  });
});

describe('audioCheckVersion', () => {
  const attachment = audioAttachToReport({
    capture: stored(finishedCapture()),
    currentBinding: BINDING,
    attachedAt: T0 + 90_000,
  });

  it('accepts audio recorded for the current version', () => {
    expect(audioCheckVersion(attachment.value, 1).ok).toBe(true);
  });

  it('refuses v1 audio beside v2 text, naming the misattribution', () => {
    const result = audioCheckVersion(attachment.value, 2);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('stale-for-version');
    expect(result.reason).toContain('conclusao errada');
  });

  it('refuses an invalid current version', () => {
    expect(audioCheckVersion(attachment.value, 0).code).toBe('stale-for-version');
  });

  it('refuses with no attachment', () => {
    expect(audioCheckVersion(undefined as never, 1).code).toBe('not-recording');
  });
});

describe('audioDescribeCapture', () => {
  it('reports duration, signal and storage', () => {
    const text = audioDescribeCapture(stored(finishedCapture()));
    expect(text).toContain('60s');
    expect(text).toContain('voz');
    expect(text).toContain('servidor');
  });

  it('mentions truncation when present', () => {
    const text = audioDescribeCapture(
      stored(finishedCapture({ recordedMs: 10_000, stoppedAt: T0 + 240_000 }))
    );
    expect(text).toContain('truncada');
  });

  it('returns an empty string for no capture', () => {
    expect(audioDescribeCapture(undefined as never)).toBe('');
  });
});
