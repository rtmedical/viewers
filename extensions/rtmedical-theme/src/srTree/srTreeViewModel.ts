/**
 * Structured Report (SR) tree view model + text export (RTV-35) — React-free, tested.
 *
 * Reuses the upstream cornerstone-dicom-sr parser (the SR display set already
 * carries a parsed `measurements` array) and shapes it into a navigable tree:
 * each SR document → its measurement groups → measurements (concept + value).
 * The panel renders this and dispatches the native jump/hydrate on click.
 * Graphics-annotation rendering + click-to-graphics + HTML export are follow-ups.
 * Zero-fork (RTV-114): consumes public SR display-set data only.
 */
export interface SrLabelValue {
  label?: string;
  value?: string;
}

export interface SrMeasurementLike {
  uid?: string;
  TrackingUniqueIdentifier?: string;
  label?: string;
  labels?: SrLabelValue[];
  displayText?: unknown;
}

export interface SrDisplaySetLike {
  displaySetInstanceUID: string;
  Modality?: string;
  SeriesDescription?: string;
  SeriesDate?: string;
  measurements?: SrMeasurementLike[];
}

export type SrNodeType = 'sr' | 'measurement';

export interface SrTreeNode {
  id: string;
  type: SrNodeType;
  label: string;
  uid?: string;
  displaySetInstanceUID?: string;
  children?: SrTreeNode[];
}

export function describeSrMeasurement(m: SrMeasurementLike): string {
  if (m.label) {
    return m.label;
  }
  if (Array.isArray(m.labels) && m.labels.length) {
    return m.labels
      .map(l => [l.label, l.value].filter(Boolean).join(': '))
      .filter(Boolean)
      .join(', ');
  }
  const dt = m.displayText;
  if (typeof dt === 'string') {
    return dt;
  }
  if (Array.isArray(dt)) {
    return dt.flat(Infinity).filter(x => typeof x === 'string').join(' ');
  }
  return m.TrackingUniqueIdentifier || m.uid || 'Measurement';
}

export function buildSrTreeModel(displaySets: SrDisplaySetLike[]): SrTreeNode[] {
  return (displaySets || [])
    .filter(ds => ds && String(ds.Modality || '').toUpperCase() === 'SR')
    .map(ds => {
      const measurements = Array.isArray(ds.measurements) ? ds.measurements : [];
      const children: SrTreeNode[] = measurements.map((m, index) => ({
        id: `${ds.displaySetInstanceUID}-m-${m.uid || m.TrackingUniqueIdentifier || index}`,
        type: 'measurement' as const,
        label: describeSrMeasurement(m),
        uid: m.uid || m.TrackingUniqueIdentifier,
        displaySetInstanceUID: ds.displaySetInstanceUID,
      }));
      const node: SrTreeNode = {
        id: ds.displaySetInstanceUID,
        type: 'sr',
        label: ds.SeriesDescription || `SR ${ds.SeriesDate || ''}`.trim(),
        displaySetInstanceUID: ds.displaySetInstanceUID,
      };
      if (children.length) {
        node.children = children;
      }
      return node;
    });
}

/** Plain-text export of all SR documents and their measurements. */
export function srToText(displaySets: SrDisplaySetLike[]): string {
  const tree = buildSrTreeModel(displaySets);
  const lines: string[] = [];
  tree.forEach(sr => {
    lines.push(`# ${sr.label}`);
    (sr.children || []).forEach(m => lines.push(`  - ${m.label}`));
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}
