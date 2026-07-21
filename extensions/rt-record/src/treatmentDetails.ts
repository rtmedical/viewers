/**
 * Pure **Treatment Details view model** (RTV-173, epic RTV-162) over a parsed
 * {@link ./rtRecordParser} RtRecord — the data source of the Treatment Details
 * panel. Framework-free and `@ohif/*`-free, unit-tested.
 *
 * Flattens one RT Treatment Record into a per-beam delivery table (specified vs
 * delivered MU + delta, TreatmentTerminationStatus 3008,002A,
 * TreatmentVerificationStatus 3008,002C, override/correction counts from
 * OverrideSequence 3008,0060 / CorrectedParameterSequence 3008,0068) plus MU
 * totals. Every field is optional — real-world records omit attributes freely.
 *
 * HONEST LIMIT — clinical treatment "notes": the Varian Treatment Details
 * screen shows a free-text notes/journal column. That data does NOT exist in
 * the DICOM RT Treatment Record (PS3.3 C.8.8.21 has no notes attribute); it
 * lives in the ARIA/RIS journal and only becomes available through the backend
 * integration (RTV-169). This model therefore has no `notes` field on purpose.
 */
import type { RtRecord } from './rtRecordParser';

export interface TreatmentDetailsBeam {
  beamNumber?: number;
  /** BeamName (300A,00C2) when the record carries it. */
  name?: string;
  /** Specified(Primary)Meterset in MU. */
  specifiedMu?: number;
  /** Delivered(Primary)Meterset in MU. */
  deliveredMu?: number;
  /** delivered − specified; undefined unless both sides are present. */
  deltaMu?: number;
  /** TreatmentTerminationStatus (3008,002A): NORMAL | OPERATOR | MACHINE | UNKNOWN. */
  terminationStatus?: string;
  /** TreatmentVerificationStatus (3008,002C): VERIFIED | VERIFIED_OVR | NOT_VERIFIED. */
  verificationStatus?: string;
  /** OverrideSequence (3008,0060) items on the beam (incl. control-point level). */
  overrideCount: number;
  /** CorrectedParameterSequence (3008,0068) items on the beam. */
  correctionCount: number;
}

export interface TreatmentDetailsTotals {
  /** Σ specified MU over beams that carry a specified meterset; undefined when none do. */
  specified?: number;
  /** Σ delivered MU over beams that carry a delivered meterset; undefined when none do. */
  delivered?: number;
}

export interface TreatmentDetails {
  /** TreatmentMachineName of the record (record- or beam-level). */
  machine?: string;
  /** TreatmentDate (3008,0250), DICOM DA. */
  date?: string;
  /** TreatmentTime (3008,0251), DICOM TM. */
  time?: string;
  /** Highest CurrentFractionNumber seen in the record. */
  fraction?: number;
  beams: TreatmentDetailsBeam[];
  totals: TreatmentDetailsTotals;
}

/**
 * Build the Treatment Details view model of one parsed RT Treatment Record.
 * Tolerates a missing/empty record and missing per-beam attributes.
 */
export function buildTreatmentDetails(rtRecord: RtRecord | undefined | null): TreatmentDetails {
  const details: TreatmentDetails = {
    machine: rtRecord?.machine,
    date: rtRecord?.treatmentDate,
    time: rtRecord?.treatmentTime,
    fraction: rtRecord?.fractionNumber,
    beams: [],
    totals: {},
  };
  if (!rtRecord) {
    return details;
  }

  let specifiedTotal: number | undefined;
  let deliveredTotal: number | undefined;

  details.beams = (rtRecord.sessions ?? []).map(s => {
    const specifiedMu = s.specifiedMeterset;
    const deliveredMu = s.deliveredMeterset;
    if (specifiedMu != null) {
      specifiedTotal = (specifiedTotal ?? 0) + specifiedMu;
    }
    if (deliveredMu != null) {
      deliveredTotal = (deliveredTotal ?? 0) + deliveredMu;
    }
    return {
      beamNumber: s.beamNumber,
      name: s.beamName,
      specifiedMu,
      deliveredMu,
      deltaMu: specifiedMu != null && deliveredMu != null ? deliveredMu - specifiedMu : undefined,
      terminationStatus: s.terminationStatus,
      verificationStatus: s.verificationStatus,
      overrideCount: s.overrides?.length ?? 0,
      correctionCount: s.corrections?.length ?? 0,
    };
  });

  details.totals = { specified: specifiedTotal, delivered: deliveredTotal };
  return details;
}

export default buildTreatmentDetails;
