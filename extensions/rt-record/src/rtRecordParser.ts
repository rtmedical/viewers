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
      const cp0 = toArray(b?.ControlPointDeliverySequence)[0] as Record<string, any> | undefined;
      const delivered = toNum(b?.DeliveredPrimaryMeterset) ?? toNum(b?.DeliveredMeterset);
      const fraction = toNum(b?.CurrentFractionNumber);
      if (delivered != null) {
        totalDelivered += delivered;
        hasDelivered = true;
      }
      if (fraction != null) maxFraction = Math.max(maxFraction ?? 0, fraction);
      if (!record.machine && b?.TreatmentMachineName) record.machine = b.TreatmentMachineName;
      return {
        beamNumber: toNum(b?.ReferencedBeamNumber) ?? toNum(b?.BeamNumber),
        beamName: b?.BeamName,
        currentFraction: fraction,
        terminationStatus: b?.TreatmentTerminationStatus,
        specifiedMeterset: toNum(b?.SpecifiedPrimaryMeterset) ?? toNum(b?.SpecifiedMeterset),
        deliveredMeterset: delivered,
        nominalEnergy: toNum(cp0?.NominalBeamEnergy),
        gantryAngle: toNum(cp0?.GantryAngle),
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
