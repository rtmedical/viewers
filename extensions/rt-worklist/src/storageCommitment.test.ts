import {
  applyReport,
  assessAge,
  COMMITMENT_OVERDUE_MS,
  CommitmentRequest,
  describeCommitment,
  mayDeleteLocal,
  planResend,
  requestCommitment,
  STATE_LABELS,
} from './storageCommitment';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

const open = (over: Record<string, unknown> = {}): CommitmentRequest =>
  requestCommitment({
    transactionUid: '1.2.tx',
    studyInstanceUid: '1.2.study',
    sopInstanceUids: ['a', 'b', 'c'],
    remoteAe: 'PACS_MAIN',
    requestedAt: T0,
    ...over,
  }).request as CommitmentRequest;

describe('storageCommitment — opening a request', () => {
  it('starts pending', () => {
    const request = open();
    expect(request.state).toBe('pending');
    expect(request.committedUids).toEqual([]);
  });

  // The only thing that will tie an out-of-band report back to this request.
  it('refuses without a transaction UID', () => {
    const result = requestCommitment({
      transactionUid: '',
      studyInstanceUid: '1.2.study',
      sopInstanceUids: ['a'],
      remoteAe: 'PACS',
      requestedAt: T0,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/não haveria como casar a resposta/);
  });

  it('refuses to reuse a transaction UID', () => {
    const result = requestCommitment(
      {
        transactionUid: '1.2.tx',
        studyInstanceUid: '1.2.other',
        sopInstanceUids: ['x'],
        remoteAe: 'PACS',
        requestedAt: T0,
      },
      [open()]
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/faz a resposta de uma solicitação valer para outra/);
  });

  it('refuses without a study, instances or a destination', () => {
    const base = { transactionUid: 'tx2', studyInstanceUid: '1.2.s', sopInstanceUids: ['a'], remoteAe: 'P', requestedAt: T0 };
    expect(requestCommitment({ ...base, studyInstanceUid: '' }).ok).toBe(false);
    expect(requestCommitment({ ...base, sopInstanceUids: [] }).ok).toBe(false);
    expect(requestCommitment({ ...base, remoteAe: '' }).ok).toBe(false);
  });
});

describe('storageCommitment — a response is not a blanket yes', () => {
  it('commits when every instance is in the successful list', () => {
    const result = applyReport(open(), {
      transactionUid: '1.2.tx',
      successfulUids: ['a', 'b', 'c'],
      failures: [],
      receivedAt: T0 + HOUR,
    });
    expect(result.request.state).toBe('committed');
  });

  // The failure list is where the instance that did not survive transcoding ends up.
  it('goes partial when some instances failed', () => {
    const result = applyReport(open(), {
      transactionUid: '1.2.tx',
      successfulUids: ['a', 'b'],
      failures: [{ sopInstanceUid: 'c', reason: 'Processing failure' }],
      receivedAt: T0 + HOUR,
    });
    expect(result.request.state).toBe('partial');
    expect(result.request.committedUids).toEqual(['a', 'b']);
    expect(result.request.failures).toHaveLength(1);
  });

  it('fails when nothing was accepted', () => {
    const result = applyReport(open(), {
      transactionUid: '1.2.tx',
      successfulUids: [],
      failures: [{ sopInstanceUid: 'a', reason: 'No such object instance' }],
      receivedAt: T0 + HOUR,
    });
    expect(result.request.state).toBe('failed');
  });

  it('ignores successes for instances the request never covered', () => {
    const result = applyReport(open(), {
      transactionUid: '1.2.tx',
      successfulUids: ['a', 'b', 'c', 'z'],
      failures: [],
      receivedAt: T0,
    });
    expect(result.request.committedUids).toEqual(['a', 'b', 'c']);
  });

  // Looks like resilience, marks the wrong study committed under load.
  it('refuses a report whose transaction UID does not match', () => {
    const result = applyReport(open(), {
      transactionUid: 'outra',
      successfulUids: ['a', 'b', 'c'],
      failures: [],
      receivedAt: T0,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/marca o estudo errado como comprometido — e parece robustez/);
  });
});

describe('storageCommitment — may the local copy be deleted', () => {
  // The standard route to losing a study.
  it('refuses when no commitment was ever requested', () => {
    const verdict = mayDeleteLocal({ ...open(), state: 'not-requested' });
    expect(verdict.mayDelete).toBe(false);
    expect(verdict.reason).toMatch(/os bytes foram aceitos, não que foram gravados de forma durável/);
  });

  it('refuses while pending', () => {
    const verdict = mayDeleteLocal(open());
    expect(verdict.mayDelete).toBe(false);
    expect(verdict.reason).toMatch(/Sem resposta não é resposta/);
  });

  it('allows deletion once every instance is committed', () => {
    const request = applyReport(open(), {
      transactionUid: '1.2.tx',
      successfulUids: ['a', 'b', 'c'],
      failures: [],
      receivedAt: T0,
    }).request;
    const verdict = mayDeleteLocal(request);
    expect(verdict.mayDelete).toBe(true);
    expect(verdict.deletableUids).toEqual(['a', 'b', 'c']);
  });

  // The refused instances are the only copies left.
  it('gives a partial deletion list rather than a blanket answer', () => {
    const request = applyReport(open(), {
      transactionUid: '1.2.tx',
      successfulUids: ['a', 'b'],
      failures: [{ sopInstanceUid: 'c', reason: 'x' }],
      receivedAt: T0,
    }).request;
    const verdict = mayDeleteLocal(request);
    expect(verdict.mayDelete).toBe(false);
    expect(verdict.deletableUids).toEqual(['a', 'b']);
    expect(verdict.reason).toMatch(/apagar o estudo inteiro perde exatamente as que não sobreviveram/);
  });

  it('refuses after an outright refusal', () => {
    const request = applyReport(open(), {
      transactionUid: '1.2.tx',
      successfulUids: [],
      failures: [{ sopInstanceUid: 'a', reason: 'x' }],
      receivedAt: T0,
    }).request;
    expect(mayDeleteLocal(request).reason).toMatch(/A única cópia é esta/);
  });
});

describe('storageCommitment — elapsed time is not an answer', () => {
  it('is quiet before the deadline', () => {
    expect(assessAge(open(), T0 + HOUR).overdue).toBe(false);
  });

  // One direction deletes early, the other re-sends forever.
  it('prompts a chase without changing the state', () => {
    const request = open();
    const age = assessAge(request, T0 + COMMITMENT_OVERDUE_MS + HOUR);
    expect(age.overdue).toBe(true);
    expect(request.state).toBe('pending');
    expect(age.message).toMatch(/reenviado para sempre/);
    expect(age.message).toMatch(/apagada cedo/);
  });

  it('says nothing once a response arrived', () => {
    const request = applyReport(open(), {
      transactionUid: '1.2.tx',
      successfulUids: ['a', 'b', 'c'],
      failures: [],
      receivedAt: T0,
    }).request;
    expect(assessAge(request, T0 + 10 * COMMITMENT_OVERDUE_MS).overdue).toBe(false);
  });
});

describe('storageCommitment — the retry path', () => {
  // Re-requesting is idempotent; deleting is not.
  it('re-requests only what is outstanding', () => {
    const request = applyReport(open(), {
      transactionUid: '1.2.tx',
      successfulUids: ['a'],
      failures: [{ sopInstanceUid: 'b', reason: 'x' }],
      receivedAt: T0,
    }).request;
    const plan = planResend(request);
    expect(plan.uids).toEqual(['b', 'c']);
    expect(plan.message).toMatch(/o caminho de retentativa é sempre perguntar de novo/);
  });

  it('has nothing to do once everything is committed', () => {
    const request = applyReport(open(), {
      transactionUid: '1.2.tx',
      successfulUids: ['a', 'b', 'c'],
      failures: [],
      receivedAt: T0,
    }).request;
    expect(planResend(request).uids).toEqual([]);
  });
});

describe('storageCommitment — the column', () => {
  it('states the state, the archive and the verdict', () => {
    expect(describeCommitment(open())).toMatch(
      new RegExp(`^${STATE_LABELS.pending} em PACS_MAIN: Aguardando resposta`)
    );
  });

  it('appends the overdue prompt', () => {
    expect(describeCommitment(open(), T0 + 2 * COMMITMENT_OVERDUE_MS)).toMatch(/Reenvie a solicitação/);
  });

  it('handles a missing request', () => {
    expect(describeCommitment(null as never)).toBe(STATE_LABELS['not-requested']);
  });
});
