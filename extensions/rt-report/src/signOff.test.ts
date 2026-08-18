import {
  signAppendAuditEvent,
  signAuditArtefacts,
  signAuthorizeSigner,
  signCreateAmendment,
  signCreateSignature,
  signEvaluateReadiness,
  signRecordDispatch,
  signRegisterArtefact,
  signSummarizeDelivery,
  signVerifySignedContent,
  SIGN_DEFAULT_SIGNATURE_FORMAT,
  SIGN_REQUIRED_ARTEFACT_KINDS,
} from './signOff';
import type {
  SignArtefact,
  SignChecklistCode,
  SignChecklistItem,
  SignDelegation,
  SignDispatch,
  SignReportDraft,
  SignSignature,
  SignSigner,
} from './signOff';

/* Fixed epoch constants: no clock is ever read. */
const T_GRANT = 1_700_000_000_000; // 2023-11-14T22:13:20Z
const T_COMMUNICATED = 1_700_000_060_000;
const T_SIGNED_V1 = 1_700_000_100_000;
const T_ARTEFACT_V1 = 1_700_000_150_000;
const T_SENT = 1_700_000_200_000;
const T_SIGNED_V2 = 1_700_600_000_000;
const T_DELEGATION_EXPIRY = 1_700_000_400_000;
const T_AFTER_EXPIRY = 1_700_000_500_000;

const DIGEST_V1 = 'a'.repeat(64);
const DIGEST_V2 = 'b'.repeat(64);
const DIGEST_TAMPERED = 'c'.repeat(64);

const ATTENDING: SignSigner = {
  personId: 'doc-1',
  displayName: 'Dra. Helena Assuncao',
  role: 'attending',
  councilId: 'CRM-SP 123456',
};

const OTHER_ATTENDING: SignSigner = {
  personId: 'doc-2',
  displayName: 'Dr. Joao Peixoto',
  role: 'attending',
  councilId: 'CRM-SP 654321',
};

const RESIDENT: SignSigner = {
  personId: 'res-1',
  displayName: 'Dr. Bruno Camara',
  role: 'resident',
  councilId: 'CRM-SP 999111',
};

const TECHNOLOGIST: SignSigner = {
  personId: 'tec-1',
  displayName: 'Tecnico Ana',
  role: 'technologist',
  councilId: 'CRT 4321',
};

function draftOf(overrides: Partial<SignReportDraft>): SignReportDraft {
  const base: SignReportDraft = {
    reportId: 'rep-1',
    studyInstanceUID: '1.2.840.113619.2.1.1',
    stage: 'final',
    paragraphs: [
      { id: 'findings', kind: 'authored', text: 'Nodulo de 9 mm no lobo superior direito.' },
      {
        id: 'impression',
        kind: 'assertive-default',
        text: 'Exame dentro dos limites da normalidade.',
        confirmedAt: T_GRANT,
      },
    ],
    structuredFindings: [],
    criticalCommunications: [],
    peerReview: { required: false, state: 'waived' },
    contentDigest: DIGEST_V1,
  };
  return Object.assign({}, base, overrides);
}

function codesOf(items: SignChecklistItem[]): SignChecklistCode[] {
  return items.map(function (item) {
    return item.code;
  });
}

function signatureV1(): SignSignature {
  const result = signCreateSignature({
    draft: draftOf({}),
    signer: ATTENDING,
    authorId: ATTENDING.personId,
    delegations: [],
    contentDigest: DIGEST_V1,
    version: 1,
    signedAt: T_SIGNED_V1,
  });
  expect(result.ok).toBe(true);
  return result.value;
}

function signatureV2(): SignSignature {
  const result = signCreateAmendment({
    previous: signatureV1(),
    draft: draftOf({ stage: 'amendment', contentDigest: DIGEST_V2 }),
    signer: ATTENDING,
    authorId: ATTENDING.personId,
    delegations: [],
    contentDigest: DIGEST_V2,
    signedAt: T_SIGNED_V2,
    reason: 'Inclusao de nodulo pulmonar omitido na impressao.',
  });
  expect(result.ok).toBe(true);
  return result.value;
}

describe('signEvaluateReadiness -- the gate blocks instead of warning', () => {
  it('allows signing when nothing is pending', () => {
    const readiness = signEvaluateReadiness(draftOf({}));
    expect(readiness.blocking).toEqual([]);
    expect(readiness.signAllowed).toBe(true);
  });

  // "Laudo normal por omissao": pre-filled normality paragraph nobody touched.
  // A banner would be read only after the irreversible signature exists.
  it('blocks an unconfirmed assertive default', () => {
    const readiness = signEvaluateReadiness(
      draftOf({
        paragraphs: [
          {
            id: 'impression',
            kind: 'assertive-default',
            text: 'Exame dentro dos limites da normalidade.',
          },
        ],
      })
    );
    expect(readiness.signAllowed).toBe(false);
    expect(codesOf(readiness.blocking)).toContain('assertive-default-unconfirmed');
    expect(readiness.blocking[0].severity).toBe('blocking');
    expect(readiness.blocking[0].message).toContain('não foi editado nem confirmado');
    expect(readiness.blocking[0].subject).toBe('impression');
  });

  it('accepts the assertive default once the author explicitly confirms it', () => {
    const readiness = signEvaluateReadiness(
      draftOf({
        paragraphs: [
          {
            id: 'impression',
            kind: 'assertive-default',
            text: 'Exame dentro dos limites da normalidade.',
            confirmedAt: T_GRANT,
          },
        ],
      })
    );
    expect(readiness.signAllowed).toBe(true);
  });

  it('accepts the assertive default once it has been edited', () => {
    const readiness = signEvaluateReadiness(
      draftOf({
        paragraphs: [
          {
            id: 'impression',
            kind: 'assertive-default',
            text: 'Nodulo pulmonar a esclarecer.',
            editedAt: T_GRANT,
          },
        ],
      })
    );
    expect(readiness.signAllowed).toBe(true);
  });

  // An unresolved placeholder is published verbatim in the PDF/A and HL7 ORU.
  it('blocks an unresolved placeholder', () => {
    const readiness = signEvaluateReadiness(
      draftOf({
        paragraphs: [{ id: 'measure', kind: 'placeholder', text: '[[MEDIDA]]' }],
      })
    );
    expect(codesOf(readiness.blocking)).toEqual(['unresolved-placeholder']);
  });

  // Structured layer (DICOM SR / FHIR) says present, prose says absent: each
  // layer is self-consistent, so no reader ever sees the contradiction.
  it('blocks a structured finding that contradicts the prose', () => {
    const readiness = signEvaluateReadiness(
      draftOf({
        structuredFindings: [
          {
            code: 'F-01',
            label: 'Nodulo pulmonar',
            assertion: 'present',
            severity: 'significant',
            proseAssertion: 'absent',
          },
        ],
      })
    );
    expect(codesOf(readiness.blocking)).toEqual(['structured-prose-conflict']);
    expect(readiness.blocking[0].message).toContain('não corresponde ao texto do laudo');
  });

  // A positive structured finding the prose never mentions: the human reader
  // never learns of it, while the follow-up worklist acts on it.
  it('blocks a positive structured finding that the prose is silent about', () => {
    const readiness = signEvaluateReadiness(
      draftOf({
        structuredFindings: [
          {
            code: 'F-02',
            label: 'Derrame pleural',
            assertion: 'present',
            severity: 'routine',
            proseAssertion: 'missing',
          },
        ],
      })
    );
    expect(codesOf(readiness.blocking)).toEqual(['structured-prose-conflict']);
  });

  it('does not block a negative structured finding the prose omits', () => {
    const readiness = signEvaluateReadiness(
      draftOf({
        structuredFindings: [
          {
            code: 'F-03',
            label: 'Pneumotorax',
            assertion: 'absent',
            severity: 'critical',
            proseAssertion: 'missing',
          },
        ],
      })
    );
    expect(readiness.blocking).toEqual([]);
  });

  // Critical finding with no recorded call: after signing, the worklist looks
  // clean and nobody revisits the missing communication.
  it('blocks a critical finding with no communication recorded', () => {
    const readiness = signEvaluateReadiness(
      draftOf({
        structuredFindings: [
          {
            code: 'F-10',
            label: 'Pneumotorax hipertensivo',
            assertion: 'present',
            severity: 'critical',
            proseAssertion: 'present',
          },
        ],
      })
    );
    expect(codesOf(readiness.blocking)).toEqual(['critical-without-communication']);
    expect(readiness.blocking[0].message).toContain('sem comunicação registrada');
  });

  // A communication row with no named recipient is not evidence of a call.
  it('blocks a critical finding whose communication has no named recipient', () => {
    const readiness = signEvaluateReadiness(
      draftOf({
        structuredFindings: [
          {
            code: 'F-10',
            label: 'Pneumotorax hipertensivo',
            assertion: 'present',
            severity: 'critical',
            proseAssertion: 'present',
          },
        ],
        criticalCommunications: [
          { findingCode: 'F-10', recipientName: '   ', method: 'telefone', at: T_COMMUNICATED },
        ],
      })
    );
    expect(codesOf(readiness.blocking)).toEqual(['critical-without-communication']);
  });

  it('allows a critical finding with recipient, method and time recorded', () => {
    const readiness = signEvaluateReadiness(
      draftOf({
        structuredFindings: [
          {
            code: 'F-10',
            label: 'Pneumotorax hipertensivo',
            assertion: 'present',
            severity: 'critical',
            proseAssertion: 'present',
          },
        ],
        criticalCommunications: [
          {
            findingCode: 'F-10',
            recipientName: 'Dr. Plantao Emergencia',
            method: 'telefone',
            at: T_COMMUNICATED,
          },
        ],
      })
    );
    expect(readiness.signAllowed).toBe(true);
  });

  // Once signed, an unreviewed report is indistinguishable from a reviewed one.
  it('blocks while a required peer review is pending', () => {
    const readiness = signEvaluateReadiness(
      draftOf({ peerReview: { required: true, state: 'pending' } })
    );
    expect(codesOf(readiness.blocking)).toEqual(['peer-review-pending']);
  });

  it('does not block when the required peer review is completed', () => {
    const readiness = signEvaluateReadiness(
      draftOf({
        peerReview: {
          required: true,
          state: 'completed',
          reviewerId: 'doc-2',
          decidedAt: T_GRANT,
        },
      })
    );
    expect(readiness.signAllowed).toBe(true);
  });

  // Without a digest the signature could only commit to "the report", which is
  // not a fixed object.
  it('blocks when the draft has no content digest', () => {
    const readiness = signEvaluateReadiness(draftOf({ contentDigest: '' }));
    expect(codesOf(readiness.blocking)).toEqual(['draft-digest-missing']);
  });

  it('keeps quality signals advisory so they never block the signature', () => {
    const readiness = signEvaluateReadiness(
      draftOf({
        priorStudyAvailable: true,
        priorStudyCompared: false,
        clinicalIndicationPresent: false,
      })
    );
    expect(readiness.signAllowed).toBe(true);
    expect(codesOf(readiness.advisory)).toEqual([
      'prior-not-compared',
      'clinical-indication-missing',
    ]);
  });

  it('reports every blocking item at once instead of stopping at the first', () => {
    const readiness = signEvaluateReadiness(
      draftOf({
        paragraphs: [
          { id: 'impression', kind: 'assertive-default', text: 'Normal.' },
          { id: 'measure', kind: 'placeholder', text: '[[MEDIDA]]' },
        ],
        structuredFindings: [
          {
            code: 'F-10',
            label: 'Embolia pulmonar',
            assertion: 'present',
            severity: 'critical',
            proseAssertion: 'absent',
          },
        ],
        peerReview: { required: true, state: 'pending' },
      })
    );
    expect(readiness.blocking.length).toBe(5);
    expect(codesOf(readiness.blocking)).toEqual([
      'assertive-default-unconfirmed',
      'unresolved-placeholder',
      'structured-prose-conflict',
      'critical-without-communication',
      'peer-review-pending',
    ]);
  });
});

describe('signAuthorizeSigner -- entitlement the document will not reveal', () => {
  it('authorizes the attending author of the report', () => {
    const result = signAuthorizeSigner({
      signer: ATTENDING,
      authorId: ATTENDING.personId,
      reportId: 'rep-1',
      stage: 'final',
      delegations: [],
      now: T_SIGNED_V1,
    });
    expect(result.ok).toBe(true);
    expect(result.value.kind).toBe('author');
  });

  // A technologist signature renders exactly like a physician's in the PDF.
  it('refuses a role that may never sign a diagnostic report', () => {
    const result = signAuthorizeSigner({
      signer: TECHNOLOGIST,
      authorId: TECHNOLOGIST.personId,
      reportId: 'rep-1',
      stage: 'final',
      delegations: [],
      now: T_SIGNED_V1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('role-not-entitled');
  });

  // A resident's signature on a final report is a legal defect invisible in
  // the signed document itself.
  it('refuses a resident on a final report', () => {
    const result = signAuthorizeSigner({
      signer: RESIDENT,
      authorId: RESIDENT.personId,
      reportId: 'rep-1',
      stage: 'final',
      delegations: [],
      now: T_SIGNED_V1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('resident-cannot-finalize');
    expect(result.reason).toContain('médico responsável');
  });

  it('allows a resident to sign a preliminary read', () => {
    const result = signAuthorizeSigner({
      signer: RESIDENT,
      authorId: RESIDENT.personId,
      reportId: 'rep-1',
      stage: 'preliminary',
      delegations: [],
      now: T_SIGNED_V1,
    });
    expect(result.ok).toBe(true);
    expect(result.value.kind).toBe('author');
  });

  // A signature without a CRM has no legal value even though it looks valid.
  it('refuses a signer with no council registration', () => {
    const result = signAuthorizeSigner({
      signer: { personId: 'doc-9', displayName: 'Dr. Sem CRM', role: 'attending' },
      authorId: 'doc-9',
      reportId: 'rep-1',
      stage: 'final',
      delegations: [],
      now: T_SIGNED_V1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('council-id-missing');
  });

  it('authorizes a delegate holding a scoped, unexpired delegation', () => {
    const delegation: SignDelegation = {
      delegateId: OTHER_ATTENDING.personId,
      grantedById: ATTENDING.personId,
      grantedByRole: 'attending',
      reportId: 'rep-1',
      grantedAt: T_GRANT,
      expiresAt: T_DELEGATION_EXPIRY,
    };
    const result = signAuthorizeSigner({
      signer: OTHER_ATTENDING,
      authorId: ATTENDING.personId,
      reportId: 'rep-1',
      stage: 'final',
      delegations: [delegation],
      now: T_SIGNED_V1,
    });
    expect(result.ok).toBe(true);
    expect(result.value.kind).toBe('delegate');
    expect(result.value.grantedById).toBe(ATTENDING.personId);
  });

  // An expired delegation still shows up in the UI as "delegado por ...".
  it('refuses an expired delegation', () => {
    const result = signAuthorizeSigner({
      signer: OTHER_ATTENDING,
      authorId: ATTENDING.personId,
      reportId: 'rep-1',
      stage: 'final',
      delegations: [
        {
          delegateId: OTHER_ATTENDING.personId,
          grantedById: ATTENDING.personId,
          grantedByRole: 'attending',
          reportId: 'rep-1',
          grantedAt: T_GRANT,
          expiresAt: T_DELEGATION_EXPIRY,
        },
      ],
      now: T_AFTER_EXPIRY,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('delegation-expired');
  });

  // A delegation for another report is the easiest way to sign the wrong study.
  it('refuses a delegation granted for a different report', () => {
    const result = signAuthorizeSigner({
      signer: OTHER_ATTENDING,
      authorId: ATTENDING.personId,
      reportId: 'rep-1',
      stage: 'final',
      delegations: [
        {
          delegateId: OTHER_ATTENDING.personId,
          grantedById: ATTENDING.personId,
          grantedByRole: 'attending',
          reportId: 'rep-OTHER',
          grantedAt: T_GRANT,
          expiresAt: T_DELEGATION_EXPIRY,
        },
      ],
      now: T_SIGNED_V1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('delegation-out-of-scope');
  });

  // Self-granted authority would appear in the audit trail as if conferred.
  it('refuses a delegation the signer granted to himself', () => {
    const result = signAuthorizeSigner({
      signer: OTHER_ATTENDING,
      authorId: ATTENDING.personId,
      reportId: 'rep-1',
      stage: 'final',
      delegations: [
        {
          delegateId: OTHER_ATTENDING.personId,
          grantedById: OTHER_ATTENDING.personId,
          grantedByRole: 'attending',
          reportId: 'rep-1',
          grantedAt: T_GRANT,
          expiresAt: T_DELEGATION_EXPIRY,
        },
      ],
      now: T_SIGNED_V1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('delegation-self-granted');
  });

  it('refuses a delegation granted by someone with no authority to delegate', () => {
    const result = signAuthorizeSigner({
      signer: OTHER_ATTENDING,
      authorId: ATTENDING.personId,
      reportId: 'rep-1',
      stage: 'final',
      delegations: [
        {
          delegateId: OTHER_ATTENDING.personId,
          grantedById: 'adm-1',
          grantedByRole: 'administrator',
          reportId: 'rep-1',
          grantedAt: T_GRANT,
          expiresAt: T_DELEGATION_EXPIRY,
        },
      ],
      now: T_SIGNED_V1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('delegation-grantor-not-entitled');
  });

  it('refuses a signer who is neither author nor delegate', () => {
    const result = signAuthorizeSigner({
      signer: OTHER_ATTENDING,
      authorId: ATTENDING.personId,
      reportId: 'rep-1',
      stage: 'final',
      delegations: [],
      now: T_SIGNED_V1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not-author-no-delegation');
  });
});

describe('signCreateSignature -- binds one digest, or refuses', () => {
  it('produces a signature bound to the digest, version and signer', () => {
    const signature = signatureV1();
    expect(signature.contentDigest).toBe(DIGEST_V1);
    expect(signature.version).toBe(1);
    expect(signature.signedAt).toBe(T_SIGNED_V1);
    expect(signature.signatureFormat).toBe(SIGN_DEFAULT_SIGNATURE_FORMAT);
    expect(signature.authorityKind).toBe('author');
    expect(signature.councilId).toBe('CRM-SP 123456');
  });

  it('refuses to sign without a content digest', () => {
    const result = signCreateSignature({
      draft: draftOf({ contentDigest: '' }),
      signer: ATTENDING,
      authorId: ATTENDING.personId,
      delegations: [],
      contentDigest: '',
      version: 1,
      signedAt: T_SIGNED_V1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('digest-missing');
  });

  it('refuses a digest that is not a SHA-256 hex string', () => {
    const result = signCreateSignature({
      draft: draftOf({ contentDigest: 'nao-e-um-digest' }),
      signer: ATTENDING,
      authorId: ATTENDING.personId,
      delegations: [],
      contentDigest: 'nao-e-um-digest',
      version: 1,
      signedAt: T_SIGNED_V1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('digest-malformed');
  });

  // The content changed between the checklist and the click: signing the old
  // digest would certify a document nobody validated.
  it('refuses when the digest to sign differs from the reviewed draft', () => {
    const result = signCreateSignature({
      draft: draftOf({ contentDigest: DIGEST_V2 }),
      signer: ATTENDING,
      authorId: ATTENDING.personId,
      delegations: [],
      contentDigest: DIGEST_V1,
      version: 1,
      signedAt: T_SIGNED_V1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('digest-mismatch');
  });

  // The gate is enforced in the core, not only by a disabled button: batch
  // sign-off and API callers share this path.
  it('refuses to sign while blocking checklist items exist', () => {
    const result = signCreateSignature({
      draft: draftOf({ peerReview: { required: true, state: 'pending' } }),
      signer: ATTENDING,
      authorId: ATTENDING.personId,
      delegations: [],
      contentDigest: DIGEST_V1,
      version: 1,
      signedAt: T_SIGNED_V1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('checklist-blocking');
    expect(result.reason).toContain('Revisão obrigatória');
  });

  it('refuses a version below 1', () => {
    const result = signCreateSignature({
      draft: draftOf({}),
      signer: ATTENDING,
      authorId: ATTENDING.personId,
      delegations: [],
      contentDigest: DIGEST_V1,
      version: 0,
      signedAt: T_SIGNED_V1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid-version');
  });

  it('refuses an invalid signing timestamp', () => {
    const result = signCreateSignature({
      draft: draftOf({}),
      signer: ATTENDING,
      authorId: ATTENDING.personId,
      delegations: [],
      contentDigest: DIGEST_V1,
      version: 1,
      signedAt: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid-timestamp');
  });

  it('propagates the authorization refusal code unchanged', () => {
    const result = signCreateSignature({
      draft: draftOf({}),
      signer: RESIDENT,
      authorId: RESIDENT.personId,
      delegations: [],
      contentDigest: DIGEST_V1,
      version: 1,
      signedAt: T_SIGNED_V1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('resident-cannot-finalize');
  });
});

function signVerify(currentDigest: string) {
  return signVerifySignedContent(signatureV1(), currentDigest);
}

describe('signVerifySignedContent -- is this still the signed document?', () => {
  it('confirms a document whose digest still matches', () => {
    const verification = signVerify(DIGEST_V1);
    expect(verification.matches).toBe(true);
    expect(verification.message).toContain('íntegro');
  });

  // Macro expansion or a template migration silently changed the rendered
  // text; every screen re-renders from the live record, so drift is invisible.
  it('detects a document that no longer matches the signature', () => {
    const verification = signVerify(DIGEST_TAMPERED);
    expect(verification.matches).toBe(false);
    expect(verification.expectedDigest).toBe(DIGEST_V1);
    expect(verification.actualDigest).toBe(DIGEST_TAMPERED);
    expect(verification.message).toContain('não corresponde ao conteúdo assinado');
  });

  it('treats an uncomputable digest as unverified rather than valid', () => {
    const verification = signVerify('');
    expect(verification.matches).toBe(false);
    expect(verification.message).toContain('integridade indeterminada');
  });

  it('always states that a correction is a new signed version, never an edit', () => {
    expect(signVerify(DIGEST_V1).guidance).toContain('nova versão assinada');
    expect(signVerify(DIGEST_TAMPERED).guidance).toContain('nunca editam conteúdo assinado');
  });
});

describe('signCreateAmendment -- a new version, never an edit', () => {
  it('creates version 2 superseding version 1 with a recorded reason', () => {
    const amendment = signatureV2();
    expect(amendment.version).toBe(2);
    expect(amendment.supersedesVersion).toBe(1);
    expect(amendment.contentDigest).toBe(DIGEST_V2);
    expect(amendment.amendmentReason).toContain('nodulo pulmonar');
  });

  // Without a reason the history cannot explain why follow-up changed.
  it('refuses an amendment with no reason', () => {
    const result = signCreateAmendment({
      previous: signatureV1(),
      draft: draftOf({ stage: 'amendment', contentDigest: DIGEST_V2 }),
      signer: ATTENDING,
      authorId: ATTENDING.personId,
      delegations: [],
      contentDigest: DIGEST_V2,
      signedAt: T_SIGNED_V2,
      reason: '  ',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('amendment-reason-missing');
  });

  // A version that corrects nothing turns the history into noise nobody reads.
  it('refuses an amendment whose content is identical to the previous version', () => {
    const result = signCreateAmendment({
      previous: signatureV1(),
      draft: draftOf({ stage: 'amendment', contentDigest: DIGEST_V1 }),
      signer: ATTENDING,
      authorId: ATTENDING.personId,
      delegations: [],
      contentDigest: DIGEST_V1,
      signedAt: T_SIGNED_V2,
      reason: 'Correcao de digitacao.',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('amendment-without-change');
  });

  it('refuses an amendment stamped before the version it replaces', () => {
    const result = signCreateAmendment({
      previous: signatureV1(),
      draft: draftOf({ stage: 'amendment', contentDigest: DIGEST_V2 }),
      signer: ATTENDING,
      authorId: ATTENDING.personId,
      delegations: [],
      contentDigest: DIGEST_V2,
      signedAt: T_GRANT,
      reason: 'Inclusao de achado.',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('non-monotonic-time');
  });

  it('refuses an amendment belonging to a different report', () => {
    const result = signCreateAmendment({
      previous: signatureV1(),
      draft: draftOf({ reportId: 'rep-OTHER', stage: 'amendment', contentDigest: DIGEST_V2 }),
      signer: ATTENDING,
      authorId: ATTENDING.personId,
      delegations: [],
      contentDigest: DIGEST_V2,
      signedAt: T_SIGNED_V2,
      reason: 'Inclusao de achado.',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('report-mismatch');
  });

  // A resident may not correct a final report either.
  it('refuses an amendment signed by a resident', () => {
    const result = signCreateAmendment({
      previous: signatureV1(),
      draft: draftOf({ stage: 'amendment', contentDigest: DIGEST_V2 }),
      signer: RESIDENT,
      authorId: RESIDENT.personId,
      delegations: [],
      contentDigest: DIGEST_V2,
      signedAt: T_SIGNED_V2,
      reason: 'Inclusao de achado.',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('resident-cannot-finalize');
  });

  it('leaves the previous signature untouched', () => {
    const previous = signatureV1();
    signCreateAmendment({
      previous: previous,
      draft: draftOf({ stage: 'amendment', contentDigest: DIGEST_V2 }),
      signer: ATTENDING,
      authorId: ATTENDING.personId,
      delegations: [],
      contentDigest: DIGEST_V2,
      signedAt: T_SIGNED_V2,
      reason: 'Inclusao de achado.',
    });
    expect(previous.version).toBe(1);
    expect(previous.contentDigest).toBe(DIGEST_V1);
    expect(previous.supersedesVersion).toBe(undefined);
  });
});

describe('signRecordDispatch / signSummarizeDelivery -- separate ordered facts', () => {
  it('records a dispatch that happened after the signature', () => {
    const result = signRecordDispatch({
      signature: signatureV1(),
      channel: 'email',
      recipient: 'cirurgia@hospital.example',
      state: 'sent',
      at: T_SENT,
    });
    expect(result.ok).toBe(true);
    expect(result.value.version).toBe(1);
    expect(result.value.state).toBe('sent');
  });

  // Sending before signing would deliver a document nobody is answerable for.
  it('refuses to record a dispatch when there is no signature', () => {
    const result = signRecordDispatch({
      signature: undefined,
      channel: 'email',
      recipient: 'cirurgia@hospital.example',
      state: 'sent',
      at: T_SENT,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not-signed');
  });

  // An out-of-order dispatch would let the record claim the report was sent
  // before it existed in signed form.
  it('refuses a dispatch stamped before the signature', () => {
    const result = signRecordDispatch({
      signature: signatureV1(),
      channel: 'email',
      recipient: 'cirurgia@hospital.example',
      state: 'sent',
      at: T_GRANT,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('dispatch-before-signature');
  });

  it('refuses a dispatch with no recipient', () => {
    const result = signRecordDispatch({
      signature: signatureV1(),
      channel: 'email',
      recipient: '',
      state: 'sent',
      at: T_SENT,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('recipient-missing');
  });

  // "Assinado" must never be rendered as "entregue": an undelivered report
  // that looks delivered is how a surgeon operates without the report.
  it('reports a signed report with no delivery as not delivered', () => {
    const status = signSummarizeDelivery(signatureV1(), [], ['email', 'portal']);
    expect(status.signed).toBe(true);
    expect(status.delivered).toBe(false);
    expect(status.pendingChannels).toEqual(['email', 'portal']);
    expect(status.message).toContain('Assinado não significa entregue');
  });

  // A failed send must never un-sign the report: otherwise an SMTP timeout
  // leaves an unsigned report and the study looks unread.
  it('keeps the signature valid when a channel fails', () => {
    const failed: SignDispatch = {
      reportId: 'rep-1',
      version: 1,
      channel: 'email',
      recipient: 'cirurgia@hospital.example',
      state: 'failed',
      at: T_SENT,
      detail: 'SMTP timeout',
    };
    const status = signSummarizeDelivery(signatureV1(), [failed], ['email']);
    expect(status.signed).toBe(true);
    expect(status.delivered).toBe(false);
    expect(status.failedChannels).toEqual(['email']);
    expect(status.message).toContain('assinatura permanece válida');
  });

  it('reports delivered only when every required channel is delivered', () => {
    const dispatches: SignDispatch[] = [
      { reportId: 'rep-1', version: 1, channel: 'email', recipient: 'a@b.example', state: 'delivered', at: T_SENT },
      { reportId: 'rep-1', version: 1, channel: 'portal', recipient: 'portal', state: 'delivered', at: T_SENT },
    ];
    const status = signSummarizeDelivery(signatureV1(), dispatches, ['email', 'portal']);
    expect(status.delivered).toBe(true);
    expect(status.deliveredChannels).toEqual(['email', 'portal']);
    expect(status.pendingChannels).toEqual([]);
  });

  // A delivery of version 1 must not mark version 2 as delivered, or the
  // amendment silently inherits the old report's delivery record.
  it('ignores dispatches belonging to another version', () => {
    const dispatchV1: SignDispatch = {
      reportId: 'rep-1',
      version: 1,
      channel: 'email',
      recipient: 'a@b.example',
      state: 'delivered',
      at: T_SENT,
    };
    const status = signSummarizeDelivery(signatureV2(), [dispatchV1], ['email']);
    expect(status.delivered).toBe(false);
    expect(status.pendingChannels).toEqual(['email']);
  });
});

describe('signRegisterArtefact / signAuditArtefacts -- stale beats missing', () => {
  it('registers an artefact bound to the signed version and digest', () => {
    const result = signRegisterArtefact({
      signature: signatureV1(),
      kind: 'pdfa',
      contentDigest: DIGEST_V1,
      generatedAt: T_ARTEFACT_V1,
      location: 'wado/pdf/1',
    });
    expect(result.ok).toBe(true);
    expect(result.value.version).toBe(1);
    expect(result.value.contentDigest).toBe(DIGEST_V1);
  });

  // A PDF/A whose bytes are not the signed content carries a valid-looking
  // signature block over other text.
  it('refuses an artefact rendered from content other than the signed content', () => {
    const result = signRegisterArtefact({
      signature: signatureV1(),
      kind: 'pdfa',
      contentDigest: DIGEST_TAMPERED,
      generatedAt: T_ARTEFACT_V1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('artefact-digest-mismatch');
  });

  it('refuses an artefact generated before the signature it claims to carry', () => {
    const result = signRegisterArtefact({
      signature: signatureV1(),
      kind: 'dicom-sr',
      contentDigest: DIGEST_V1,
      generatedAt: T_GRANT,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('non-monotonic-time');
  });

  it('refuses to register an artefact for an unsigned report', () => {
    const result = signRegisterArtefact({
      signature: undefined,
      kind: 'pdfa',
      contentDigest: DIGEST_V1,
      generatedAt: T_ARTEFACT_V1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not-signed');
  });

  // The PDF printed into the chart, the SR feeding the follow-up worklist and
  // the FHIR report read by the referring clinic all still say version 1.
  it('flags PDF, SR and FHIR artefacts left behind by version 1 as stale', () => {
    const v1 = signatureV1();
    const v2 = signatureV2();
    const artefacts: SignArtefact[] = [
      { kind: 'pdfa', reportId: 'rep-1', version: 1, contentDigest: v1.contentDigest, generatedAt: T_ARTEFACT_V1 },
      { kind: 'dicom-sr', reportId: 'rep-1', version: 1, contentDigest: v1.contentDigest, generatedAt: T_ARTEFACT_V1 },
      {
        kind: 'fhir-diagnostic-report',
        reportId: 'rep-1',
        version: 1,
        contentDigest: v1.contentDigest,
        generatedAt: T_ARTEFACT_V1,
      },
    ];
    const audit = signAuditArtefacts(v2, artefacts, SIGN_REQUIRED_ARTEFACT_KINDS);
    expect(audit.stale.length).toBe(3);
    expect(audit.current).toEqual([]);
    expect(audit.safeToDistribute).toBe(false);
    expect(audit.problems[0].code).toBe('stale-artefact');
    expect(audit.problems[0].message).toContain('versão 1');
    expect(audit.problems[0].message).toContain('versão 2');
  });

  // Same version number but different bytes: a re-render that drifted.
  it('flags an artefact of the right version whose digest drifted', () => {
    const v1 = signatureV1();
    const audit = signAuditArtefacts(
      v1,
      [{ kind: 'pdfa', reportId: 'rep-1', version: 1, contentDigest: DIGEST_TAMPERED, generatedAt: T_ARTEFACT_V1 }],
      ['pdfa']
    );
    expect(audit.stale.length).toBe(1);
    expect(audit.safeToDistribute).toBe(false);
  });

  // A missing artefact cannot contradict the record, so it is advisory only.
  it('treats a not-yet-generated artefact as advisory and still distributable', () => {
    const v1 = signatureV1();
    const audit = signAuditArtefacts(
      v1,
      [{ kind: 'pdfa', reportId: 'rep-1', version: 1, contentDigest: DIGEST_V1, generatedAt: T_ARTEFACT_V1 }],
      ['pdfa', 'dicom-sr']
    );
    expect(audit.current.length).toBe(1);
    expect(audit.stale).toEqual([]);
    expect(audit.missing).toEqual(['dicom-sr']);
    expect(audit.problems.length).toBe(1);
    expect(audit.problems[0].severity).toBe('advisory');
    expect(audit.safeToDistribute).toBe(true);
  });

  it('ignores artefacts belonging to another report', () => {
    const v1 = signatureV1();
    const audit = signAuditArtefacts(
      v1,
      [{ kind: 'pdfa', reportId: 'rep-OTHER', version: 1, contentDigest: DIGEST_V1, generatedAt: T_ARTEFACT_V1 }],
      ['pdfa']
    );
    expect(audit.stale).toEqual([]);
    expect(audit.missing).toEqual(['pdfa']);
  });
});

describe('signAppendAuditEvent -- append-only trail', () => {
  it('appends events in order without mutating the previous trail', () => {
    const first = signAppendAuditEvent([], {
      kind: 'signed',
      at: T_SIGNED_V1,
      actorId: ATTENDING.personId,
      reportId: 'rep-1',
      version: 1,
      detail: 'Assinatura PAdES da versão 1.',
    });
    expect(first.ok).toBe(true);
    const second = signAppendAuditEvent(first.value, {
      kind: 'dispatch',
      at: T_SENT,
      actorId: ATTENDING.personId,
      reportId: 'rep-1',
      version: 1,
      detail: 'Envio por e-mail.',
    });
    expect(second.ok).toBe(true);
    expect(second.value.length).toBe(2);
    expect(first.value.length).toBe(1);
  });

  // A dispatch stamped before its signature is exactly the pattern a dispute
  // turns on, so it is refused rather than silently re-sorted.
  it('refuses an event that is out of chronological order', () => {
    const first = signAppendAuditEvent([], {
      kind: 'signed',
      at: T_SIGNED_V1,
      actorId: ATTENDING.personId,
      reportId: 'rep-1',
      detail: 'Assinatura.',
    });
    const late = signAppendAuditEvent(first.value, {
      kind: 'dispatch',
      at: T_GRANT,
      actorId: ATTENDING.personId,
      reportId: 'rep-1',
      detail: 'Envio retroativo.',
    });
    expect(late.ok).toBe(false);
    expect(late.code).toBe('non-monotonic-audit');
  });

  it('refuses an event with no identified actor', () => {
    const result = signAppendAuditEvent([], {
      kind: 'signed',
      at: T_SIGNED_V1,
      actorId: '',
      reportId: 'rep-1',
      detail: 'Assinatura.',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('recipient-missing');
  });

  it('refuses an event with no valid timestamp', () => {
    const result = signAppendAuditEvent([], {
      kind: 'signed',
      at: 0,
      actorId: ATTENDING.personId,
      reportId: 'rep-1',
      detail: 'Assinatura.',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid-timestamp');
  });
});
