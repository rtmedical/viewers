import {
  assessQuery,
  assessResults,
  checkDestination,
  describeRetrieve,
  LEVEL_LABELS,
  METHOD_LABELS,
  MIN_WILDCARD_STEM,
  preferredMethod,
  QueryPlan,
  RETRIEVE_LABELS,
  retrievalOutcome,
  SELF_ADDRESSED,
} from './queryRetrieve';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

const plan = (over: Partial<QueryPlan> = {}): QueryPlan => ({
  level: 'study',
  keys: { patientId: 'P-1' },
  remoteAe: 'RTPACS',
  ...over,
});

describe('queryRetrieve — whether a query may be sent', () => {
  it('accepts a query with an identifying key', () => {
    const result = assessQuery(plan());
    expect(result.ok).toBe(true);
    expect(result.identifyingKeys).toEqual(['patientId']);
  });

  // A list of other patients is a privacy event before anything is retrieved.
  it('refuses a query with no keys at all', () => {
    const result = assessQuery(plan({ keys: {} }));
    expect(result.ok).toBe(false);
    expect(result.refusals.join(' ')).toMatch(/devolve o trabalho da instituição inteira/);
  });

  it('refuses a wildcard stem too short to mean anything', () => {
    const result = assessQuery(plan({ keys: { patientName: 'S*' } }));
    expect(result.ok).toBe(false);
    expect(result.refusals.join(' ')).toMatch(/evento de privacidade antes de qualquer recuperação/);
    expect(MIN_WILDCARD_STEM).toBe(3);
  });

  // The same shape as picking the wrong worklist row.
  it('allows a longer wildcard but says what picking from it risks', () => {
    const result = assessQuery(plan({ keys: { patientName: 'SILVA*' } }));
    expect(result.ok).toBe(true);
    expect(result.wildcards).toEqual(['patientName']);
    expect(result.warnings.join(' ')).toMatch(/depois de aberto, nada contradiz/);
  });

  it('warns about homonyms on a name-only search', () => {
    expect(assessQuery(plan({ keys: { patientName: 'MARIA SOUZA' } })).warnings.join(' ')).toMatch(
      /homônimos vêm juntos/
    );
  });

  it('refuses an image-level query with no study UID and a query with no remote AE', () => {
    expect(assessQuery(plan({ level: 'image' })).ok).toBe(false);
    expect(assessQuery(plan({ remoteAe: '' })).ok).toBe(false);
    expect(LEVEL_LABELS.image).toBe('imagem');
  });
});

describe('queryRetrieve — a truncated result looks like a small one', () => {
  const rows = (n: number, patientId = 'P-1') =>
    Array.from({ length: n }, () => ({ patientId }));

  it('reports the count and the distinct patients', () => {
    const result = assessResults(rows(5));
    expect(result.count).toBe(5);
    expect(result.distinctPatients).toBe(1);
  });

  // The archive returns a list, not an error.
  it('flags a count sitting exactly on the archive limit', () => {
    const result = assessResults(rows(100), 100);
    expect(result.possiblyTruncated).toBe(true);
    expect(result.warnings.join(' ')).toMatch(
      /vinte estudos de um paciente que tem duzentos parecem um paciente com vinte/
    );
  });

  it('does not flag a result below the limit', () => {
    expect(assessResults(rows(50), 100).possiblyTruncated).toBe(false);
  });

  it('warns when several patients share the list', () => {
    const mixed = [...rows(2, 'P-1'), ...rows(2, 'P-2')];
    expect(assessResults(mixed).warnings.join(' ')).toMatch(/confira o identificador, não o nome/);
  });
});

describe('queryRetrieve — C-MOVE does not send the images to you', () => {
  it('needs no destination check for a self-addressed method', () => {
    for (const method of SELF_ADDRESSED) {
      const result = checkDestination({ method, now: T0 });
      expect(result.ok).toBe(true);
      expect(result.warnings.join(' ')).toMatch(/não há destino a errar/);
    }
  });

  // The response says success, because from the archive's point of view it was one.
  it('refuses an unverified C-MOVE destination and says why the response cannot show it', () => {
    const result = checkDestination({ method: 'c-move', destinationAe: 'VIEWER_1', now: T0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/o arquivo resolve o AE pela CONFIGURAÇÃO DELE/);
    expect(result.reason).toMatch(/acontece numa operação bem-sucedida sem erro nenhum/);
  });

  it('accepts a freshly verified destination but does not overstate what that proves', () => {
    const result = checkDestination({
      method: 'c-move',
      destinationAe: 'VIEWER_1',
      echoedAt: T0 - HOUR,
      now: T0,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/não que ele é o nó certo/);
  });

  it('treats a stale verification as no verification', () => {
    expect(
      checkDestination({
        method: 'c-move',
        destinationAe: 'VIEWER_1',
        echoedAt: T0 - 48 * HOUR,
        now: T0,
      }).ok
    ).toBe(false);
  });

  it('refuses a C-MOVE with no destination at all', () => {
    expect(checkDestination({ method: 'c-move', now: T0 }).ok).toBe(false);
  });
});

describe('queryRetrieve — the outcome is what arrived, not what was reported', () => {
  it('is complete when the expected instances are stored', () => {
    const result = retrievalOutcome({
      method: 'c-move',
      reportedInstances: 120,
      storedInstances: 120,
      expectedInstances: 120,
    });
    expect(result.complete).toBe(true);
    expect(result.state).toBe('received');
  });

  // The transfer succeeded, to another node.
  it('names the wrong-destination symptom when the archive sent and nothing arrived', () => {
    const result = retrievalOutcome({ method: 'c-move', reportedInstances: 120, storedInstances: 0 });
    expect(result.complete).toBe(false);
    expect(result.state).toBe('archive-reported');
    expect(result.message).toMatch(/a transferência foi bem-sucedida, para outro nó/);
  });

  it('reports a partial transfer', () => {
    const result = retrievalOutcome({
      method: 'c-move',
      reportedInstances: 120,
      storedInstances: 100,
      expectedInstances: 120,
    });
    expect(result.state).toBe('incomplete');
    expect(result.missing).toBe(20);
  });

  it('prefers the expected count over the archive report', () => {
    const result = retrievalOutcome({
      method: 'c-move',
      reportedInstances: 100,
      storedInstances: 100,
      expectedInstances: 120,
    });
    expect(result.state).toBe('incomplete');
  });

  it('reports an outright refusal', () => {
    expect(retrievalOutcome({ method: 'c-move', storedInstances: 0, failed: true }).state).toBe('failed');
  });

  it('says nothing arrived yet when the archive reported nothing either', () => {
    expect(retrievalOutcome({ method: 'wado', storedInstances: 0 }).state).toBe('requested');
  });
});

describe('queryRetrieve — which method to prefer', () => {
  // Removes the whole class of wrong-destination failure.
  it('prefers a self-addressed method when the archive supports one', () => {
    const advice = preferredMethod(['c-move', 'wado']);
    expect(advice.preferred).toBe('wado');
    expect(advice.message).toMatch(/elimina toda a classe de falha de destino errado/);
  });

  it('falls back to C-MOVE and says what that then requires', () => {
    const advice = preferredMethod(['c-move']);
    expect(advice.preferred).toBe('c-move');
    expect(advice.message).toMatch(/um envio bem-sucedido para o nó errado não deixa erro nenhum/);
    expect(METHOD_LABELS['c-move']).toMatch(/AE configurado/);
  });

  it('falls back to C-MOVE when nothing is declared', () => {
    expect(preferredMethod([]).preferred).toBe('c-move');
  });
});

describe('queryRetrieve — the panel line', () => {
  it('states the state and the detail', () => {
    const outcome = retrievalOutcome({ method: 'wado', storedInstances: 42, expectedInstances: 42 });
    expect(describeRetrieve(outcome)).toBe(`${RETRIEVE_LABELS.received}: 42 instância(s) armazenada(s) localmente.`);
  });
});
