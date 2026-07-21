/**
 * Client-side **RT Treatment Record parser** (RTV-163), the foundation of the
 * RT Summary / Course Timeline (epic RTV-162).
 *
 * Framework-free and `@ohif/*`-free: turns a *naturalized* RT Treatment Record
 * into a delivery-summary model for the 4 RT Treatment Record SOP classes. No
 * native OHIF SopClassHandler claims these SOPs, so the companion
 * {@link ./getSopClassHandlerModule} registers them (not a duplicate).
 */

/** The 4 RT Treatment Record SOP Class UIDs (PS3.4 / PS3.6). */
export const RT_TREATMENT_RECORD_SOP_CLASS_UIDS = {
  BEAMS: '1.2.840.10008.5.1.4.1.1.481.4',
  BRACHY: '1.2.840.10008.5.1.4.1.1.481.6',
  SUMMARY: '1.2.840.10008.5.1.4.1.1.481.7',
  ION_BEAMS: '1.2.840.10008.5.1.4.1.1.481.9',
} as const;

export type RtRecordType = 'BEAMS' | 'BRACHY' | 'SUMMARY' | 'ION_BEAMS' | 'UNKNOWN';

export const RT_TREATMENT_RECORD_SOP_CLASS_UID_LIST = Object.values(
  RT_TREATMENT_RECORD_SOP_CLASS_UIDS
);

/**
 * One item of OverrideSequence (3008,0060) — PS3.3 C.8.8.21 (Beam Session
 * Record Module). The standard records only WHICH parameter was overridden
 * (OverrideParameterPointer, 3008,0062), WHY (OverrideReason, 3008,0066) and
 * by WHOM (OperatorsName, 0008,1070). TPS-specific override taxonomies —
 * e.g. Varian ARIA's "Dose Limit / Geometric / Breakpoint" override classes —
 * do NOT exist in the standard object and cannot be derived from it (triage
 * 18495).
 */
export interface RtRecordOverride {
  /** OverrideParameterPointer (3008,0062), AT — tag of the overridden attribute. */
  parameterPointer?: string;
  /** OverrideReason (3008,0066). */
  reason?: string;
  /** OperatorsName (0008,1070) of the operator who authorized the override. */
  operator?: string;
  /**
   * Index of the ControlPointDeliverySequence (3008,0040) item carrying the
   * override; undefined for overrides found directly at the beam-session level.
   */
  controlPointIndex?: number;
}

/**
 * One item of CorrectedParameterSequence (3008,0068) — PS3.3 C.8.8.21:
 * parameters corrected after beam delivery, with the applied CorrectionValue
 * (3008,006A) and a pointer to the corrected attribute.
 */
export interface RtRecordCorrection {
  /** CorrectionValue (3008,006A), delta applied to the recorded value. */
  value?: number;
  /** ParameterPointer (3008,0065) or ParameterSequencePointer (3008,0061), AT. */
  parameterPointer?: string;
}

export interface RtRecordBeamSession {
  beamNumber?: number;
  beamName?: string;
  currentFraction?: number;
  /** TreatmentTerminationStatus (NORMAL, OPERATOR, MACHINE…). */
  terminationStatus?: string;
  specifiedMeterset?: number;
  deliveredMeterset?: number;
  nominalEnergy?: number;
  gantryAngle?: number;
  /**
   * TreatmentVerificationStatus (3008,002C): VERIFIED | VERIFIED_OVR |
   * NOT_VERIFIED (PS3.3 C.8.8.21).
   */
  verificationStatus?: string;
  /** OverrideSequence (3008,0060) items — beam-level and control-point-level. */
  overrides: RtRecordOverride[];
  /** CorrectedParameterSequence (3008,0068) items. */
  corrections: RtRecordCorrection[];
}

export interface RtRecord {
  recordType: RtRecordType;
  treatmentDate?: string;
  treatmentTime?: string;
  machine?: string;
  manufacturer?: string;
  referencedRtPlanUid?: string;
  sessions: RtRecordBeamSession[];
  /** Σ delivered meterset (MU) across beam sessions. */
  totalDeliveredMeterset?: number;
  /** Highest CurrentFractionNumber seen. */
  fractionNumber?: number;
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function toNum(value: unknown): number | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Naturalized scalar → trimmed string. Handles multi-valued attributes (first
 * value) and naturalized PN objects (`{ Alphabetic: 'Doe^Jane' }` from dcmjs).
 */
function toStr(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (v == null) return undefined;
  if (typeof v === 'object') {
    const alphabetic = (v as Record<string, unknown>).Alphabetic;
    return alphabetic != null && alphabetic !== '' ? String(alphabetic) : undefined;
  }
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

/**
 * Parse one OverrideSequence (3008,0060) item — PS3.3 C.8.8.21. Tolerant of
 * missing attributes; `controlPointIndex` is stamped by the caller for items
 * nested in ControlPointDeliverySequence.
 */
function parseOverrideItem(item: Record<string, any>): RtRecordOverride {
  return {
    parameterPointer: toStr(item?.OverrideParameterPointer),
    reason: toStr(item?.OverrideReason),
    operator: toStr(item?.OperatorsName),
  };
}

/** Map an RT Treatment Record SOP Class UID to a record type. */
export function recordTypeFromSopClass(sopClassUid?: string): RtRecordType {
  switch (sopClassUid) {
    case RT_TREATMENT_RECORD_SOP_CLASS_UIDS.BEAMS:
      return 'BEAMS';
    case RT_TREATMENT_RECORD_SOP_CLASS_UIDS.BRACHY:
      return 'BRACHY';
    case RT_TREATMENT_RECORD_SOP_CLASS_UIDS.SUMMARY:
      return 'SUMMARY';
    case RT_TREATMENT_RECORD_SOP_CLASS_UIDS.ION_BEAMS:
      return 'ION_BEAMS';
    default:
      return 'UNKNOWN';
  }
}

/** Parse a naturalized RT Treatment Record into a delivery-summary model. */
export function parseRtRecord(instance: Record<string, any>): RtRecord {
  const record: RtRecord = {
    recordType: recordTypeFromSopClass(instance?.SOPClassUID),
    treatmentDate: instance?.TreatmentDate,
    treatmentTime: instance?.TreatmentTime,
    manufacturer: instance?.Manufacturer,
    sessions: [],
  };
  if (!instance) return record;

  const refPlan = toArray(instance.ReferencedRTPlanSequence)[0] as Record<string, any> | undefined;
  record.referencedRtPlanUid = refPlan?.ReferencedSOPInstanceUID;

  // Treatment machine (record-level or first machine sequence item).
  const machineItem = toArray(instance.TreatmentMachineSequence)[0] as Record<string, any> | undefined;
  record.machine = instance?.TreatmentMachineName ?? machineItem?.TreatmentMachineName;

  // Beam sessions (RT Beams / Ion Beams Treatment Record).
  const beamSeqKey = instance.TreatmentSessionBeamSequence
    ? 'TreatmentSessionBeamSequence'
    : instance.TreatmentSessionIonBeamSequence
      ? 'TreatmentSessionIonBeamSequence'
      : undefined;

  let maxFraction: number | undefined;
  let totalDelivered = 0;
  let hasDelivered = false;

  if (beamSeqKey) {
    record.sessions = toArray(instance[beamSeqKey]).map((b: any) => {
      const controlPoints = toArray(b?.ControlPointDeliverySequence) as Record<string, any>[];
      const cp0 = controlPoints[0];
      const delivered = toNum(b?.DeliveredPrimaryMeterset) ?? toNum(b?.DeliveredMeterset);
      const fraction = toNum(b?.CurrentFractionNumber);
      if (delivered != null) {
        totalDelivered += delivered;
        hasDelivered = true;
      }
      if (fraction != null) maxFraction = Math.max(maxFraction ?? 0, fraction);
      if (!record.machine && b?.TreatmentMachineName) record.machine = b.TreatmentMachineName;

      // OverrideSequence (3008,0060) — PS3.3 C.8.8.21 places it inside the
      // Control Point Delivery Sequence, but real-world records (and older
      // toolkits) also emit it directly at the beam-session level. Collect both.
      const overrides: RtRecordOverride[] = toArray(b?.OverrideSequence).map(
        (o: Record<string, any>) => parseOverrideItem(o)
      );
      controlPoints.forEach((cp, controlPointIndex) => {
        for (const o of toArray(cp?.OverrideSequence) as Record<string, any>[]) {
          overrides.push({ ...parseOverrideItem(o), controlPointIndex });
        }
      });

      // CorrectedParameterSequence (3008,0068) — PS3.3 C.8.8.21.
      const corrections: RtRecordCorrection[] = toArray(b?.CorrectedParameterSequence).map(
        (c: Record<string, any>) => ({
          value: toNum(c?.CorrectionValue),
          parameterPointer: toStr(c?.ParameterPointer) ?? toStr(c?.ParameterSequencePointer),
        })
      );

      return {
        beamNumber: toNum(b?.ReferencedBeamNumber) ?? toNum(b?.BeamNumber),
        beamName: b?.BeamName,
        currentFraction: fraction,
        terminationStatus: b?.TreatmentTerminationStatus,
        specifiedMeterset: toNum(b?.SpecifiedPrimaryMeterset) ?? toNum(b?.SpecifiedMeterset),
        deliveredMeterset: delivered,
        nominalEnergy: toNum(cp0?.NominalBeamEnergy),
        gantryAngle: toNum(cp0?.GantryAngle),
        verificationStatus: toStr(b?.TreatmentVerificationStatus),
        overrides,
        corrections,
      };
    });
  }

  if (hasDelivered) record.totalDeliveredMeterset = totalDelivered;
  record.fractionNumber = maxFraction;
  return record;
}

/** Build a CSV (one row per beam session). Pure and testable. */
export function buildRtRecordCsv(record: RtRecord): string {
  const header = ['Beam', 'Name', 'Fraction', 'Energy', 'Gantry', 'SpecifiedMU', 'DeliveredMU', 'Termination'];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = record.sessions.map(s =>
    [s.beamNumber, s.beamName, s.currentFraction, s.nominalEnergy, s.gantryAngle, s.specifiedMeterset, s.deliveredMeterset, s.terminationStatus]
      .map(esc)
      .join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

export default parseRtRecord;
