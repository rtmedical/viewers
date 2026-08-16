import {
  allowedEvents,
  applyEvent,
  canApply,
  currentWorkflowVersion,
  describeState,
  emptyReport,
  isEditable,
  isSigned,
  renderFullReport,
  ReportAuthor,
  ReportCapability,
  ReportDocument,
  ReportEventType,
  REPORT_CAPABILITIES,
  requiresPreliminaryBanner,
  STATE_LABELS,
} from './reportWorkflow';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

const ANA: ReportAuthor = { id: 'ana', name: 'Dra. Ana Lima', registration: 'CRM-DF 12345' };
const RESIDENT: ReportAuthor = { id: 'bruno', name: 'Dr. Bruno Reis' };

const all = () => true;
const only = (...caps: ReportCapability[]) => (c: ReportCapability) => caps.includes(c);

/** Applies a sequence, asserting each step succeeded. */
const run = (
  document: ReportDocument,
  steps: Array<{ type: ReportEventType; at: number; author?: ReportAuthor; body?: string; reason?: string; can?: (c: ReportCapability) => boolean }>
): ReportDocument => {
  let doc = document;
  steps.forEach((step, i) => {
    const result = applyEvent(doc, {
      type: step.type,
      at: step.at,
      author: step.author ?? ANA,
      can: step.can ?? all,
      body: step.body,
      reason: step.reason,
    });
    if (!result.ok) {
      throw new Error(`step ${i} (${step.type}) refused: ${result.error}`);
    }
    doc = result.document;
  });
  return doc;
};

const signedReport = () =>
  run(emptyReport(), [
    { type: 'edit', at: T0, body: 'Tórax sem alterações.' },
    { type: 'sign', at: T0 + MIN },
  ]);

describe('reportWorkflow — a signed report is immutable', () => {
  // The load-bearing rule. A machine that allows signed -> draft does not "let the
  // radiologist fix a typo"; it invalidates a signature over a distributed document.
  it('has NO edit transition out of signed', () => {
    expect(allowedEvents('signed')).not.toContain('edit');
    expect(allowedEvents('signed')).not.toContain('sign');
    expect(allowedEvents('amended')).not.toContain('edit');
  });

  it('refuses an edit and tells the radiologist what to do instead', () => {
    const result = applyEvent(signedReport(), {
      type: 'edit',
      at: T0 + 2 * MIN,
      author: ANA,
      can: all,
      body: 'texto novo',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Laudo assinado não pode ser editado. Escreva um adendo.');
  });

  it('leaves the document untouched when it refuses', () => {
    const before = signedReport();
    const after = applyEvent(before, { type: 'edit', at: T0, author: ANA, can: all, body: 'x' });
    expect(after.document).toBe(before);
    expect(after.document.history).toHaveLength(before.history.length);
  });

  it('the signed body is not left lying around as editable working text', () => {
    const doc = signedReport();
    expect(doc.workingBody).toBe('');
    expect(isEditable(doc)).toBe(false);
  });
});

describe('reportWorkflow — draft and signing', () => {
  it('starts as an empty draft', () => {
    const doc = emptyReport();
    expect(doc.state).toBe('draft');
    expect(isSigned(doc)).toBe(false);
    expect(currentWorkflowVersion(doc)).toBe(0);
  });

  it('signs the working body as version 1', () => {
    const doc = signedReport();
    expect(doc.state).toBe('signed');
    expect(doc.versions).toHaveLength(1);
    expect(doc.versions[0]).toMatchObject({
      version: 1,
      kind: 'report',
      body: 'Tórax sem alterações.',
      signedAt: T0 + MIN,
    });
    expect(doc.versions[0].signedBy.registration).toBe('CRM-DF 12345');
  });

  it('refuses to sign an empty report', () => {
    const result = applyEvent(emptyReport(), { type: 'sign', at: T0, author: ANA, can: all });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/vazio/);
  });

  it('refuses an action with no author or no timestamp', () => {
    expect(
      applyEvent(emptyReport(), { type: 'edit', at: T0, author: {} as ReportAuthor, can: all }).error
    ).toMatch(/autor/);
    expect(
      applyEvent(emptyReport(), { type: 'edit', at: NaN, author: ANA, can: all }).error
    ).toMatch(/horário/);
  });

  it('records every transition with who, when and from where', () => {
    const doc = signedReport();
    expect(doc.history).toHaveLength(2);
    expect(doc.history[1]).toMatchObject({
      event: 'sign',
      by: 'ana',
      from: 'draft',
      to: 'signed',
      at: T0 + MIN,
    });
  });
});

describe('reportWorkflow — preliminary is not "signed, but less"', () => {
  const preliminary = () =>
    run(emptyReport(), [
      { type: 'edit', at: T0, body: 'Suspeita de consolidação em base direita.', author: RESIDENT },
      { type: 'issuePreliminary', at: T0 + MIN, author: RESIDENT },
    ]);

  it('is a state of its own, still editable', () => {
    const doc = preliminary();
    expect(doc.state).toBe('preliminary');
    expect(isEditable(doc)).toBe(true);
    expect(isSigned(doc)).toBe(false);
  });

  // Every rendering has to say so; a preliminary read reaching a clinician looking like a
  // final report is the failure this state exists to prevent.
  it('demands a banner on every rendering', () => {
    expect(requiresPreliminaryBanner(preliminary())).toBe(true);
    expect(requiresPreliminaryBanner(signedReport())).toBe(false);
    expect(describeState(preliminary())).toMatch(/NÃO É LAUDO DEFINITIVO/);
  });

  it('refuses an empty preliminary', () => {
    const result = applyEvent(emptyReport(), {
      type: 'issuePreliminary',
      at: T0,
      author: RESIDENT,
      can: all,
    });
    expect(result.ok).toBe(false);
  });

  it('the attending signs the preliminary into a final version 1', () => {
    const doc = run(preliminary(), [{ type: 'sign', at: T0 + 30 * MIN, author: ANA }]);
    expect(doc.state).toBe('signed');
    expect(doc.versions[0].signedBy.id).toBe('ana');
    expect(doc.preliminaryIssuedAt).toBeUndefined();
    expect(requiresPreliminaryBanner(doc)).toBe(false);
  });

  it('the preliminary text can still be corrected before it is signed', () => {
    const doc = run(preliminary(), [
      { type: 'edit', at: T0 + 5 * MIN, body: 'Consolidação em base direita.', author: ANA },
    ]);
    expect(doc.state).toBe('preliminary');
    expect(doc.workingBody).toBe('Consolidação em base direita.');
  });
});

describe('reportWorkflow — addenda', () => {
  const amended = () =>
    run(signedReport(), [
      { type: 'startAddendum', at: T0 + 2 * MIN },
      { type: 'edit', at: T0 + 3 * MIN, body: 'Revisão: nódulo de 4 mm no LSE.' },
      { type: 'signAddendum', at: T0 + 4 * MIN },
    ]);

  it('is the only way out of signed', () => {
    expect(allowedEvents('signed').sort()).toEqual(['retract', 'startAddendum']);
  });

  // A reader sent version 1 has to be able to ask "is what I hold current?".
  it('mints a NEW version rather than modifying the signed one', () => {
    const doc = amended();
    expect(doc.versions.map(v => v.version)).toEqual([1, 2]);
    expect(doc.versions[0].body).toBe('Tórax sem alterações.');
    expect(doc.versions[1]).toMatchObject({ kind: 'addendum', amends: 1 });
    expect(currentWorkflowVersion(doc)).toBe(2);
  });

  it('an addendum on an addendum keeps climbing', () => {
    const doc = run(amended(), [
      { type: 'startAddendum', at: T0 + 5 * MIN },
      { type: 'edit', at: T0 + 6 * MIN, body: 'Segundo adendo.' },
      { type: 'signAddendum', at: T0 + 7 * MIN },
    ]);
    expect(doc.versions.map(v => v.version)).toEqual([1, 2, 3]);
    expect(doc.versions[2].amends).toBe(2);
  });

  it('refuses to sign an empty addendum', () => {
    const started = run(signedReport(), [{ type: 'startAddendum', at: T0 + 2 * MIN }]);
    expect(applyEvent(started, { type: 'signAddendum', at: T0, author: ANA, can: all }).ok).toBe(
      false
    );
  });

  it('discarding an addendum returns to the signed state, unchanged', () => {
    const started = run(signedReport(), [
      { type: 'startAddendum', at: T0 + 2 * MIN },
      { type: 'edit', at: T0 + 3 * MIN, body: 'texto que será descartado' },
    ]);
    const doc = run(started, [{ type: 'discardAddendum', at: T0 + 4 * MIN }]);
    expect(doc.state).toBe('signed');
    expect(doc.versions).toHaveLength(1);
    expect(doc.workingBody).toBe('');
  });

  it('discarding from an amended report returns to amended, not to signed', () => {
    const doc = run(amended(), [
      { type: 'startAddendum', at: T0 + 5 * MIN },
      { type: 'discardAddendum', at: T0 + 6 * MIN },
    ]);
    expect(doc.state).toBe('amended');
  });

  it('cannot start an addendum on a report that was never signed', () => {
    const result = applyEvent(emptyReport(), {
      type: 'startAddendum',
      at: T0,
      author: ANA,
      can: all,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Não há laudo assinado/);
  });

  // Merging them rewrites history in the one document where that is least acceptable.
  it('renders the original and the addendum separately, both attributed', () => {
    const rendered = renderFullReport(amended());
    expect(rendered).toMatch(/Tórax sem alterações\./);
    expect(rendered).toMatch(/--- ADENDO 2 \(complementa a versão 1\) ---/);
    expect(rendered).toMatch(/Revisão: nódulo de 4 mm no LSE\./);
    expect(rendered.match(/Assinado por Dra\. Ana Lima \(CRM-DF 12345\)\./g)).toHaveLength(2);
  });
});

describe('reportWorkflow — retraction', () => {
  it('needs a reason', () => {
    const result = applyEvent(signedReport(), {
      type: 'retract',
      at: T0 + 2 * MIN,
      author: ANA,
      can: all,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/motivo/);
  });

  // A report that was distributed cannot be un-distributed; the archive has to keep what
  // was sent.
  it('does NOT delete the signed versions', () => {
    const doc = run(signedReport(), [
      { type: 'retract', at: T0 + 2 * MIN, reason: 'laudo emitido no paciente errado' },
    ]);
    expect(doc.state).toBe('draft');
    expect(doc.versions).toHaveLength(1);
    expect(isSigned(doc)).toBe(true);
  });

  it('puts the retracted text back in the editor and records the reason', () => {
    const doc = run(signedReport(), [
      { type: 'retract', at: T0 + 2 * MIN, reason: 'paciente errado' },
    ]);
    expect(doc.workingBody).toBe('Tórax sem alterações.');
    expect(doc.history[doc.history.length - 1].note).toBe('paciente errado');
  });
});

describe('reportWorkflow — authority', () => {
  it('asks the host and fails closed with no checker', () => {
    const result = applyEvent(emptyReport(), {
      type: 'edit',
      at: T0,
      author: ANA,
      can: undefined as never,
      body: 'x',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/permissão/);
  });

  it('a resident may issue a preliminary but not sign a final', () => {
    const canResident = only('report.edit', 'report.issuePreliminary');
    const draft = run(emptyReport(), [
      { type: 'edit', at: T0, body: 'achado', author: RESIDENT, can: canResident },
      { type: 'issuePreliminary', at: T0 + MIN, author: RESIDENT, can: canResident },
    ]);
    const signAttempt = applyEvent(draft, {
      type: 'sign',
      at: T0 + 2 * MIN,
      author: RESIDENT,
      can: canResident,
    });
    expect(signAttempt.ok).toBe(false);
    expect(signAttempt.error).toMatch(/permissão/);
  });

  it('exports every capability it checks', () => {
    const asked = new Set<string>();
    for (const type of ['edit', 'issuePreliminary', 'sign', 'retract'] as ReportEventType[]) {
      applyEvent(signedReport(), {
        type,
        at: T0,
        author: ANA,
        can: c => {
          asked.add(c);
          return true;
        },
        body: 'x',
        reason: 'x',
      });
    }
    for (const cap of asked) {
      expect(REPORT_CAPABILITIES).toContain(cap as ReportCapability);
    }
  });
});

describe('reportWorkflow — status line', () => {
  it('names the state and the version', () => {
    expect(describeState(emptyReport())).toBe('Rascunho');
    expect(describeState(signedReport())).toBe('Assinado · versão 1');
  });

  it('has a label for every state', () => {
    for (const state of Object.keys(STATE_LABELS)) {
      expect(STATE_LABELS[state as keyof typeof STATE_LABELS].length).toBeGreaterThan(0);
      expect(allowedEvents(state as never).length).toBeGreaterThan(0);
    }
  });

  it('canApply agrees with the table', () => {
    expect(canApply(signedReport(), 'startAddendum')).toBe(true);
    expect(canApply(signedReport(), 'edit')).toBe(false);
  });

  it('survives a nullish document', () => {
    expect(describeState(undefined as never)).toBe('');
    expect(isEditable(undefined as never)).toBe(false);
    expect(renderFullReport(undefined as never)).toBe('');
  });
});
