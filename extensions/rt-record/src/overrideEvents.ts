/**
 * Pure **override/exception event collector** (RTV-168) over a parsed
 * {@link RtRecord} — the data source of the Course Timeline "Overrides" lane
 * (epic RTV-162). Framework-free and `@ohif/*`-free.
 *
 * Honest DICOM semantics (PS3.3 C.8.8.21, RT Beams Session Record Module) —
 * only what the *standard* RT Treatment Record actually carries is classified:
 *
 *  - `machine-override`     — OverrideSequence (3008,0060) items. The standard
 *    records which parameter was overridden (OverrideParameterPointer,
 *    3008,0062), why (OverrideReason, 3008,0066) and by whom (OperatorsName,
 *    0008,1070). TPS-specific override classes — Varian ARIA's "Dose Limit" /
 *    "Geometric" / "Breakpoint" overrides — do NOT exist in the standard
 *    object and are NOT derivable from it (triage 18495), so every override
 *    item maps to this single type.
 *  - `parameter-correction` — CorrectedParameterSequence (3008,0068) items
 *    (post-delivery corrections with CorrectionValue, 3008,006A).
 *  - `verify-override`      — TreatmentVerificationStatus (3008,002C) ===
 *    VERIFIED_OVR: the verification system was overridden for the beam.
 *  - `manual-treatment`     — best-effort heuristic, documented: the standard
 *    has no "manual treatment" flag, so a beam with
 *    TreatmentTerminationStatus (3008,002A) === OPERATOR *and* a partial
 *    meterset (delivered < specified) is surfaced as an operator intervention.
 *
 * Event dates come from the record's TreatmentDate/TreatmentTime (3008,0250/
 * 0251) — the standard does not timestamp individual override items.
 *
 * NOTE: `@ohif/extension-rt-timeline` intentionally does NOT import this at
 * runtime (RTV-114 zero-fork, no cross-extension runtime imports); its pure
 * `buildOverrideTimeline` mirrors this classification over the duck-typed
 * `RtRecordLike`. Keep the two in sync.
 */
import type { RtRecord, RtRecordBeamSession } from './rtRecordParser';

export type OverrideEventType =
  | 'machine-override'
  | 'parameter-correction'
  | 'verify-override'
  | 'manual-treatment';

export interface OverrideEvent {
  /** TreatmentDate (3008,0250) of the originating record (DICOM DA). */
  date?: string;
  /** TreatmentTime (3008,0251) of the originating record (DICOM TM). */
  time?: string;
  type: OverrideEventType;
  beamNumber?: number;
  /** Short human-readable label (the UI translates by `type` instead). */
  label: string;
  /** Attribute pointer / value / reason specifics, ` · `-joined. */
  detail?: string;
  /** OperatorsName (0008,1070) — override items only. */
  operator?: string;
}

const LABELS: Record<OverrideEventType, string> = {
  'machine-override': 'Machine override',
  'parameter-correction': 'Parameter correction',
  'verify-override': 'Verify override',
  'manual-treatment': 'Manual treatment',
};

function joinDetail(parts: (string | undefined)[]): string | undefined {
  const s = parts.filter(Boolean).join(' · ');
  return s || undefined;
}

function beamLabel(session: RtRecordBeamSession): string | undefined {
  if (session.beamNumber != null) return `Beam ${session.beamNumber}`;
  return session.beamName ? `Beam ${session.beamName}` : undefined;
}

/**
 * Collect the DICOM-derivable override/exception events of one parsed RT
 * Treatment Record (see module doc for the honest classification rules).
 */
export function collectOverrideEvents(record: RtRecord | undefined | null): OverrideEvent[] {
  if (!record) return [];
  const events: OverrideEvent[] = [];
  const base = { date: record.treatmentDate, time: record.treatmentTime };

  for (const session of record.sessions ?? []) {
    const beamNumber = session.beamNumber;
    const beam = beamLabel(session);

    // OverrideSequence (3008,0060) → machine-override (single honest type).
    for (const o of session.overrides ?? []) {
      events.push({
        ...base,
        type: 'machine-override',
        beamNumber,
        label: LABELS['machine-override'],
        detail: joinDetail([
          beam,
          o.parameterPointer,
          o.controlPointIndex != null ? `CP ${o.controlPointIndex}` : undefined,
          o.reason,
        ]),
        operator: o.operator,
      });
    }

    // CorrectedParameterSequence (3008,0068) → parameter-correction.
    for (const c of session.corrections ?? []) {
      events.push({
        ...base,
        type: 'parameter-correction',
        beamNumber,
        label: LABELS['parameter-correction'],
        detail: joinDetail([
          beam,
          c.parameterPointer,
          c.value != null ? `Δ ${c.value}` : undefined,
        ]),
      });
    }

    // TreatmentVerificationStatus (3008,002C) = VERIFIED_OVR → verify-override.
    if (String(session.verificationStatus ?? '').trim().toUpperCase() === 'VERIFIED_OVR') {
      events.push({
        ...base,
        type: 'verify-override',
        beamNumber,
        label: LABELS['verify-override'],
        detail: joinDetail([beam, 'TreatmentVerificationStatus=VERIFIED_OVR']),
      });
    }

    // Best-effort (documented): OPERATOR termination + partial meterset.
    const operatorTerminated =
      String(session.terminationStatus ?? '').trim().toUpperCase() === 'OPERATOR';
    const partial =
      session.deliveredMeterset != null &&
      session.specifiedMeterset != null &&
      session.deliveredMeterset < session.specifiedMeterset;
    if (operatorTerminated && partial) {
      events.push({
        ...base,
        type: 'manual-treatment',
        beamNumber,
        label: LABELS['manual-treatment'],
        detail: joinDetail([
          beam,
          `${session.deliveredMeterset}/${session.specifiedMeterset} MU`,
          'TreatmentTerminationStatus=OPERATOR',
        ]),
      });
    }
  }
  return events;
}

export default collectOverrideEvents;
