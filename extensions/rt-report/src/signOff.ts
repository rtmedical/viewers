/**
 * RTV-228 -- Sign & Distribute: pure core.
 *
 * This module owns the pre-signature gate and the definition of what a
 * signature commits to. It contains no React, no I/O, no clock and no hashing:
 * time arrives as epoch milliseconds and the content digest arrives as a
 * string computed elsewhere. Every refusal is returned as a value so that the
 * UI can render it next to the offending item instead of losing it in an
 * exception boundary.
 *
 * The guards below exist because of concrete, named failure modes seen in
 * radiology reporting. Each one is dangerous precisely because the signed
 * document looks perfect afterwards.
 *
 * 1. "Laudo normal por omissao" -- the assertive default.
 *    Templates pre-fill the impression with "Exame dentro dos limites da
 *    normalidade". The radiologist dictates a 9 mm pulmonary nodule in the
 *    findings and never scrolls back to the impression. The signed report
 *    asserts normality. It is hard to notice because the paragraph is
 *    grammatical, plausible and was never visibly "empty" -- there is no red
 *    field, no missing value, nothing for the eye to catch. A warning banner
 *    above an enabled Sign button does not help: banners are read after the
 *    signature exists. So this is BLOCKING, not advisory.
 *
 * 2. Structured / prose contradiction.
 *    The measurement panel (which becomes the DICOM SR and the FHIR
 *    Observations) says nodule present; the prose says "sem nodulos". Humans
 *    read the prose, the follow-up worklist and the oncology registry read the
 *    structured field. Each view is internally consistent, so neither reader
 *    ever sees a contradiction, and the patient falls out of follow-up.
 *
 * 3. Critical finding with no communication recorded.
 *    Pneumotorax hipertensivo, embolia pulmonar, aneurisma roto: a signed and
 *    "distributed" report sitting unread in an inbox is not communication.
 *    After signing, the queue looks clean and nobody revisits it, so the
 *    absence of the phone call is invisible. Communication must be recorded
 *    BEFORE the point of no return.
 *
 * 4. Peer review still pending.
 *    A resident's preliminary read promoted to final without the attending's
 *    review looks identical to a reviewed report once signed.
 *
 * 5. Signature over "the report" instead of a digest.
 *    Macro expansion, unit re-rendering or a template migration changes the
 *    rendered text after signing. Nobody notices because every screen
 *    re-renders from the live record, so the drift is never displayed. The
 *    signature must bind one specific content digest, verification must be
 *    able to say "this document is no longer the one that was signed", and a
 *    correction is a NEW signed version -- signed content is never edited.
 *
 * 6. Signing coupled to sending.
 *    If the signature only exists once the e-mail leaves, an SMTP timeout
 *    leaves an unsigned report: the study looks unread and the patient waits.
 *    If the send is assumed because the signature succeeded, an undelivered
 *    report looks delivered and the requesting surgeon operates without it.
 *    Signature and dispatch are therefore separate, ordered facts: a dispatch
 *    cannot precede its signature, and a failed dispatch never un-signs.
 *
 * 7. Stale derived artefacts.
 *    A PDF/A, a DICOM SR and a FHIR DiagnosticReport rendered from version 1
 *    and left in place after version 2 exists are three copies that disagree
 *    with the record -- and the PDF is the one printed into the physical
 *    chart. A stale artefact is worse than a missing one because it answers
 *    the question confidently and wrongly. Each artefact is tied to the
 *    version and digest it came from.
 *
 * 8. A signer who was not entitled to sign.
 *    A resident signing a final report, or a colleague signing for an absent
 *    author with no delegation (or an expired one), is a legal defect that the
 *    document itself will never reveal: the PDF shows a name and a CRM and
 *    looks valid. Role and delegation are checked before the signature exists.
 */

/* ------------------------------------------------------------------ */
/* Result envelope                                                     */
/* ------------------------------------------------------------------ */

/**
 * NOTE: this repo compiles with `strictNullChecks` OFF, so TypeScript will not
 * narrow a union keyed on a boolean literal. Every member therefore declares
 * the other member's fields explicitly as `?: undefined`.
 */
export interface SignOk<T> {
  ok: true;
  value: T;
  reason?: undefined;
  code?: undefined;
}

export interface SignRefusal {
  ok: false;
  value?: undefined;
  reason: string;
  code: SignRefusalCode;
}

export type SignResult<T> = SignOk<T> | SignRefusal;

export type SignRefusalCode =
  | 'checklist-blocking'
  | 'digest-missing'
  | 'digest-malformed'
  | 'digest-mismatch'
  | 'invalid-version'
  | 'invalid-timestamp'
  | 'report-mismatch'
  | 'role-not-entitled'
  | 'resident-cannot-finalize'
  | 'council-id-missing'
  | 'not-author-no-delegation'
  | 'delegation-out-of-scope'
  | 'delegation-expired'
  | 'delegation-self-granted'
  | 'delegation-grantor-not-entitled'
  | 'amendment-reason-missing'
  | 'amendment-without-change'
  | 'non-monotonic-time'
  | 'not-signed'
  | 'dispatch-before-signature'
  | 'recipient-missing'
  | 'artefact-digest-mismatch'
  | 'artefact-version-mismatch'
  | 'non-monotonic-audit';

/* ------------------------------------------------------------------ */
/* Domain types                                                        */
/* ------------------------------------------------------------------ */

export type SignReportStage = 'preliminary' | 'final' | 'amendment';

export type SignRole = 'resident' | 'attending' | 'technologist' | 'administrator';

export type SignFindingSeverity = 'routine' | 'significant' | 'critical';

export type SignAssertion = 'present' | 'absent';

export type SignProseAssertion = 'present' | 'absent' | 'missing';

export type SignParagraphKind = 'assertive-default' | 'placeholder' | 'authored';

export type SignChecklistCode =
  | 'assertive-default-unconfirmed'
  | 'unresolved-placeholder'
  | 'structured-prose-conflict'
  | 'critical-without-communication'
  | 'peer-review-pending'
  | 'draft-digest-missing'
  | 'stale-artefact'
  | 'missing-artefact'
  | 'prior-not-compared'
  | 'clinical-indication-missing';

export type SignChecklistSeverity = 'blocking' | 'advisory';

export interface SignChecklistItem {
  code: SignChecklistCode;
  severity: SignChecklistSeverity;
  /** User-facing, pt-BR. */
  message: string;
  /** Identifier of the offending paragraph, finding or artefact. */
  subject: string;
}

export interface SignTemplateParagraph {
  id: string;
  kind: SignParagraphKind;
  text: string;
  /** Epoch ms the author actually edited the paragraph. */
  editedAt?: number;
  /** Epoch ms the author explicitly confirmed the pre-filled text as written. */
  confirmedAt?: number;
}

export interface SignStructuredFinding {
  code: string;
  label: string;
  assertion: SignAssertion;
  severity: SignFindingSeverity;
  /** What the prose says about the same finding. */
  proseAssertion: SignProseAssertion;
}

export type SignCommunicationMethod = 'telefone' | 'presencial' | 'mensagem-segura';

export interface SignCriticalCommunication {
  findingCode: string;
  recipientName: string;
  method: SignCommunicationMethod;
  at: number;
}

export type SignPeerReviewState = 'pending' | 'completed' | 'waived';

export interface SignPeerReview {
  required: boolean;
  state: SignPeerReviewState;
  reviewerId?: string;
  decidedAt?: number;
}

export interface SignReportDraft {
  reportId: string;
  studyInstanceUID: string;
  stage: SignReportStage;
  paragraphs: SignTemplateParagraph[];
  structuredFindings: SignStructuredFinding[];
  criticalCommunications: SignCriticalCommunication[];
  peerReview: SignPeerReview;
  /** Digest of the exact content on screen, computed outside this module. */
  contentDigest: string;
  priorStudyAvailable?: boolean;
  priorStudyCompared?: boolean;
  clinicalIndicationPresent?: boolean;
}

export interface SignReadiness {
  signAllowed: boolean;
  blocking: SignChecklistItem[];
  advisory: SignChecklistItem[];
}

export interface SignSigner {
  personId: string;
  displayName: string;
  role: SignRole;
  /** CRM / conselho profissional. A signature without it is legally void. */
  councilId?: string;
}

export interface SignDelegation {
  delegateId: string;
  grantedById: string;
  grantedByRole: SignRole;
  /** A delegation is scoped to one report, never to "everything". */
  reportId: string;
  grantedAt: number;
  expiresAt: number;
}

export type SignAuthorityKind = 'author' | 'delegate';

export interface SignAuthorityBasis {
  kind: SignAuthorityKind;
  personId: string;
  grantedById?: string;
  expiresAt?: number;
}

export interface SignAuthorizationInput {
  signer: SignSigner;
  /** Person who authored the report content. */
  authorId: string;
  reportId: string;
  stage: SignReportStage;
  delegations: SignDelegation[];
  now: number;
}

export type SignSignatureFormat = 'PAdES' | 'CAdES' | 'XAdES';

export interface SignSignature {
  reportId: string;
  version: number;
  /** The one thing the signature commits to. */
  contentDigest: string;
  signerId: string;
  signerRole: SignRole;
  authorityKind: SignAuthorityKind;
  stage: SignReportStage;
  signedAt: number;
  signatureFormat: SignSignatureFormat;
  councilId: string;
  supersedesVersion?: number;
  amendmentReason?: string;
}

export interface SignCreateSignatureInput {
  draft: SignReportDraft;
  signer: SignSigner;
  authorId: string;
  delegations: SignDelegation[];
  /** Digest of the bytes being signed; must equal the draft's digest. */
  contentDigest: string;
  version: number;
  signedAt: number;
  signatureFormat?: SignSignatureFormat;
  supersedesVersion?: number;
  amendmentReason?: string;
}

export interface SignVerification {
  matches: boolean;
  expectedDigest: string;
  actualDigest: string;
  /** pt-BR explanation, always present. */
  message: string;
  /** pt-BR: what to do about it. */
  guidance: string;
}

export interface SignAmendmentInput {
  previous: SignSignature;
  draft: SignReportDraft;
  signer: SignSigner;
  authorId: string;
  delegations: SignDelegation[];
  contentDigest: string;
  signedAt: number;
  reason: string;
  signatureFormat?: SignSignatureFormat;
}

export type SignChannel =
  | 'email'
  | 'portal'
  | 'impressao'
  | 'hl7-oru'
  | 'fhir-api'
  | 'fax';

export type SignDispatchState = 'queued' | 'sent' | 'delivered' | 'failed';

export interface SignDispatch {
  reportId: string;
  version: number;
  channel: SignChannel;
  recipient: string;
  state: SignDispatchState;
  at: number;
  detail?: string;
}

export interface SignRecordDispatchInput {
  signature: SignSignature;
  channel: SignChannel;
  recipient: string;
  state: SignDispatchState;
  at: number;
  detail?: string;
}

export interface SignDeliveryStatus {
  signed: boolean;
  signedAt: number;
  delivered: boolean;
  deliveredChannels: SignChannel[];
  pendingChannels: SignChannel[];
  failedChannels: SignChannel[];
  /** pt-BR, and never says "entregue" just because it is signed. */
  message: string;
}

export type SignArtefactKind =
  | 'pdfa'
  | 'dicom-sr'
  | 'fhir-diagnostic-report'
  | 'hl7-oru';

export interface SignArtefact {
  kind: SignArtefactKind;
  reportId: string;
  /** The version this artefact was rendered from. */
  version: number;
  contentDigest: string;
  generatedAt: number;
  location?: string;
}

export interface SignRegisterArtefactInput {
  signature: SignSignature;
  kind: SignArtefactKind;
  contentDigest: string;
  generatedAt: number;
  location?: string;
}

export interface SignArtefactAudit {
  current: SignArtefact[];
  stale: SignArtefact[];
  missing: SignArtefactKind[];
  problems: SignChecklistItem[];
  safeToDistribute: boolean;
}

export type SignAuditEventKind =
  | 'checklist-blocked'
  | 'signed'
  | 'amended'
  | 'dispatch'
  | 'artefact-registered'
  | 'artefact-invalidated'
  | 'verification-failed';

export interface SignAuditEvent {
  kind: SignAuditEventKind;
  at: number;
  actorId: string;
  reportId: string;
  version?: number;
  detail: string;
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Artefacts a distributed report is expected to have, all from one version. */
export const SIGN_REQUIRED_ARTEFACT_KINDS: SignArtefactKind[] = [
  'pdfa',
  'dicom-sr',
  'fhir-diagnostic-report',
];

/** Roles that may ever produce a signature on a diagnostic report. */
export const SIGN_SIGNING_ROLES: SignRole[] = ['resident', 'attending'];

export const SIGN_DEFAULT_SIGNATURE_FORMAT: SignSignatureFormat = 'PAdES';

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

const ARTEFACT_LABELS_PT: { [key: string]: string } = {
  pdfa: 'PDF/A assinado (PAdES)',
  'dicom-sr': 'DICOM SR',
  'fhir-diagnostic-report': 'FHIR DiagnosticReport',
  'hl7-oru': 'mensagem HL7 ORU',
};

/* ------------------------------------------------------------------ */
/* Internal helpers (not exported: the barrel forbids new names)       */
/* ------------------------------------------------------------------ */

function okOf<T>(value: T): SignOk<T> {
  return { ok: true, value: value, reason: undefined, code: undefined };
}

function refuse(code: SignRefusalCode, reason: string): SignRefusal {
  return { ok: false, value: undefined, reason: reason, code: code };
}

function isFilled(text: string): boolean {
  return typeof text === 'string' && text.trim().length > 0;
}

function isEpochMs(value: number): boolean {
  return typeof value === 'number' && isFinite(value) && value > 0;
}

function listOf<T>(value: T[]): T[] {
  return value && value.length ? value.slice() : [];
}

function artefactLabel(kind: SignArtefactKind): string {
  const label = ARTEFACT_LABELS_PT[kind];
  return label ? label : kind;
}

/* ------------------------------------------------------------------ */
/* (a) The pre-signature gate: blocking items, not warnings            */
/* ------------------------------------------------------------------ */

/**
 * Splits the checklist into items that must BLOCK the signature and items that
 * are merely advisory. Nothing here throws and nothing here signs: the caller
 * disables the Sign button while `blocking` is non-empty.
 */
export function signEvaluateReadiness(draft: SignReportDraft): SignReadiness {
  const blocking: SignChecklistItem[] = [];
  const advisory: SignChecklistItem[] = [];

  if (!draft) {
    blocking.push({
      code: 'draft-digest-missing',
      severity: 'blocking',
      message: 'Rascunho do laudo indisponível: não é possível assinar.',
      subject: 'draft',
    });
    return { signAllowed: false, blocking: blocking, advisory: advisory };
  }

  const paragraphs = listOf(draft.paragraphs);
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];
    // Failure mode 1: "laudo normal por omissao". A pre-filled assertive
    // paragraph that nobody edited or confirmed is an assertion of normality
    // the radiologist never made. It cannot be a warning: warnings above an
    // enabled Sign button are read only after the signature exists.
    if (paragraph.kind === 'assertive-default') {
      const touched = isEpochMs(paragraph.editedAt) || isEpochMs(paragraph.confirmedAt);
      if (!touched) {
        blocking.push({
          code: 'assertive-default-unconfirmed',
          severity: 'blocking',
          message:
            'Texto padrão de normalidade não foi editado nem confirmado: confirme "' +
            paragraph.text.trim() +
            '" ou reescreva o parágrafo antes de assinar.',
          subject: paragraph.id,
        });
      }
    }
    // A placeholder left in the signed text ("[[MEDIDA]]") is published as-is
    // in the PDF/A and in the HL7 message.
    if (paragraph.kind === 'placeholder') {
      blocking.push({
        code: 'unresolved-placeholder',
        severity: 'blocking',
        message:
          'Campo de preenchimento obrigatório ainda não resolvido no parágrafo "' +
          paragraph.id +
          '".',
        subject: paragraph.id,
      });
    }
  }

  const findings = listOf(draft.structuredFindings);
  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];
    // Failure mode 2: the structured layer (DICOM SR / FHIR Observation) and
    // the prose disagree. Each layer is self-consistent, so no single reader
    // ever sees the contradiction, and the follow-up queue reads the layer the
    // human never looked at.
    const contradicts =
      (finding.assertion === 'present' && finding.proseAssertion === 'absent') ||
      (finding.assertion === 'absent' && finding.proseAssertion === 'present');
    const silentOnPositive =
      finding.assertion === 'present' && finding.proseAssertion === 'missing';
    if (contradicts || silentOnPositive) {
      blocking.push({
        code: 'structured-prose-conflict',
        severity: 'blocking',
        message:
          'Achado estruturado "' +
          finding.label +
          '" (' +
          (finding.assertion === 'present' ? 'presente' : 'ausente') +
          ') não corresponde ao texto do laudo (' +
          (finding.proseAssertion === 'missing'
            ? 'não mencionado'
            : finding.proseAssertion === 'present'
              ? 'presente'
              : 'ausente') +
          ').',
        subject: finding.code,
      });
    }

    // Failure mode 3: a critical finding without recorded communication. The
    // signed report in an inbox is not communication, and after signing the
    // worklist looks clean, so the missing phone call is never revisited.
    if (finding.severity === 'critical' && finding.assertion === 'present') {
      const communications = listOf(draft.criticalCommunications);
      let recorded = false;
      for (let j = 0; j < communications.length; j++) {
        const communication = communications[j];
        if (
          communication.findingCode === finding.code &&
          isFilled(communication.recipientName) &&
          isEpochMs(communication.at)
        ) {
          recorded = true;
        }
      }
      if (!recorded) {
        blocking.push({
          code: 'critical-without-communication',
          severity: 'blocking',
          message:
            'Achado crítico "' +
            finding.label +
            '" sem comunicação registrada: registre destinatário, meio e horário antes de assinar.',
          subject: finding.code,
        });
      }
    }
  }

  // Failure mode 4: a required peer review still pending. Once signed, an
  // unreviewed report is indistinguishable from a reviewed one.
  const peerReview = draft.peerReview;
  if (peerReview && peerReview.required && peerReview.state === 'pending') {
    blocking.push({
      code: 'peer-review-pending',
      severity: 'blocking',
      message:
        'Revisão obrigatória por segundo médico ainda pendente: a assinatura é irreversível.',
      subject: draft.reportId,
    });
  }

  // Failure mode 5 (first half): without a digest there is nothing to sign,
  // only a promise about "the report".
  if (!isFilled(draft.contentDigest)) {
    blocking.push({
      code: 'draft-digest-missing',
      severity: 'blocking',
      message:
        'Resumo criptográfico do conteúdo ausente: a assinatura precisa cobrir um conteúdo específico.',
      subject: draft.reportId,
    });
  }

  // Advisory only: real quality signals that do not make the document wrong.
  if (draft.priorStudyAvailable === true && draft.priorStudyCompared !== true) {
    advisory.push({
      code: 'prior-not-compared',
      severity: 'advisory',
      message: 'Existe exame anterior disponível que não foi comparado.',
      subject: draft.studyInstanceUID,
    });
  }
  if (draft.clinicalIndicationPresent === false) {
    advisory.push({
      code: 'clinical-indication-missing',
      severity: 'advisory',
      message: 'Indicação clínica não informada na solicitação.',
      subject: draft.studyInstanceUID,
    });
  }

  return {
    signAllowed: blocking.length === 0,
    blocking: blocking,
    advisory: advisory,
  };
}

/* ------------------------------------------------------------------ */
/* (e) The signer must be entitled to sign THIS report                 */
/* ------------------------------------------------------------------ */

/**
 * Decides whether this person may sign this report right now, and on what
 * basis (own authorship or an explicit, scoped, unexpired delegation).
 */
export function signAuthorizeSigner(
  input: SignAuthorizationInput
): SignResult<SignAuthorityBasis> {
  if (!input || !input.signer) {
    return refuse('role-not-entitled', 'Assinante não informado.');
  }
  const signer = input.signer;
  const now = input.now;

  if (!isEpochMs(now)) {
    return refuse(
      'invalid-timestamp',
      'Horário de assinatura inválido: sem horário não é possível avaliar delegações.'
    );
  }

  // Failure mode 8: a role that may never sign a diagnostic report. The PDF
  // would still show a name and look valid.
  if (SIGN_SIGNING_ROLES.indexOf(signer.role) === -1) {
    return refuse(
      'role-not-entitled',
      'Perfil "' + signer.role + '" não pode assinar laudo diagnóstico.'
    );
  }

  // A resident may sign a preliminary read, never a final or an amendment.
  if (signer.role === 'resident' && input.stage !== 'preliminary') {
    return refuse(
      'resident-cannot-finalize',
      'Médico residente não pode assinar laudo final nem retificação: é necessária a assinatura do médico responsável.'
    );
  }

  // No CRM, no valid signature: the document would be unusable as a medical
  // document even though it renders perfectly.
  if (!isFilled(signer.councilId)) {
    return refuse(
      'council-id-missing',
      'Registro no conselho (CRM) ausente: a assinatura não tem validade legal.'
    );
  }

  if (signer.personId === input.authorId) {
    return okOf({
      kind: 'author' as SignAuthorityKind,
      personId: signer.personId,
      grantedById: undefined,
      expiresAt: undefined,
    });
  }

  const delegations = listOf(input.delegations);
  let sawAnyForSigner = false;
  let sawOutOfScope = false;
  let sawSelfGranted = false;
  let sawBadGrantor = false;
  let sawExpired = false;

  for (let i = 0; i < delegations.length; i++) {
    const delegation = delegations[i];
    if (delegation.delegateId !== signer.personId) {
      continue;
    }
    sawAnyForSigner = true;
    if (delegation.reportId !== input.reportId) {
      sawOutOfScope = true;
      continue;
    }
    if (delegation.grantedById === signer.personId) {
      // Self-granted delegation: the audit trail would show an authority that
      // nobody ever conferred.
      sawSelfGranted = true;
      continue;
    }
    if (delegation.grantedByRole !== 'attending') {
      sawBadGrantor = true;
      continue;
    }
    if (!isEpochMs(delegation.expiresAt) || now > delegation.expiresAt) {
      sawExpired = true;
      continue;
    }
    if (isEpochMs(delegation.grantedAt) && now < delegation.grantedAt) {
      sawExpired = true;
      continue;
    }
    return okOf({
      kind: 'delegate' as SignAuthorityKind,
      personId: signer.personId,
      grantedById: delegation.grantedById,
      expiresAt: delegation.expiresAt,
    });
  }

  if (sawSelfGranted) {
    return refuse(
      'delegation-self-granted',
      'Delegação concedida pelo próprio assinante não confere autoridade.'
    );
  }
  if (sawBadGrantor) {
    return refuse(
      'delegation-grantor-not-entitled',
      'Delegação concedida por quem não tem autoridade para delegar a assinatura.'
    );
  }
  if (sawExpired) {
    return refuse(
      'delegation-expired',
      'Delegação de assinatura expirada: solicite nova delegação ao médico responsável.'
    );
  }
  if (sawOutOfScope) {
    return refuse(
      'delegation-out-of-scope',
      'A delegação existente não cobre este laudo.'
    );
  }
  if (!sawAnyForSigner) {
    return refuse(
      'not-author-no-delegation',
      'Assinante não é o autor do laudo e não possui delegação para assiná-lo.'
    );
  }
  return refuse(
    'not-author-no-delegation',
    'Assinante não é o autor do laudo e não possui delegação válida para assiná-lo.'
  );
}

/* ------------------------------------------------------------------ */
/* (b) The signature covers a specific content digest                  */
/* ------------------------------------------------------------------ */

/**
 * Produces the signature fact. The digest is mandatory and must be the digest
 * of the very content the checklist was evaluated against -- otherwise the
 * signature commits to "the report", which is not a thing that stays still.
 */
export function signCreateSignature(
  input: SignCreateSignatureInput
): SignResult<SignSignature> {
  if (!input || !input.draft) {
    return refuse('report-mismatch', 'Rascunho do laudo não informado.');
  }
  const draft = input.draft;

  if (!isEpochMs(input.signedAt)) {
    return refuse('invalid-timestamp', 'Horário da assinatura inválido.');
  }
  if (typeof input.version !== 'number' || input.version < 1 || input.version % 1 !== 0) {
    return refuse(
      'invalid-version',
      'Versão do laudo inválida: a primeira versão assinada é a 1.'
    );
  }

  // Failure mode 5: no digest means the signature does not identify what was
  // signed, so later drift can never be detected or repudiated.
  if (!isFilled(input.contentDigest)) {
    return refuse(
      'digest-missing',
      'Assinatura exige o resumo criptográfico do conteúdo assinado.'
    );
  }
  if (!DIGEST_PATTERN.test(input.contentDigest)) {
    return refuse(
      'digest-malformed',
      'Resumo criptográfico em formato inválido: esperado SHA-256 em hexadecimal.'
    );
  }
  if (input.contentDigest !== draft.contentDigest) {
    return refuse(
      'digest-mismatch',
      'O conteúdo a assinar mudou desde a validação: revise o laudo e assine novamente.'
    );
  }

  const authorization = signAuthorizeSigner({
    signer: input.signer,
    authorId: input.authorId,
    reportId: draft.reportId,
    stage: draft.stage,
    delegations: listOf(input.delegations),
    now: input.signedAt,
  });
  if (!authorization.ok) {
    return refuse(authorization.code, authorization.reason);
  }

  // The gate runs here too, not only in the UI: an enabled button is not a
  // permission, and other callers (batch sign-off, API) share this path.
  const readiness = signEvaluateReadiness(draft);
  if (readiness.blocking.length > 0) {
    return refuse(
      'checklist-blocking',
      'Assinatura bloqueada por ' +
        readiness.blocking.length +
        ' pendência(s) obrigatória(s): ' +
        readiness.blocking.map(itemMessage).join(' | ')
    );
  }

  return okOf({
    reportId: draft.reportId,
    version: input.version,
    contentDigest: input.contentDigest,
    signerId: input.signer.personId,
    signerRole: input.signer.role,
    authorityKind: authorization.value.kind,
    stage: draft.stage,
    signedAt: input.signedAt,
    signatureFormat: input.signatureFormat
      ? input.signatureFormat
      : SIGN_DEFAULT_SIGNATURE_FORMAT,
    councilId: input.signer.councilId,
    supersedesVersion: input.supersedesVersion,
    amendmentReason: input.amendmentReason,
  });
}

function itemMessage(item: SignChecklistItem): string {
  return item.message;
}

/**
 * Answers the only question that matters at read time: is the document in
 * front of me still the document that was signed?
 */
export function signVerifySignedContent(
  signature: SignSignature,
  currentDigest: string
): SignVerification {
  const guidance =
    'Correções nunca editam conteúdo assinado: gere uma nova versão assinada que substitui a anterior.';
  if (!signature) {
    return {
      matches: false,
      expectedDigest: '',
      actualDigest: isFilled(currentDigest) ? currentDigest : '',
      message: 'Documento sem assinatura registrada.',
      guidance: guidance,
    };
  }
  if (!isFilled(currentDigest)) {
    return {
      matches: false,
      expectedDigest: signature.contentDigest,
      actualDigest: '',
      message:
        'Não foi possível calcular o resumo do documento atual: integridade indeterminada.',
      guidance: guidance,
    };
  }
  if (currentDigest !== signature.contentDigest) {
    return {
      matches: false,
      expectedDigest: signature.contentDigest,
      actualDigest: currentDigest,
      message:
        'O documento atual não corresponde ao conteúdo assinado na versão ' +
        signature.version +
        ': a assinatura não o cobre.',
      guidance: guidance,
    };
  }
  return {
    matches: true,
    expectedDigest: signature.contentDigest,
    actualDigest: currentDigest,
    message:
      'Documento íntegro: corresponde ao conteúdo assinado na versão ' +
      signature.version +
      '.',
    guidance: guidance,
  };
}

/**
 * An amendment is a new signed version that supersedes the previous one. The
 * previous signature and its content remain retrievable forever: a corrected
 * report whose original text disappeared cannot explain why the follow-up
 * changed, and reviewers cannot tell what the referring physician acted on.
 */
export function signCreateAmendment(
  input: SignAmendmentInput
): SignResult<SignSignature> {
  if (!input || !input.previous || !input.draft) {
    return refuse('report-mismatch', 'Versão anterior ou rascunho não informados.');
  }
  const previous = input.previous;
  const draft = input.draft;

  if (previous.reportId !== draft.reportId) {
    return refuse(
      'report-mismatch',
      'A retificação não pertence ao mesmo laudo da versão anterior.'
    );
  }
  if (!isFilled(input.reason)) {
    return refuse(
      'amendment-reason-missing',
      'Retificação exige motivo registrado: sem ele o histórico não explica a mudança.'
    );
  }
  if (!isEpochMs(input.signedAt)) {
    return refuse('invalid-timestamp', 'Horário da retificação inválido.');
  }
  if (input.signedAt <= previous.signedAt) {
    return refuse(
      'non-monotonic-time',
      'A retificação não pode ser anterior ou simultânea à versão que substitui.'
    );
  }
  // Re-signing identical content creates a version that looks like a
  // correction and corrects nothing, which turns the version history into
  // noise nobody trusts.
  if (input.contentDigest === previous.contentDigest) {
    return refuse(
      'amendment-without-change',
      'O conteúdo é idêntico à versão anterior: não há o que retificar.'
    );
  }

  return signCreateSignature({
    draft: draft,
    signer: input.signer,
    authorId: input.authorId,
    delegations: listOf(input.delegations),
    contentDigest: input.contentDigest,
    version: previous.version + 1,
    signedAt: input.signedAt,
    signatureFormat: input.signatureFormat,
    supersedesVersion: previous.version,
    amendmentReason: input.reason.trim(),
  });
}

/* ------------------------------------------------------------------ */
/* (c) Distribution is not part of signing                             */
/* ------------------------------------------------------------------ */

/**
 * Records a dispatch as a fact that is ORDERED AFTER the signature and stored
 * apart from it. Signing must never wait on a channel, and a channel failure
 * must never remove a signature.
 */
export function signRecordDispatch(
  input: SignRecordDispatchInput
): SignResult<SignDispatch> {
  if (!input || !input.signature) {
    // Failure mode 6, first half: dispatching an unsigned report. The
    // recipient receives a document nobody is responsible for.
    return refuse(
      'not-signed',
      'Não é possível registrar envio de laudo não assinado.'
    );
  }
  const signature = input.signature;
  if (!isFilled(input.recipient)) {
    return refuse(
      'recipient-missing',
      'Destinatário do envio não informado: um envio sem destinatário não é auditável.'
    );
  }
  if (!isEpochMs(input.at)) {
    return refuse('invalid-timestamp', 'Horário do envio inválido.');
  }
  // An out-of-order dispatch would let the record claim the report was sent
  // before it existed in signed form.
  if (input.at < signature.signedAt) {
    return refuse(
      'dispatch-before-signature',
      'O envio não pode ser anterior à assinatura do laudo.'
    );
  }
  return okOf({
    reportId: signature.reportId,
    version: signature.version,
    channel: input.channel,
    recipient: input.recipient,
    state: input.state,
    at: input.at,
    detail: input.detail,
  });
}

/**
 * Reports signature and delivery as two independent truths. "Assinado" never
 * implies "entregue", and a failed channel leaves the signature intact.
 */
export function signSummarizeDelivery(
  signature: SignSignature,
  dispatches: SignDispatch[],
  requiredChannels: SignChannel[]
): SignDeliveryStatus {
  const required = listOf(requiredChannels);
  const all = listOf(dispatches);
  const relevant: SignDispatch[] = [];
  for (let i = 0; i < all.length; i++) {
    if (signature && all[i].reportId === signature.reportId && all[i].version === signature.version) {
      relevant.push(all[i]);
    }
  }

  const deliveredChannels: SignChannel[] = [];
  const failedChannels: SignChannel[] = [];
  const pendingChannels: SignChannel[] = [];

  for (let i = 0; i < required.length; i++) {
    const channel = required[i];
    let delivered = false;
    let failed = false;
    for (let j = 0; j < relevant.length; j++) {
      if (relevant[j].channel !== channel) {
        continue;
      }
      if (relevant[j].state === 'delivered') {
        delivered = true;
      } else if (relevant[j].state === 'failed') {
        failed = true;
      }
    }
    if (delivered) {
      deliveredChannels.push(channel);
    } else if (failed) {
      failedChannels.push(channel);
      pendingChannels.push(channel);
    } else {
      pendingChannels.push(channel);
    }
  }

  const signed = !!signature && isEpochMs(signature.signedAt);
  const delivered = required.length > 0 && pendingChannels.length === 0;

  let message: string;
  if (!signed) {
    message = 'Laudo não assinado: nenhum envio é considerado válido.';
  } else if (delivered) {
    message = 'Laudo assinado e entregue em todos os canais exigidos.';
  } else if (failedChannels.length > 0) {
    message =
      'Laudo assinado; falha de entrega em ' +
      failedChannels.length +
      ' canal(is). A assinatura permanece válida e o envio deve ser repetido.';
  } else {
    message =
      'Laudo assinado; entrega ainda pendente em ' +
      pendingChannels.length +
      ' canal(is). Assinado não significa entregue.';
  }

  return {
    signed: signed,
    signedAt: signature ? signature.signedAt : 0,
    delivered: delivered,
    deliveredChannels: deliveredChannels,
    pendingChannels: pendingChannels,
    failedChannels: failedChannels,
    message: message,
  };
}

/* ------------------------------------------------------------------ */
/* (d) Artefacts are derived; a stale one is worse than a missing one  */
/* ------------------------------------------------------------------ */

/**
 * Registers a derived artefact bound to the version and digest it was
 * rendered from. Refusing a digest mismatch here is what makes staleness
 * detectable later: an artefact with no provenance can never be proven stale.
 */
export function signRegisterArtefact(
  input: SignRegisterArtefactInput
): SignResult<SignArtefact> {
  if (!input || !input.signature) {
    return refuse(
      'not-signed',
      'Artefato só pode ser gerado a partir de uma versão assinada.'
    );
  }
  if (!isEpochMs(input.generatedAt)) {
    return refuse('invalid-timestamp', 'Horário de geração do artefato inválido.');
  }
  if (input.generatedAt < input.signature.signedAt) {
    return refuse(
      'non-monotonic-time',
      'Artefato não pode ter sido gerado antes da assinatura da versão.'
    );
  }
  // A PDF/A whose bytes do not come from the signed content is a forgery by
  // accident: it carries a valid-looking signature block over other text.
  if (input.contentDigest !== input.signature.contentDigest) {
    return refuse(
      'artefact-digest-mismatch',
      'O artefato não foi gerado a partir do conteúdo assinado desta versão.'
    );
  }
  return okOf({
    kind: input.kind,
    reportId: input.signature.reportId,
    version: input.signature.version,
    contentDigest: input.contentDigest,
    generatedAt: input.generatedAt,
    location: input.location,
  });
}

/**
 * Failure mode 7: after version 2 exists, every artefact still pointing at
 * version 1 is a confident wrong answer -- and the PDF is the copy printed
 * into the physical chart while the SR feeds the follow-up worklist.
 */
export function signAuditArtefacts(
  signature: SignSignature,
  artefacts: SignArtefact[],
  requiredKinds: SignArtefactKind[]
): SignArtefactAudit {
  const required = requiredKinds && requiredKinds.length
    ? requiredKinds.slice()
    : SIGN_REQUIRED_ARTEFACT_KINDS.slice();
  const all = listOf(artefacts);
  const current: SignArtefact[] = [];
  const stale: SignArtefact[] = [];
  const problems: SignChecklistItem[] = [];

  for (let i = 0; i < all.length; i++) {
    const artefact = all[i];
    if (signature && artefact.reportId !== signature.reportId) {
      continue;
    }
    const sameVersion = !!signature && artefact.version === signature.version;
    const sameDigest = !!signature && artefact.contentDigest === signature.contentDigest;
    if (sameVersion && sameDigest) {
      current.push(artefact);
    } else {
      stale.push(artefact);
      problems.push({
        code: 'stale-artefact',
        severity: 'blocking',
        message:
          artefactLabel(artefact.kind) +
          ' gerado da versão ' +
          artefact.version +
          ' continua publicado após a versão ' +
          (signature ? signature.version : 0) +
          ': recolha ou regenere antes de distribuir.',
        subject: artefact.kind,
      });
    }
  }

  const missing: SignArtefactKind[] = [];
  for (let i = 0; i < required.length; i++) {
    const kind = required[i];
    let found = false;
    for (let j = 0; j < current.length; j++) {
      if (current[j].kind === kind) {
        found = true;
      }
    }
    if (!found) {
      missing.push(kind);
      problems.push({
        code: 'missing-artefact',
        severity: 'advisory',
        message:
          artefactLabel(kind) +
          ' ainda não gerado para a versão ' +
          (signature ? signature.version : 0) +
          '.',
        subject: kind,
      });
    }
  }

  // Staleness blocks distribution; a merely missing artefact does not, because
  // an absent copy cannot contradict the record.
  return {
    current: current,
    stale: stale,
    missing: missing,
    problems: problems,
    safeToDistribute: !!signature && stale.length === 0,
  };
}

/* ------------------------------------------------------------------ */
/* Auditing                                                           */
/* ------------------------------------------------------------------ */

/**
 * Append-only trail. Out-of-order events destroy the trail's evidential
 * value: a dispatch stamped before its signature is exactly the pattern a
 * dispute turns on, so it is refused instead of silently sorted.
 */
export function signAppendAuditEvent(
  trail: SignAuditEvent[],
  event: SignAuditEvent
): SignResult<SignAuditEvent[]> {
  const existing = listOf(trail);
  if (!event || !isEpochMs(event.at)) {
    return refuse('invalid-timestamp', 'Evento de auditoria sem horário válido.');
  }
  if (!isFilled(event.actorId)) {
    return refuse(
      'recipient-missing',
      'Evento de auditoria sem responsável identificado.'
    );
  }
  if (existing.length > 0 && event.at < existing[existing.length - 1].at) {
    return refuse(
      'non-monotonic-audit',
      'Evento de auditoria fora de ordem cronológica: a trilha é somente incremental.'
    );
  }
  const next = existing.slice();
  next.push(event);
  return okOf(next);
}
