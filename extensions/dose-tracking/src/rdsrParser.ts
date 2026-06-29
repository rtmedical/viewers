/**
 * Radiation Dose Structured Report (RDSR) parser (RTV-201) — framework-free, tested.
 *
 * Walks a naturalized RDSR SR content tree (TID 10011 CT Radiation Dose /
 * TID 10001 Projection X-Ray) and extracts the dose measurements (CTDIvol, DLP,
 * KVP, mAs, …) per irradiation event plus the accumulated totals, then supports
 * a Diagnostic Reference Level (DRL) comparison and CSV export.
 *
 * No native OHIF handler claims the RDSR SOP classes, so a SopClassHandler here
 * is not a duplicate. Pure logic (no `@ohif/core`) → unit-verifiable; matches
 * the rt-record / rt-plan posture (RTV-114).
 */
export const RADIATION_DOSE_SR_SOP_CLASS_UIDS = {
  /** X-Ray Radiation Dose SR (the RDSR). */
  XRAY: '1.2.840.10008.5.1.4.1.1.88.67',
  /** Radiopharmaceutical Radiation Dose SR. */
  RADIOPHARMACEUTICAL: '1.2.840.10008.5.1.4.1.1.88.68',
  /** Patient Radiation Dose SR. */
  PATIENT: '1.2.840.10008.5.1.4.1.1.88.73',
} as const;

export const RADIATION_DOSE_SR_SOP_CLASS_UID_LIST = Object.values(RADIATION_DOSE_SR_SOP_CLASS_UIDS);

/** DCM CodeValues for the dose concepts we surface. */
export const DOSE_CODES = {
  CTDI_VOL: '113830', // Mean CTDIvol
  DLP: '113838', // DLP
  KVP: '113733', // KVP
  EXPOSURE_MAS: '113736', // Exposure (mAs)
  TUBE_CURRENT: '113734', // X-Ray Tube Current
  ACCUMULATED_DLP: '113813', // CT Dose Length Product Total
  ACCUMULATED_CTDI: '113722', // (accumulated CTDIvol, vendor-dependent)
} as const;

export interface DoseMeasurement {
  code?: string;
  concept: string;
  value: number;
  unit?: string;
}

export interface IrradiationEvent {
  label: string;
  ctdiVol?: number;
  dlp?: number;
  kvp?: number;
  measurements: DoseMeasurement[];
}

export interface DoseReport {
  events: IrradiationEvent[];
  /** Accumulated DLP (113813) if present, else the sum of per-event DLP. */
  totalDlp?: number;
  totalCtdiVol?: number;
  allMeasurements: DoseMeasurement[];
}

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function toNum(v: unknown): number | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  if (x == null || x === '') return undefined;
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function concept(item: any): { code?: string; meaning: string } {
  const c = toArray(item?.ConceptNameCodeSequence)[0] as any;
  return { code: c?.CodeValue, meaning: c?.CodeMeaning || '' };
}

function numValue(item: any): { value?: number; unit?: string } {
  const mv = toArray(item?.MeasuredValueSequence)[0] as any;
  const unitItem = toArray(mv?.MeasurementUnitsCodeSequence)[0] as any;
  return { value: toNum(mv?.NumericValue), unit: unitItem?.CodeValue || unitItem?.CodeMeaning };
}

/** Recursively collect every NUM content item as a DoseMeasurement. */
function collectMeasurements(node: any, out: DoseMeasurement[]): void {
  for (const item of toArray(node?.ContentSequence)) {
    if (item?.ValueType === 'NUM') {
      const { code, meaning } = concept(item);
      const { value, unit } = numValue(item);
      if (value != null) {
        out.push({ code, concept: meaning, value, unit });
      }
    }
    if (item?.ContentSequence) {
      collectMeasurements(item, out);
    }
  }
}

const matches = (m: DoseMeasurement, code: string, meaningSubstr: string) =>
  m.code === code || m.concept.toLowerCase().includes(meaningSubstr);

const firstValue = (ms: DoseMeasurement[], code: string, meaningSubstr: string) =>
  ms.find(m => matches(m, code, meaningSubstr))?.value;

/** Build an irradiation event from a CONTAINER node that holds dose NUM items. */
function buildEvent(container: any, index: number): IrradiationEvent | undefined {
  const measurements: DoseMeasurement[] = [];
  collectMeasurements(container, measurements);
  const ctdiVol = firstValue(measurements, DOSE_CODES.CTDI_VOL, 'ctdivol');
  const dlp = firstValue(measurements, DOSE_CODES.DLP, 'dose length product');
  if (ctdiVol == null && dlp == null) {
    return undefined; // not a dose-bearing acquisition container
  }
  return {
    label: concept(container).meaning || `Acquisition ${index + 1}`,
    ctdiVol,
    dlp,
    kvp: firstValue(measurements, DOSE_CODES.KVP, 'kvp'),
    measurements,
  };
}

export function parseRadiationDoseReport(instance: Record<string, any>): DoseReport {
  const report: DoseReport = { events: [], allMeasurements: [] };
  if (!instance) return report;

  collectMeasurements(instance, report.allMeasurements);

  // Irradiation events = direct/nested CONTAINER children that carry CTDIvol/DLP.
  const containers: any[] = [];
  const walkContainers = (node: any) => {
    for (const item of toArray(node?.ContentSequence)) {
      if (item?.ValueType === 'CONTAINER') {
        containers.push(item);
        walkContainers(item);
      }
    }
  };
  walkContainers(instance);
  report.events = containers
    .map((c, i) => buildEvent(c, i))
    .filter((e): e is IrradiationEvent => !!e);

  // Accumulated totals: prefer the explicit accumulated codes, else sum events.
  const accumulatedDlp = report.allMeasurements.find(m =>
    matches(m, DOSE_CODES.ACCUMULATED_DLP, 'dose length product total')
  )?.value;
  const eventDlpSum = report.events.reduce((s, e) => s + (e.dlp ?? 0), 0);
  report.totalDlp = accumulatedDlp ?? (report.events.some(e => e.dlp != null) ? eventDlpSum : undefined);

  const ctdis = report.events.map(e => e.ctdiVol).filter((v): v is number => v != null);
  report.totalCtdiVol = ctdis.length ? ctdis.reduce((a, b) => a + b, 0) : undefined;

  return report;
}

export interface DrlThresholds {
  /** Diagnostic Reference Level for total DLP (mGy·cm). */
  dlp?: number;
  /** DRL for CTDIvol (mGy). */
  ctdiVol?: number;
}

export interface DrlComparison {
  metric: 'DLP' | 'CTDIvol';
  value: number;
  threshold: number;
  ratio: number;
  exceeds: boolean;
}

export function compareToDrl(report: DoseReport, thresholds: DrlThresholds): DrlComparison[] {
  const out: DrlComparison[] = [];
  if (thresholds.dlp != null && report.totalDlp != null) {
    out.push({
      metric: 'DLP',
      value: report.totalDlp,
      threshold: thresholds.dlp,
      ratio: report.totalDlp / thresholds.dlp,
      exceeds: report.totalDlp > thresholds.dlp,
    });
  }
  if (thresholds.ctdiVol != null && report.totalCtdiVol != null) {
    out.push({
      metric: 'CTDIvol',
      value: report.totalCtdiVol,
      threshold: thresholds.ctdiVol,
      ratio: report.totalCtdiVol / thresholds.ctdiVol,
      exceeds: report.totalCtdiVol > thresholds.ctdiVol,
    });
  }
  return out;
}

export function buildDoseReportCsv(report: DoseReport): string {
  const header = ['Acquisition', 'CTDIvol(mGy)', 'DLP(mGy.cm)', 'kVp'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = report.events.map(e =>
    [e.label, e.ctdiVol ?? '', e.dlp ?? '', e.kvp ?? ''].map(esc).join(',')
  );
  const totals = esc('TOTAL') + ',' + esc(report.totalCtdiVol ?? '') + ',' + esc(report.totalDlp ?? '') + ',' + esc('');
  return [header.join(','), ...lines, totals].join('\n');
}
