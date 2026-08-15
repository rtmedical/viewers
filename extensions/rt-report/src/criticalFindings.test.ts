import {
  ACK_TIMEOUT_MS,
  acknowledge,
  amend,
  buildManagementReport,
  buildMessage,
  createFinding,
  CRITICAL_FINDING_LABELS,
  CRITICAL_FINDING_TYPES,
  CriticalFinding,
  DESCRIPTION_MAX,
  describeFinding,
  dispatch,
  escalationState,
  pendingAcknowledgement,
  pendingDispatch,
  Recipient,
  SUPERVISOR_TIMEOUT_MS,
} from './criticalFindings';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

const ANA: Recipient = { id: 'ana', name: 'Dra. Ana Lima' };
const CARLOS: Recipient = { id: 'carlos', name: 'Dr. Carlos Pinto', phone: '+5561999990000' };

const make = (over: Partial<Parameters<typeof createFinding>[0]> = {}): CriticalFinding => {
  const { finding, error } = createFinding({
    id: 'cf1',
    studyInstanceUid: '1.2.3',
    patientId: 'MRN-42',
    patientName: 'SILVA^JOAO',
    findingType: 'pulmonaryEmbolism',
    description: 'Falha de enchimento em artéria pulmonar direita.',
    radiologist: ANA,
    recipients: [CARLOS],
    now: T0,
    ...over,
  });
  if (!finding) {
    throw new Error(error);
  }
  return finding;
};

const sent = () => dispatch(make(), { channel: 'whatsapp', now: T0 + MIN }).finding;

describe('criticalFindings — creating one', () => {
  it('records the creation as the first event', () => {
    const finding = make();
    expect(finding.events).toEqual([{ type: 'created', at: T0, actorId: 'ana' }]);
    expect(finding.sentAt).toBeUndefined();
  });

  // A critical finding addressed to nobody is a note to self, and the whole obligation is
  // that somebody was told.
  it('refuses with no recipient', () => {
    expect(createFinding({ ...({} as never), recipients: [] } as never).error).toBeTruthy();
    const { finding, error } = createFinding({
      id: 'x',
      studyInstanceUid: '1.2.3',
      findingType: 'acuteStroke',
      description: 'x',
      radiologist: ANA,
      recipients: [],
      now: T0,
    });
    expect(finding).toBeNull();
    expect(error).toMatch(/destinatário/);
  });

  it('refuses without a type, a description, a study or a radiologist', () => {
    const base = {
      id: 'x',
      studyInstanceUid: '1.2.3',
      findingType: 'acuteStroke' as const,
      description: 'x',
      radiologist: ANA,
      recipients: [CARLOS],
      now: T0,
    };
    expect(createFinding({ ...base, findingType: 'nope' as never }).error).toMatch(/tipo/);
    expect(createFinding({ ...base, description: '  ' }).error).toMatch(/Descreva/);
    expect(createFinding({ ...base, studyInstanceUid: '' }).error).toMatch(/estudo/);
    expect(createFinding({ ...base, radiologist: {} as Recipient }).error).toMatch(/radiologista/);
    expect(createFinding({ ...base, now: NaN }).error).toMatch(/horário/);
  });

  it('enforces the 200-character summary limit', () => {
    const { error } = createFinding({
      id: 'x',
      studyInstanceUid: '1.2.3',
      findingType: 'acuteStroke',
      description: 'a'.repeat(DESCRIPTION_MAX + 1),
      radiologist: ANA,
      recipients: [CARLOS],
      now: T0,
    });
    expect(error).toMatch(new RegExp(`${DESCRIPTION_MAX}`));
  });

  it('labels every finding type', () => {
    for (const type of CRITICAL_FINDING_TYPES) {
      expect(CRITICAL_FINDING_LABELS[type].length).toBeGreaterThan(3);
    }
    expect(CRITICAL_FINDING_TYPES).toContain('aorticDissection');
  });
});

describe('criticalFindings — dispatch', () => {
  it('records the send and starts the clock', () => {
    const finding = sent();
    expect(finding.sentAt).toBe(T0 + MIN);
    expect(finding.sentVia).toBe('whatsapp');
    expect(finding.events[1]).toMatchObject({ type: 'sent', channel: 'whatsapp' });
  });

  // The only record of a phone call is the radiologist saying they made it. Recording
  // "notified by phone" with nothing behind it produces a log that looks complete.
  it('REFUSES a phone notification without the verbal attestation', () => {
    const result = dispatch(make(), { channel: 'phone', now: T0 + MIN });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/comunicação verbal/);
    expect(result.finding.sentAt).toBeUndefined();
  });

  it('accepts a phone notification with it', () => {
    const result = dispatch(make(), {
      channel: 'phone',
      now: T0 + MIN,
      verballyConfirmed: true,
    });
    expect(result.ok).toBe(true);
    expect(result.finding.sentVia).toBe('phone');
  });

  // A failed send that leaves no trace is how a radiologist ends up believing they
  // communicated.
  it('records a failure as loudly as a success, and stays unsent', () => {
    const result = dispatch(make(), {
      channel: 'whatsapp',
      now: T0 + MIN,
      succeeded: false,
      note: 'timeout',
    });
    expect(result.ok).toBe(false);
    expect(result.finding.sentAt).toBeUndefined();
    expect(result.finding.events[1]).toMatchObject({ type: 'sendFailed', note: 'timeout' });
    expect(pendingDispatch([result.finding])).toHaveLength(1);
  });

  it('a second channel is a second record, but the clock keeps its first time', () => {
    const first = sent();
    const second = dispatch(first, { channel: 'email', now: T0 + 5 * MIN }).finding;
    expect(second.sentAt).toBe(T0 + MIN);
    expect(second.sentVia).toBe('whatsapp');
    expect(second.events.map(e => e.type)).toEqual(['created', 'sent', 'sent']);
  });

  it('rejects an unknown channel or a missing time', () => {
    expect(dispatch(make(), { channel: 'pombo' as never, now: T0 }).error).toMatch(/Canal/);
    expect(dispatch(make(), { channel: 'email', now: NaN }).error).toMatch(/horário/);
  });
});

describe('criticalFindings — the record is append-only', () => {
  it('an amendment appends and leaves the original description alone', () => {
    const finding = amend(sent(), 'Corrigido: artéria pulmonar ESQUERDA.', 'ana', T0 + 6 * MIN)
      .finding;
    expect(finding.description).toBe('Falha de enchimento em artéria pulmonar direita.');
    expect(finding.events[finding.events.length - 1]).toMatchObject({
      type: 'amended',
      note: 'Corrigido: artéria pulmonar ESQUERDA.',
    });
  });

  it('every state change leaves an event, in order', () => {
    let finding = sent();
    finding = acknowledge(finding, 'carlos', T0 + 3 * MIN).finding;
    finding = amend(finding, 'complemento', 'ana', T0 + 4 * MIN).finding;
    expect(finding.events.map(e => e.type)).toEqual([
      'created',
      'sent',
      'acknowledged',
      'amended',
    ]);
    expect(finding.events.map(e => e.at)).toEqual([T0, T0 + MIN, T0 + 3 * MIN, T0 + 4 * MIN]);
  });

  it('refuses an empty amendment', () => {
    expect(amend(sent(), '   ', 'ana', T0).ok).toBe(false);
  });
});

describe('criticalFindings — acknowledgement', () => {
  it('records who confirmed and when', () => {
    const finding = acknowledge(sent(), 'carlos', T0 + 3 * MIN).finding;
    expect(finding.acknowledgedAt).toBe(T0 + 3 * MIN);
    expect(finding.acknowledgedBy).toBe('carlos');
  });

  // Clicking the link twice is ordinary, and must not overwrite the time of the first.
  it('is idempotent', () => {
    const once = acknowledge(sent(), 'carlos', T0 + 3 * MIN).finding;
    const twice = acknowledge(once, 'carlos', T0 + 9 * MIN);
    expect(twice.ok).toBe(true);
    expect(twice.finding.acknowledgedAt).toBe(T0 + 3 * MIN);
    expect(twice.finding.events.filter(e => e.type === 'acknowledged')).toHaveLength(1);
  });

  it('cannot acknowledge something that was never sent', () => {
    expect(acknowledge(make(), 'carlos', T0).ok).toBe(false);
  });
});

describe('criticalFindings — escalation is derived from the clock', () => {
  // A stored flag is only as good as the timer that sets it: a closed tab, a dead worker,
  // a sleeping laptop — and a critical finding that quietly stops nagging.
  it('is computed fresh from sentAt every time it is asked', () => {
    const finding = sent();
    expect(escalationState(finding, T0 + 2 * MIN).level).toBe('awaiting');
    expect(escalationState(finding, T0 + MIN + ACK_TIMEOUT_MS).level).toBe('callNow');
    expect(escalationState(finding, T0 + MIN + SUPERVISOR_TIMEOUT_MS).level).toBe('supervisor');
    // Same object, three answers. Nothing was written to it.
    expect(finding.events).toHaveLength(2);
  });

  it('tells the radiologist to call after 10 minutes', () => {
    const state = escalationState(sent(), T0 + 12 * MIN);
    expect(state.level).toBe('callNow');
    expect(state.message).toMatch(/ligue para o solicitante/);
    expect(state.elapsedMs).toBe(11 * MIN);
  });

  it('escalates past the radiologist after 30', () => {
    expect(escalationState(sent(), T0 + 40 * MIN).message).toMatch(/coordenação/);
  });

  it('stops escalating once acknowledged', () => {
    const finding = acknowledge(sent(), 'carlos', T0 + 2 * MIN).finding;
    expect(escalationState(finding, T0 + 90 * MIN).level).toBe('none');
  });

  // The dangerous one: the radiologist believes they communicated.
  it('flags an unsent finding as its own, louder state', () => {
    const state = escalationState(make(), T0 + 90 * MIN);
    expect(state.level).toBe('unsent');
    expect(state.message).toMatch(/NÃO comunicado/);
  });

  it('describeFinding carries the type and the state', () => {
    expect(describeFinding(sent(), T0 + 12 * MIN)).toBe(
      'Tromboembolismo pulmonar — Sem confirmação há mais de 10 minutos — ligue para o solicitante.'
    );
    expect(describeFinding(undefined as never, T0)).toBe('');
  });
});

describe('criticalFindings — the queues', () => {
  it('pendingDispatch holds everything not sent', () => {
    expect(pendingDispatch([make(), sent()]).map(f => f.id)).toEqual(['cf1']);
    expect(pendingDispatch([])).toEqual([]);
  });

  it('pendingAcknowledgement is oldest first, so the supervisor sees the worst', () => {
    const older = { ...sent(), id: 'old', sentAt: T0 };
    const newer = { ...sent(), id: 'new', sentAt: T0 + 20 * MIN };
    const done = acknowledge(sent(), 'carlos', T0 + 2 * MIN).finding;
    expect(pendingAcknowledgement([newer, done, older], T0 + 60 * MIN).map(f => f.id)).toEqual([
      'old',
      'new',
    ]);
  });
});

describe('criticalFindings — the message', () => {
  it('names the recipient, the finding and the radiologist, and asks for confirmation', () => {
    const message = buildMessage(sent(), CARLOS, { studyLink: 'https://x/y' });
    expect(message).toMatch(/^Dr\(a\)\. Dr\. Carlos Pinto/);
    expect(message).toMatch(/Tromboembolismo pulmonar/);
    expect(message).toMatch(/Radiologista: Dra\. Ana Lima/);
    expect(message).toMatch(/https:\/\/x\/y/);
    expect(message).toMatch(/confirme o recebimento/);
  });

  // PHI on a third-party channel: the decision has to be visible at the call site.
  it('leaves the patient NAME out unless it is explicitly asked for', () => {
    const withoutName = buildMessage(sent(), CARLOS, { studyLink: 'https://x/y' });
    expect(withoutName).not.toMatch(/SILVA\^JOAO/);
    expect(withoutName).toMatch(/MRN-42/);

    const withName = buildMessage(sent(), CARLOS, {
      studyLink: 'https://x/y',
      includePatientName: true,
    });
    expect(withName).toMatch(/SILVA\^JOAO/);
  });

  it('degrades gracefully with no link and no recipient name', () => {
    const message = buildMessage(sent(), {} as Recipient, { studyLink: '' });
    expect(message).toMatch(/^Dr\(a\)\. Doutor\(a\)/);
    expect(message).not.toMatch(/Estudo:/);
  });
});

describe('criticalFindings — the management report', () => {
  const findings = () => {
    const acked = acknowledge(sent(), 'carlos', T0 + 4 * MIN).finding;
    const unsent = { ...make(), id: 'cf2', createdAt: T0 + 10 * MIN };
    return [acked, unsent];
  };

  it('measures time to acknowledgement in minutes', () => {
    const rows = buildManagementReport(findings(), T0 + 60 * MIN);
    expect(rows[0].ackMinutes).toBe(3);
    expect(rows[0].sentVia).toBe('whatsapp');
  });

  // A report that only lists successful notifications hides the failures.
  it('keeps a row for a finding that was never sent', () => {
    const rows = buildManagementReport(findings(), T0 + 60 * MIN);
    const unsent = rows.find(r => r.id === 'cf2')!;
    expect(unsent.sentAt).toBeNull();
    expect(unsent.ackMinutes).toBeNull();
    expect(unsent.escalation).toBe('unsent');
  });

  it('filters by period on the creation time', () => {
    expect(buildManagementReport(findings(), T0, T0 + 5 * MIN, T0 + 60 * MIN)).toHaveLength(1);
    expect(buildManagementReport(findings(), T0)).toHaveLength(2);
  });

  it('is ordered oldest first', () => {
    expect(buildManagementReport(findings(), T0).map(r => r.id)).toEqual(['cf1', 'cf2']);
  });

  it('survives an empty list', () => {
    expect(buildManagementReport([], T0)).toEqual([]);
  });
});
