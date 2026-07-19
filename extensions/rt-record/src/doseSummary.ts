/**
 * RT dose-information view model (RTV-170, epic RTV-162) — framework-free, tested.
 *
 * Computes the two tables of the Dose Information panel from parsed RT Treatment
 * Records ({@link ./rtRecordParser}):
 *  - per-session detail (Field / Fraction / specified vs delivered MU + rounding)
 *  - dose summary "by counters": Delivered Dose from Fractions, Total Dose
 *    Corrections, Delivered Dose to (selected) Date, Dose to be Recorded.
 *
 * RT Treatment Records carry delivered/specified meterset per beam but NOT the
 * manual "dose corrections" (those live in the RIS); corrections is therefore an
 * explicit input that defaults to none and is reported as EXCLUDED from the
 * fractions total (caution), matching the Varian panel semantics. Pure MU
 * arithmetic → unit-verifiable. Zero-fork (RTV-114), no `@ohif/core`.
 */
import type { RtRecord } from './rtRecordParser';

/** MU tolerance under which a delivered/specified mismatch is attributed to rounding. */
export const MU_ROUNDING_TOLERANCE = 1;

export interface SessionDoseRow {
  recordDate?: string;
  field: string;
  beamNumber?: number;
  fraction?: number;
  specifiedMU?: number;
  deliveredMU?: number;
  /** delivered differs from specified but within MU_ROUNDING_TOLERANCE. */
  muRounded: boolean;
}

export interface DoseCountersOptions {
  /** Only count records with treatmentDate <= this DICOM date (YYYYMMDD). */
  selectedDate?: string;
  /** Manual dose corrections (MU) from the RIS — not present in the record itself. */
  corrections?: number[];
}

export interface DoseCounters {
  deliveredFromFractions: number;
  totalCorrections: number;
  deliveredToDate: number;
  specifiedTotal: number;
  doseToBeRecorded: number;
  hasMuRounding: boolean;
  /** Corrections are reported separately and excluded from the fractions total. */
  correctionsExcludedFromTotals: boolean;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function isRounded(specified?: number, delivered?: number): boolean {
  return (
    specified != null &&
    delivered != null &&
    delivered !== specified &&
    Math.abs(delivered - specified) <= MU_ROUNDING_TOLERANCE
  );
}

function withinDate(record: RtRecord, selectedDate?: string): boolean {
  if (!selectedDate) {
    return true;
  }
  return !record.treatmentDate || record.treatmentDate <= selectedDate;
}

export function buildSessionDoseRows(records: RtRecord[]): SessionDoseRow[] {
  return (records || []).flatMap(record =>
    (record.sessions || []).map(s => ({
      recordDate: record.treatmentDate,
      field: s.beamName || (s.beamNumber != null ? `#${s.beamNumber}` : '—'),
      beamNumber: s.beamNumber,
      fraction: s.currentFraction,
      specifiedMU: s.specifiedMeterset,
      deliveredMU: s.deliveredMeterset,
      muRounded: isRounded(s.specifiedMeterset, s.deliveredMeterset),
    }))
  );
}

export function buildDoseCounters(records: RtRecord[], options: DoseCountersOptions = {}): DoseCounters {
  const inScope = (records || []).filter(r => withinDate(r, options.selectedDate));
  const sessions = inScope.flatMap(r => r.sessions || []);

  const deliveredFromFractions = sum(
    sessions.map(s => s.deliveredMeterset).filter((v): v is number => v != null)
  );
  const specifiedTotal = sum(
    sessions.map(s => s.specifiedMeterset).filter((v): v is number => v != null)
  );
  const totalCorrections = sum((options.corrections || []).filter(v => Number.isFinite(v)));
  const deliveredToDate = deliveredFromFractions + totalCorrections;
  const doseToBeRecorded = Math.max(0, specifiedTotal - deliveredToDate);
  const hasMuRounding = sessions.some(s => isRounded(s.specifiedMeterset, s.deliveredMeterset));

  return {
    deliveredFromFractions,
    totalCorrections,
    deliveredToDate,
    specifiedTotal,
    doseToBeRecorded,
    hasMuRounding,
    correctionsExcludedFromTotals: true,
  };
}
