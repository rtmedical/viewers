import { KeyImageReference } from './types';

/** A series-grouped view of key images, suitable for panel rendering. */
export interface KeyImageSeriesGroup {
  SeriesInstanceUID: string;
  SeriesDescription?: string;
  Modality?: string;
  items: KeyImageReference[];
}

/**
 * Numeric comparison that pushes missing/non-finite values to the end while
 * remaining stable for equal keys.
 */
function compareNumber(a?: number, b?: number): number {
  const av = typeof a === 'number' && Number.isFinite(a) ? a : Number.POSITIVE_INFINITY;
  const bv = typeof b === 'number' && Number.isFinite(b) ? b : Number.POSITIVE_INFINITY;
  return av - bv;
}

/**
 * Stable ordering for display: SeriesNumber, then InstanceNumber, then
 * frameNumber, then SOPInstanceUID as a deterministic tie-breaker. Items with
 * missing numeric keys sort after those that have them. Does not mutate input.
 */
export function sortKeyImages(refs: KeyImageReference[]): KeyImageReference[] {
  return [...refs].sort((a, b) => {
    return (
      compareNumber(a.SeriesNumber, b.SeriesNumber) ||
      compareNumber(a.InstanceNumber, b.InstanceNumber) ||
      compareNumber(a.frameNumber, b.frameNumber) ||
      (a.SOPInstanceUID < b.SOPInstanceUID ? -1 : a.SOPInstanceUID > b.SOPInstanceUID ? 1 : 0)
    );
  });
}

/**
 * Group references by series, preserving first-seen series order and the input
 * order of items within each group. Series-level display metadata is taken from
 * the first reference seen for that series.
 */
export function groupKeyImagesBySeries(refs: KeyImageReference[]): KeyImageSeriesGroup[] {
  const order: string[] = [];
  const groups = new Map<string, KeyImageSeriesGroup>();

  for (const ref of refs) {
    let group = groups.get(ref.SeriesInstanceUID);
    if (!group) {
      group = {
        SeriesInstanceUID: ref.SeriesInstanceUID,
        SeriesDescription: ref.SeriesDescription,
        Modality: ref.Modality,
        items: [],
      };
      groups.set(ref.SeriesInstanceUID, group);
      order.push(ref.SeriesInstanceUID);
    }
    group.items.push(ref);
  }

  return order.map(uid => groups.get(uid)!);
}
