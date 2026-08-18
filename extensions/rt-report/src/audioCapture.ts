/**
 * Dictation audio capture: session lifecycle, signal verification, storage target and
 * retention -- pure core (RTV-111).
 *
 * The browser side of this ticket is a `MediaRecorder` and a button. That part is small and
 * hard to get wrong. Everything that is easy to get wrong lives here, because the whole
 * feature has one property that makes it dangerous: **a recording that captured nothing
 * looks exactly like a recording that captured everything**. There is no feedback loop. The
 * radiologist speaks for four minutes, sees a red dot the whole time, and finds out the
 * microphone was muted when someone tries to transcribe it -- possibly days later, possibly
 * after the report was already signed from memory.
 *
 * So the guards here are not input validation. Each one exists because of a specific way a
 * dictated report is lost or attached to the wrong patient.
 *
 * ## The recording of silence
 *
 * A muted microphone, a headset that was unplugged, an input device that the OS reassigned
 * to a monitor's dummy audio output: all of these produce a perfectly well-formed Opus file
 * of the correct duration containing silence. {@link audioFinishSession} therefore requires
 * an observed signal summary and classifies the result as {@link AUDIO_SIGNAL_SILENT} when
 * the level never rose above the floor. Attaching a silent capture as a report's dictation
 * is a **refusal**, overridable only by an explicit acknowledgement -- because there is a
 * legitimate case (the clinician recorded nothing on purpose and wants to keep the take) and
 * the wrong thing to do is guess which case it is.
 *
 * The signal floor is expressed as a peak level, not an average. An average over four
 * minutes of speech with pauses sits low enough that a real dictation and a room-noise-only
 * recording are not separable by it.
 *
 * ## Permission denied and no device are different problems
 *
 * They present the same way -- no audio -- and the remedy is completely different: one is a
 * browser setting the user can change, the other is a headset to plug in. Collapsing them
 * into "não foi possível gravar" sends the user to the wrong place, and on a shared
 * radiology workstation that is the difference between thirty seconds and a support ticket.
 * They are separate states here and separate messages.
 *
 * ## The capture that lands on the wrong report
 *
 * A capture session binds patient, study and report at **start**. Radiologists switch
 * studies constantly, and a four-minute dictation that finishes while a different report is
 * open must not attach to whatever is now in focus -- that is a dictation about patient A
 * filed under patient B, which reads as a real finding about the wrong person.
 * {@link audioAttachToReport} refuses on any binding mismatch, and the binding is compared
 * field by field rather than by a single id, because a report id that was reused or a study
 * that was reloaded under the same id both happen.
 *
 * ## Saved, and saved where
 *
 * Web saves to Connect; the desktop build (RTVW) encrypts locally and syncs later. Those are
 * not the same fact, and "gravado" must never render for a capture that exists only in a
 * local queue: a report signed on the strength of audio that lives on one workstation's disk
 * is a report whose evidence disappears when that workstation is reimaged.
 * {@link audioStorageState} keeps `pending`, `local-only`, `stored` and `failed` distinct,
 * and {@link audioIsDurable} is the single predicate the UI may use to say the audio is
 * safe.
 *
 * ## Truncation
 *
 * A suspended tab, a memory ceiling or a device change stops a recorder without an error.
 * The recorded duration then disagrees with the wall-clock span of the session, and the
 * missing part is usually the end -- which in a dictation is the impression, the part that
 * carries the conclusion. {@link audioReconcileDuration} compares the two and reports
 * `truncated` with the size of the gap rather than accepting the shorter file.
 *
 * ## Retention is a decision, not a default
 *
 * A voice recording of a physician discussing a patient is personal data of both of them,
 * and under the LGPD keeping it needs a reason and a period. The core will not let audio
 * stay attached to a **signed** report without a recorded retention decision, because the
 * default that would otherwise apply is "keep forever, because nobody chose".
 *
 * Framework-free, no `@ohif/*`, no clock, no randomness, no `throw`. Zero-fork per RTV-114.
 */

/* ------------------------------------------------------------------ */
/* Result type                                                         */
/* ------------------------------------------------------------------ */

export type AudioRefusalCode =
  | 'permission-denied'
  | 'permission-unknown'
  | 'no-input-device'
  | 'device-changed'
  | 'invalid-binding'
  | 'binding-mismatch'
  | 'not-recording'
  | 'already-recording'
  | 'invalid-timestamp'
  | 'invalid-duration'
  | 'silent-capture'
  | 'truncated-capture'
  | 'over-max-duration'
  | 'storage-target-unresolved'
  | 'not-durable'
  | 'retention-undecided'
  | 'stale-for-version';

/**
 * Refusals travel as values. The optional `value?: undefined` / `reason?: undefined`
 * members are required because `strictNullChecks` is off in this repo: without them a union
 * discriminated by a boolean literal does not narrow, and every caller has to cast.
 */
export type AudioResult<T> =
  | { ok: true; value: T; code?: undefined; reason?: undefined }
  | { ok: false; code: AudioRefusalCode; reason: string; value?: undefined };

function audioOk<T>(value: T): AudioResult<T> {
  return { ok: true, value };
}

function audioRefuse<T>(code: AudioRefusalCode, reason: string): AudioResult<T> {
  return { ok: false, code, reason };
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/**
 * Peak level below which a capture is treated as silence, on a normalised 0..1 scale.
 *
 * Peak and not average: averaged over a real dictation, the pauses between sentences pull
 * the mean down to roughly where room noise sits, so an average cannot separate speech from
 * an empty room. A peak can.
 */
export const AUDIO_SILENCE_PEAK_FLOOR = 0.02;

/**
 * Fraction of the session during which some signal must be present.
 *
 * A capture with a single click at the start and nothing after is not a dictation, and it
 * clears a peak-only test.
 */
export const AUDIO_MIN_VOICED_FRACTION = 0.02;

/** Tolerated disagreement between recorded duration and session wall-clock span, ms. */
export const AUDIO_DURATION_TOLERANCE_MS = 1500;

/**
 * Hard ceiling on one capture, ms (30 minutes).
 *
 * Not a resource limit. A recorder left running because the stop button was missed produces
 * a file whose useful part cannot be found, and it keeps the microphone live in a reading
 * room where other patients are being discussed.
 */
export const AUDIO_MAX_DURATION_MS = 30 * 60 * 1000;

/** Preferred container/codec. Opus for size at speech bitrates. */
export const AUDIO_PREFERRED_MIME = 'audio/webm;codecs=opus';

export const AUDIO_SIGNAL_VOICED = 'voiced';
export const AUDIO_SIGNAL_SILENT = 'silent';
export const AUDIO_SIGNAL_UNKNOWN = 'unknown';

export type AudioSignalVerdict =
  | typeof AUDIO_SIGNAL_VOICED
  | typeof AUDIO_SIGNAL_SILENT
  | typeof AUDIO_SIGNAL_UNKNOWN;

export const AUDIO_SIGNAL_LABELS: Record<AudioSignalVerdict, string> = {
  voiced: 'sinal de voz presente',
  silent: 'silencio -- nada foi captado',
  unknown: 'nivel de sinal nao observado',
};

export const AUDIO_STORAGE_PENDING = 'pending';
export const AUDIO_STORAGE_LOCAL_ONLY = 'local-only';
export const AUDIO_STORAGE_STORED = 'stored';
export const AUDIO_STORAGE_FAILED = 'failed';

export type AudioStorageState =
  | typeof AUDIO_STORAGE_PENDING
  | typeof AUDIO_STORAGE_LOCAL_ONLY
  | typeof AUDIO_STORAGE_STORED
  | typeof AUDIO_STORAGE_FAILED;

export const AUDIO_STORAGE_LABELS: Record<AudioStorageState, string> = {
  pending: 'gravacao em transito -- ainda nao guardada',
  'local-only': 'cifrada nesta estacao, ainda nao sincronizada',
  stored: 'guardada no servidor',
  failed: 'falha ao guardar',
};

export type AudioPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

export const AUDIO_PERMISSION_LABELS: Record<AudioPermission, string> = {
  granted: 'microfone autorizado',
  denied: 'microfone bloqueado nas permissoes do navegador',
  prompt: 'autorizacao do microfone ainda nao concedida',
  unknown: 'estado de autorizacao do microfone desconhecido',
};

export type AudioPlatform = 'web' | 'desktop';

/* ------------------------------------------------------------------ */
/* Binding                                                            */
/* ------------------------------------------------------------------ */

/** What a capture is a dictation *about*, fixed at start. */
export interface AudioBinding {
  patientId: string;
  studyInstanceUid: string;
  reportId: string;
  /** Report version the dictation belongs to. */
  reportVersion: number;
}

function audioText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function audioIsEpochMs(value: unknown): boolean {
  return typeof value === 'number' && isFinite(value) && value > 0 && Math.floor(value) === value;
}

function audioIsPositiveInt(value: unknown): boolean {
  return typeof value === 'number' && isFinite(value) && value >= 1 && Math.floor(value) === value;
}

/** Validates a binding. All four fields are required; three of four is not a binding. */
export function audioValidateBinding(binding: AudioBinding): AudioResult<AudioBinding> {
  if (!binding) {
    return audioRefuse('invalid-binding', 'Gravacao sem vinculo de paciente, estudo e laudo.');
  }
  const patientId = audioText(binding.patientId);
  const studyInstanceUid = audioText(binding.studyInstanceUid);
  const reportId = audioText(binding.reportId);
  if (!patientId || !studyInstanceUid || !reportId) {
    return audioRefuse(
      'invalid-binding',
      'Gravacao exige paciente, estudo e laudo identificados -- um ditado sem vinculo completo nao pode ser anexado com seguranca.'
    );
  }
  if (!audioIsPositiveInt(binding.reportVersion)) {
    return audioRefuse('invalid-binding', 'Gravacao sem versao de laudo valida.');
  }
  return audioOk({ patientId, studyInstanceUid, reportId, reportVersion: binding.reportVersion });
}

/**
 * Compares two bindings field by field.
 *
 * Field by field and not by report id alone: a report id reused after a delete, or a study
 * reloaded under the same id with a different patient, both defeat a single-id check, and
 * both put a dictation about one patient under another's name.
 */
export function audioBindingsMatch(a: AudioBinding, b: AudioBinding): boolean {
  if (!a || !b) {
    return false;
  }
  return (
    audioText(a.patientId) === audioText(b.patientId) &&
    audioText(a.studyInstanceUid) === audioText(b.studyInstanceUid) &&
    audioText(a.reportId) === audioText(b.reportId) &&
    a.reportVersion === b.reportVersion
  );
}

/* ------------------------------------------------------------------ */
/* Device readiness                                                   */
/* ------------------------------------------------------------------ */

export interface AudioInputDevice {
  deviceId: string;
  label: string;
  /** False when the OS reports the device present but muted. */
  enabled?: boolean;
}

export interface AudioEnvironment {
  permission: AudioPermission;
  devices: AudioInputDevice[];
  platform: AudioPlatform;
  /** Mime types the runtime will actually record. */
  supportedMimeTypes?: string[];
}

export interface AudioReadiness {
  mimeType: string;
  device: AudioInputDevice;
  platform: AudioPlatform;
  /** Present when the device is usable but something about it is worth saying. */
  advisory?: string;
}

/**
 * Whether a capture may start, and with what.
 *
 * Denied, prompt and no-device are three refusals with three different remedies, kept apart
 * on purpose: telling a user "nao foi possivel gravar" when the fix is one click in the
 * address bar wastes the reading session, and on a shared workstation the same message when
 * the headset is unplugged sends them to the wrong place entirely.
 */
export function audioEvaluateReadiness(environment: AudioEnvironment): AudioResult<AudioReadiness> {
  if (!environment) {
    return audioRefuse('permission-unknown', AUDIO_PERMISSION_LABELS.unknown + '.');
  }
  const permission: AudioPermission = environment.permission ?? 'unknown';

  if (permission === 'denied') {
    return audioRefuse(
      'permission-denied',
      'Microfone bloqueado nas permissoes do navegador -- libere o microfone para este endereco e tente de novo.'
    );
  }
  if (permission === 'prompt') {
    return audioRefuse(
      'permission-unknown',
      'Autorizacao do microfone ainda nao concedida -- aceite o pedido do navegador para comecar a gravar.'
    );
  }
  if (permission !== 'granted') {
    return audioRefuse(
      'permission-unknown',
      'Estado de autorizacao do microfone desconhecido -- nao e seguro comecar a gravar sem saber se ha captacao.'
    );
  }

  const devices = (environment.devices ?? []).filter(d => d && audioText(d.deviceId));
  if (!devices.length) {
    return audioRefuse(
      'no-input-device',
      'Nenhum microfone encontrado -- conecte o headset. Isto e diferente de permissao negada.'
    );
  }

  const usable = devices.filter(d => d.enabled !== false);
  if (!usable.length) {
    return audioRefuse(
      'no-input-device',
      'O microfone esta presente mas silenciado pelo sistema -- gravar assim produz um arquivo de silencio com a duracao correta.'
    );
  }

  const supported = environment.supportedMimeTypes ?? [];
  const mimeType = supported.includes(AUDIO_PREFERRED_MIME)
    ? AUDIO_PREFERRED_MIME
    : supported.length
      ? supported[0]
      : AUDIO_PREFERRED_MIME;

  const advisory =
    supported.length && !supported.includes(AUDIO_PREFERRED_MIME)
      ? 'Codec Opus indisponivel -- gravando em ' + mimeType + ', arquivo maior.'
      : undefined;

  return audioOk({
    mimeType,
    device: usable[0],
    platform: environment.platform === 'desktop' ? 'desktop' : 'web',
    advisory,
  });
}

/* ------------------------------------------------------------------ */
/* Session lifecycle                                                  */
/* ------------------------------------------------------------------ */

export interface AudioSession {
  sessionId: string;
  binding: AudioBinding;
  deviceId: string;
  mimeType: string;
  platform: AudioPlatform;
  startedAt: number;
  /** Set when the session has been finished. */
  stoppedAt?: number;
}

export function audioStartSession(input: {
  sessionId: string;
  binding: AudioBinding;
  readiness: AudioReadiness;
  startedAt: number;
  active?: AudioSession;
}): AudioResult<AudioSession> {
  if (!input) {
    return audioRefuse('invalid-binding', 'Pedido de gravacao vazio.');
  }
  // Two live recorders on one machine means two files, one of which nobody knows about,
  // and the microphone stays open after the visible indicator is dismissed.
  if (input.active && !input.active.stoppedAt) {
    return audioRefuse(
      'already-recording',
      'Ja existe uma gravacao em andamento -- pare a atual antes de comecar outra.'
    );
  }
  if (!audioText(input.sessionId)) {
    return audioRefuse('invalid-binding', 'Gravacao sem identificador de sessao.');
  }
  if (!audioIsEpochMs(input.startedAt)) {
    return audioRefuse('invalid-timestamp', 'Horario de inicio da gravacao invalido.');
  }
  const binding = audioValidateBinding(input.binding);
  if (!binding.ok) {
    return audioRefuse(binding.code, binding.reason);
  }
  if (!input.readiness || !audioText(input.readiness.mimeType)) {
    return audioRefuse('no-input-device', 'Gravacao sem dispositivo e formato resolvidos.');
  }

  return audioOk({
    sessionId: audioText(input.sessionId),
    binding: binding.value,
    deviceId: audioText(input.readiness.device?.deviceId),
    mimeType: input.readiness.mimeType,
    platform: input.readiness.platform,
    startedAt: input.startedAt,
  });
}

/* ------------------------------------------------------------------ */
/* Signal and duration                                                */
/* ------------------------------------------------------------------ */

/** What the caller observed while recording. Levels normalised 0..1. */
export interface AudioSignalSummary {
  peakLevel: number;
  /** Fraction of sampled windows above the floor, 0..1. */
  voicedFraction: number;
  /** Number of level observations taken. Zero means nothing was measured. */
  samples: number;
}

export interface AudioSignalAssessment {
  verdict: AudioSignalVerdict;
  peakLevel: number;
  voicedFraction: number;
  message: string;
}

/**
 * Classifies the captured signal.
 *
 * `unknown` is deliberately not folded into either of the other two. A capture whose level
 * was never observed is not evidence of silence and not evidence of speech, and the honest
 * output is to say the measurement is missing -- the same distinction this codebase draws
 * everywhere between an empty result and an unloaded one.
 */
export function audioAssessSignal(summary: AudioSignalSummary): AudioSignalAssessment {
  const peakLevel = Number(summary?.peakLevel);
  const voicedFraction = Number(summary?.voicedFraction);
  const samples = Number(summary?.samples);

  if (!isFinite(samples) || samples <= 0 || !isFinite(peakLevel)) {
    return {
      verdict: AUDIO_SIGNAL_UNKNOWN,
      peakLevel: isFinite(peakLevel) ? peakLevel : 0,
      voicedFraction: isFinite(voicedFraction) ? voicedFraction : 0,
      message:
        'Nivel de sinal nao observado durante a gravacao -- nao e possivel afirmar que houve captacao.',
    };
  }

  const voiced = isFinite(voicedFraction) ? voicedFraction : 0;

  if (peakLevel < AUDIO_SILENCE_PEAK_FLOOR || voiced < AUDIO_MIN_VOICED_FRACTION) {
    return {
      verdict: AUDIO_SIGNAL_SILENT,
      peakLevel,
      voicedFraction: voiced,
      message:
        'A gravacao esta silenciosa (pico ' +
        peakLevel.toFixed(3) +
        ') -- o arquivo tem a duracao correta e nao contem voz.',
    };
  }

  return {
    verdict: AUDIO_SIGNAL_VOICED,
    peakLevel,
    voicedFraction: voiced,
    message: 'Sinal de voz presente em ' + Math.round(voiced * 100) + '% da gravacao.',
  };
}

export interface AudioDurationCheck {
  ok: boolean;
  recordedMs: number;
  wallClockMs: number;
  gapMs: number;
  truncated: boolean;
  message: string;
}

/**
 * Reconciles the recorded duration against the session's wall-clock span.
 *
 * A suspended tab or a memory ceiling stops a recorder with no error, so the file is simply
 * shorter than the session -- and what is missing is the end, which in a dictation is the
 * impression. Accepting the shorter file means losing the conclusion and not knowing it.
 */
export function audioReconcileDuration(input: {
  startedAt: number;
  stoppedAt: number;
  recordedMs: number;
  toleranceMs?: number;
}): AudioResult<AudioDurationCheck> {
  if (!input || !audioIsEpochMs(input.startedAt) || !audioIsEpochMs(input.stoppedAt)) {
    return audioRefuse('invalid-timestamp', 'Horarios de inicio e fim da gravacao invalidos.');
  }
  if (input.stoppedAt < input.startedAt) {
    return audioRefuse('invalid-timestamp', 'Gravacao termina antes de comecar.');
  }
  const recordedMs = Number(input.recordedMs);
  if (!isFinite(recordedMs) || recordedMs < 0) {
    return audioRefuse('invalid-duration', 'Duracao gravada invalida.');
  }

  const wallClockMs = input.stoppedAt - input.startedAt;
  const tolerance =
    isFinite(Number(input.toleranceMs)) && Number(input.toleranceMs) >= 0
      ? Number(input.toleranceMs)
      : AUDIO_DURATION_TOLERANCE_MS;
  const gapMs = wallClockMs - recordedMs;
  const truncated = gapMs > tolerance;

  return audioOk({
    ok: !truncated,
    recordedMs,
    wallClockMs,
    gapMs,
    truncated,
    message: truncated
      ? 'Faltam ' +
        Math.round(gapMs / 1000) +
        's no fim da gravacao -- num ditado o fim e a impressao.'
      : 'Duracao gravada compativel com a sessao.',
  });
}

/* ------------------------------------------------------------------ */
/* Finishing a capture                                                */
/* ------------------------------------------------------------------ */

export interface AudioCapture {
  sessionId: string;
  binding: AudioBinding;
  mimeType: string;
  platform: AudioPlatform;
  startedAt: number;
  stoppedAt: number;
  recordedMs: number;
  byteSize: number;
  signal: AudioSignalAssessment;
  duration: AudioDurationCheck;
  storage: AudioStorageState;
  /** Present once a retention decision has been recorded. */
  retention?: AudioRetentionDecision;
}

/**
 * Closes a session into a capture.
 *
 * Note what this does *not* do: it does not refuse a silent or truncated capture. The file
 * exists and discarding it here would destroy the only copy of whatever was recorded. The
 * refusal belongs at {@link audioAttachToReport}, where the question is whether this audio
 * may stand as the report's dictation.
 */
export function audioFinishSession(input: {
  session: AudioSession;
  stoppedAt: number;
  recordedMs: number;
  byteSize: number;
  signal: AudioSignalSummary;
}): AudioResult<AudioCapture> {
  if (!input || !input.session) {
    return audioRefuse('not-recording', 'Nenhuma gravacao em andamento para encerrar.');
  }
  if (input.session.stoppedAt) {
    return audioRefuse('not-recording', 'Esta gravacao ja foi encerrada.');
  }
  if (!audioIsEpochMs(input.stoppedAt)) {
    return audioRefuse('invalid-timestamp', 'Horario de fim da gravacao invalido.');
  }
  const byteSize = Number(input.byteSize);
  if (!isFinite(byteSize) || byteSize < 0) {
    return audioRefuse('invalid-duration', 'Tamanho do arquivo de audio invalido.');
  }

  const duration = audioReconcileDuration({
    startedAt: input.session.startedAt,
    stoppedAt: input.stoppedAt,
    recordedMs: input.recordedMs,
  });
  if (!duration.ok) {
    return audioRefuse(duration.code, duration.reason);
  }

  if (duration.value.recordedMs > AUDIO_MAX_DURATION_MS) {
    return audioRefuse(
      'over-max-duration',
      'Gravacao acima do limite de ' +
        Math.round(AUDIO_MAX_DURATION_MS / 60000) +
        ' minutos -- um gravador esquecido aberto mantem o microfone vivo numa sala onde outros pacientes sao discutidos.'
    );
  }

  return audioOk({
    sessionId: input.session.sessionId,
    binding: input.session.binding,
    mimeType: input.session.mimeType,
    platform: input.session.platform,
    startedAt: input.session.startedAt,
    stoppedAt: input.stoppedAt,
    recordedMs: duration.value.recordedMs,
    byteSize,
    signal: audioAssessSignal(input.signal),
    duration: duration.value,
    storage: AUDIO_STORAGE_PENDING,
  });
}

/* ------------------------------------------------------------------ */
/* Storage                                                            */
/* ------------------------------------------------------------------ */

export interface AudioStorageOutcome {
  /** Where the bytes ended up, as reported by the platform layer. */
  state: AudioStorageState;
  /** Server-side identifier. Required for `stored`. */
  remoteId?: string;
  /** Local encrypted artefact identifier. Required for `local-only`. */
  localId?: string;
  detail?: string;
}

/**
 * Resolves the storage state, refusing states that claim more than their evidence supports.
 *
 * `stored` without a remote identifier is the dangerous one: it is the state the UI renders
 * as "gravado", and it would be doing so on the strength of nothing. A report signed on
 * audio that only ever existed in a local queue loses its evidence the day that workstation
 * is reimaged.
 */
export function audioStorageState(outcome: AudioStorageOutcome): AudioResult<AudioStorageOutcome> {
  if (!outcome) {
    return audioRefuse('storage-target-unresolved', 'Destino do audio nao resolvido.');
  }
  const state = outcome.state;
  if (state === AUDIO_STORAGE_STORED && !audioText(outcome.remoteId)) {
    return audioRefuse(
      'storage-target-unresolved',
      'Audio marcado como guardado no servidor sem identificador remoto -- isso renderiza "gravado" sem nenhuma evidencia.'
    );
  }
  if (state === AUDIO_STORAGE_LOCAL_ONLY && !audioText(outcome.localId)) {
    return audioRefuse(
      'storage-target-unresolved',
      'Audio marcado como local sem identificador do artefato cifrado.'
    );
  }
  if (
    state !== AUDIO_STORAGE_PENDING &&
    state !== AUDIO_STORAGE_LOCAL_ONLY &&
    state !== AUDIO_STORAGE_STORED &&
    state !== AUDIO_STORAGE_FAILED
  ) {
    return audioRefuse('storage-target-unresolved', 'Estado de armazenamento desconhecido.');
  }
  return audioOk(outcome);
}

/**
 * The one predicate the UI may use to claim the audio is safe.
 *
 * `local-only` is deliberately not durable, even on the desktop build where local encrypted
 * storage is the designed path: it is durable *for that machine*, and the report is not.
 */
export function audioIsDurable(state: AudioStorageState): boolean {
  return state === AUDIO_STORAGE_STORED;
}

/** What the recording indicator and the saved-state chip should say. */
export function audioDescribeStorage(capture: AudioCapture): string {
  if (!capture) {
    return '';
  }
  const base = AUDIO_STORAGE_LABELS[capture.storage] ?? AUDIO_STORAGE_LABELS.pending;
  if (capture.storage === AUDIO_STORAGE_LOCAL_ONLY) {
    return base + ' -- ainda nao e evidencia do laudo fora desta estacao.';
  }
  return base + '.';
}

/* ------------------------------------------------------------------ */
/* Retention                                                          */
/* ------------------------------------------------------------------ */

export type AudioRetentionAction = 'keep' | 'discard-after-transcription' | 'discard-on-signature';

export const AUDIO_RETENTION_LABELS: Record<AudioRetentionAction, string> = {
  keep: 'manter o audio como parte do prontuario',
  'discard-after-transcription': 'descartar o audio apos a transcricao ser conferida',
  'discard-on-signature': 'descartar o audio ao assinar o laudo',
};

export interface AudioRetentionDecision {
  action: AudioRetentionAction;
  /** Days to keep, required for `keep`. */
  retainDays?: number;
  decidedBy: string;
  decidedAt: number;
  justification: string;
}

/**
 * Records a retention decision.
 *
 * The voice of a physician discussing a named patient is personal data of both, and keeping
 * it needs a stated reason and a period. Without this the default that applies is "keep
 * forever, because nobody chose" -- which is the one option nobody would pick deliberately.
 */
export function audioDecideRetention(
  input: AudioRetentionDecision
): AudioResult<AudioRetentionDecision> {
  if (!input) {
    return audioRefuse('retention-undecided', 'Decisao de retencao ausente.');
  }
  if (!AUDIO_RETENTION_LABELS[input.action]) {
    return audioRefuse('retention-undecided', 'Acao de retencao desconhecida.');
  }
  if (!audioText(input.decidedBy)) {
    return audioRefuse(
      'retention-undecided',
      'Decisao de retencao sem responsavel -- uma decisao sobre dado pessoal precisa de autor.'
    );
  }
  if (!audioIsEpochMs(input.decidedAt)) {
    return audioRefuse('retention-undecided', 'Decisao de retencao sem horario valido.');
  }
  if (!audioText(input.justification)) {
    return audioRefuse('retention-undecided', 'Decisao de retencao sem justificativa.');
  }
  if (input.action === 'keep' && !audioIsPositiveInt(input.retainDays)) {
    return audioRefuse(
      'retention-undecided',
      'Manter o audio exige um prazo em dias -- "manter" sem prazo e manter para sempre.'
    );
  }
  return audioOk({
    action: input.action,
    retainDays: input.action === 'keep' ? input.retainDays : undefined,
    decidedBy: audioText(input.decidedBy),
    decidedAt: input.decidedAt,
    justification: audioText(input.justification),
  });
}

/* ------------------------------------------------------------------ */
/* Attaching to a report                                              */
/* ------------------------------------------------------------------ */

export interface AudioAttachment {
  capture: AudioCapture;
  attachedAt: number;
  /** Set when a silent or truncated capture was attached deliberately. */
  acknowledgedDefect?: AudioRefusalCode;
  acknowledgedBy?: string;
}

/**
 * Attaches a capture as the report's dictation.
 *
 * This is where the refusals live, because this is where the audio starts standing for
 * something. Order matters: binding first (wrong patient outranks every other problem),
 * then durability, then the defects that a human may knowingly accept.
 */
export function audioAttachToReport(input: {
  capture: AudioCapture;
  currentBinding: AudioBinding;
  attachedAt: number;
  reportSigned?: boolean;
  acknowledgeDefect?: AudioRefusalCode;
  acknowledgedBy?: string;
}): AudioResult<AudioAttachment> {
  if (!input || !input.capture) {
    return audioRefuse('not-recording', 'Nenhuma gravacao para anexar.');
  }
  if (!audioIsEpochMs(input.attachedAt)) {
    return audioRefuse('invalid-timestamp', 'Horario de anexacao invalido.');
  }

  const current = audioValidateBinding(input.currentBinding);
  if (!current.ok) {
    return audioRefuse(current.code, current.reason);
  }

  // Wrong patient outranks everything else, so it is checked first.
  if (!audioBindingsMatch(input.capture.binding, current.value)) {
    return audioRefuse(
      'binding-mismatch',
      'O laudo em foco nao e o mesmo de quando a gravacao comecou -- anexar aqui poria um ditado sobre um paciente no laudo de outro.'
    );
  }

  if (!audioIsDurable(input.capture.storage)) {
    return audioRefuse(
      'not-durable',
      'O audio ainda nao esta guardado no servidor (' +
        AUDIO_STORAGE_LABELS[input.capture.storage] +
        ') -- anexar agora produz um laudo cuja evidencia existe em uma unica maquina.'
    );
  }

  // Signed reports may not carry audio whose fate nobody chose.
  if (input.reportSigned && !input.capture.retention) {
    return audioRefuse(
      'retention-undecided',
      'Laudo assinado nao pode manter audio sem decisao de retencao registrada.'
    );
  }

  const acknowledged = input.acknowledgeDefect;
  const by = audioText(input.acknowledgedBy);

  if (input.capture.signal.verdict === AUDIO_SIGNAL_SILENT) {
    if (acknowledged !== 'silent-capture' || !by) {
      return audioRefuse(
        'silent-capture',
        'A gravacao esta silenciosa -- ' +
          input.capture.signal.message +
          ' Anexar exige confirmacao explicita de quem assume que e isso mesmo.'
      );
    }
  }
  if (input.capture.signal.verdict === AUDIO_SIGNAL_UNKNOWN) {
    if (acknowledged !== 'silent-capture' || !by) {
      return audioRefuse(
        'silent-capture',
        'O nivel do sinal nao foi observado -- nao se pode afirmar que houve captacao. Anexar exige confirmacao explicita.'
      );
    }
  }
  if (input.capture.duration.truncated) {
    if (acknowledged !== 'truncated-capture' || !by) {
      return audioRefuse(
        'truncated-capture',
        input.capture.duration.message + ' Anexar exige confirmacao explicita.'
      );
    }
  }

  return audioOk({
    capture: input.capture,
    attachedAt: input.attachedAt,
    acknowledgedDefect: acknowledged,
    acknowledgedBy: by || undefined,
  });
}

/**
 * Whether an attachment still belongs to the report as it now stands.
 *
 * Audio recorded against v1 played beside v2's text is the same failure as a PDF from v1
 * kept after v2: each half is internally consistent, so nobody sees the contradiction, and
 * the listener attributes v1's dictation to v2's conclusions.
 */
export function audioCheckVersion(
  attachment: AudioAttachment,
  currentReportVersion: number
): AudioResult<AudioAttachment> {
  if (!attachment || !attachment.capture) {
    return audioRefuse('not-recording', 'Nenhum audio anexado.');
  }
  if (!audioIsPositiveInt(currentReportVersion)) {
    return audioRefuse('stale-for-version', 'Versao corrente do laudo invalida.');
  }
  const recordedFor = attachment.capture.binding.reportVersion;
  if (recordedFor !== currentReportVersion) {
    return audioRefuse(
      'stale-for-version',
      'Audio gravado para a versao ' +
        recordedFor +
        ' e o laudo esta na ' +
        currentReportVersion +
        ' -- ouvir esse ditado ao lado deste texto atribui a conclusao errada ao radiologista.'
    );
  }
  return audioOk(attachment);
}

/* ------------------------------------------------------------------ */
/* Readout                                                            */
/* ------------------------------------------------------------------ */

/** One line for the recorder chip. */
export function audioDescribeCapture(capture: AudioCapture): string {
  if (!capture) {
    return '';
  }
  const seconds = Math.round(capture.recordedMs / 1000);
  const parts = [
    seconds + 's',
    AUDIO_SIGNAL_LABELS[capture.signal.verdict],
    AUDIO_STORAGE_LABELS[capture.storage],
  ];
  if (capture.duration.truncated) {
    parts.push('gravacao truncada');
  }
  return parts.join(' - ') + '.';
}
