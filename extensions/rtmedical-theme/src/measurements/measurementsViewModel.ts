/**
 * Measurements panel view model + CSV export (RTV-151) — React-free, tested.
 * Maps the native MeasurementService measurements into sortable rows and a CSV
 * string. The panel renders these and dispatches the stock `jumpToMeasurement`
 * command on click. Zero-fork (RTV-114): consumes only public measurement data.
 */
export interface MeasurementLike {
  uid: string;
  label?: string;
  toolName?: string;
  type?: string;
  modality?: string;
  displayText?: unknown;
}

export interface MeasurementRow {
  uid: string;
  label: string;
  type: string;
  summary: string;
}

/** Flattens OHIF's various displayText shapes (string | string[] | {primary,secondary}) to one line. */
export function summarizeDisplayText(displayText: unknown): string {
  if (!displayText) {
    return '';
  }
  if (typeof displayText === 'string') {
    return displayText;
  }
  if (Array.isArray(displayText)) {
    return displayText.flat(Infinity).filter(x => typeof x === 'string').join(' ');
  }
  if (typeof displayText === 'object') {
    const primary = (displayText as { primary?: unknown }).primary;
    if (Array.isArray(primary)) {
      return primary.filter(x => typeof x === 'string').join(' ');
    }
  }
  return '';
}

export function buildMeasurementsViewModel(measurements: MeasurementLike[]): MeasurementRow[] {
  return measurements
    .filter(m => m && m.uid)
    .map(m => ({
      uid: m.uid,
      label: m.label || '',
      type: m.toolName || m.type || 'Measurement',
      summary: summarizeDisplayText(m.displayText),
    }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label));
}

function csvEscape(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function measurementsToCsv(measurements: MeasurementLike[]): string {
  const rows = buildMeasurementsViewModel(measurements);
  const header = ['uid', 'type', 'label', 'summary'].join(',');
  const lines = rows.map(r => [r.uid, r.type, r.label, r.summary].map(csvEscape).join(','));
  return [header, ...lines].join('\n');
}
