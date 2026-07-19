/**
 * Pure (React-free) view model for the Key Images panel. Keeping the
 * presentational logic here — separate from the .tsx component — lets it be
 * unit-tested without a DOM and keeps the component a thin render of this
 * shape. Consumes only the extension's own tested primitives (RTV-114:
 * no @ohif/core | app | ui dependency).
 */
import type { KeyImageReference } from '../types';
import { getKeyImageId } from '../keyImageId';
import { describeKeyImage } from '../keyImageLabel';
import { groupKeyImagesBySeries, type KeyImageSeriesGroup } from '../utils';

export interface KeyImageItemViewModel {
  /** Canonical id — stable React key and the handle passed to removeKeyImage. */
  id: string;
  /** One-line human label (modality, series/instance numbers, descriptions). */
  label: string;
  /** The underlying reference, forwarded verbatim to commands. */
  reference: KeyImageReference;
}

export interface KeyImageSeriesViewModel {
  seriesInstanceUID: string;
  seriesLabel: string;
  items: KeyImageItemViewModel[];
}

export interface KeyImagesViewModel {
  total: number;
  isEmpty: boolean;
  series: KeyImageSeriesViewModel[];
}

function seriesLabel(group: KeyImageSeriesGroup): string {
  const parts: string[] = [];
  if (group.Modality) {
    parts.push(group.Modality);
  }
  if (group.SeriesDescription) {
    parts.push(group.SeriesDescription);
  }
  return parts.join(' · ') || `Series ${group.SeriesInstanceUID}`;
}

/**
 * Maps the flat selection from KeyImageService into a series-grouped,
 * render-ready structure.
 */
export function buildKeyImagesViewModel(keyImages: KeyImageReference[]): KeyImagesViewModel {
  const series = groupKeyImagesBySeries(keyImages).map(group => ({
    seriesInstanceUID: group.SeriesInstanceUID,
    seriesLabel: seriesLabel(group),
    items: group.items.map(reference => ({
      id: getKeyImageId(reference),
      label: describeKeyImage(reference),
      reference,
    })),
  }));

  return {
    total: keyImages.length,
    isEmpty: keyImages.length === 0,
    series,
  };
}
