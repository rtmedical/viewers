/**
 * Commands exposing the pure measurement calculators (RTV-27 epic) so modes /
 * toolbars / annotation tools can compute HU stats, Cobb angle, Agatston score,
 * SUVbw and segmentation-mask volume. The calculators stay framework-free (no
 * `@ohif/core`); `computeSegmentVolumeCc` adds the cornerstone glue that reads
 * the hydrated labelmap (RTV-31) — other inputs are supplied by the caller.
 */
import { cache as csCache } from '@cornerstonejs/core';
import { segmentation as cstSegmentation } from '@cornerstonejs/tools';
import {
  huStats,
  cobbAngle,
  agatstonScore,
  suvBwFactor,
  suvStats,
  maskVolume,
  Point,
  CalciumLesion,
  SuvFactorParams,
  MaskVolumeResult,
} from './measurements';

export function getCommandsModule() {
  const actions = {
    computeHuStats: ({ values }: { values: number[] }) => huStats(values ?? []),
    computeCobbAngle: ({ line1, line2 }: { line1: [Point, Point]; line2: [Point, Point] }) => cobbAngle(line1, line2),
    computeAgatston: ({ lesions }: { lesions: CalciumLesion[] }) => agatstonScore(lesions ?? []),
    computeSuvBw: ({ values, ...params }: { values: number[] } & SuvFactorParams) => {
      const factor = suvBwFactor(params);
      return factor == null ? null : suvStats(values ?? [], factor);
    },
    /**
     * RTV-31 — voxel-exact volume (cm³) of a segment from its hydrated
     * LABELMAP representation. Returns null when the segmentation has no
     * volume labelmap yet (e.g. contour-only RTSTRUCT before conversion) —
     * callers fall back to their contour-based approximation.
     */
    computeSegmentVolumeCc: ({
      segmentationId,
      segmentIndex,
    }: {
      segmentationId: string;
      segmentIndex?: number;
    }): MaskVolumeResult | null => {
      try {
        const seg = cstSegmentation.state.getSegmentation(segmentationId);
        const volumeId = (seg?.representationData?.Labelmap as any)?.volumeId;
        if (!volumeId) {
          return null;
        }
        const volume: any = csCache.getVolume?.(volumeId);
        const scalars = volume?.voxelManager?.getCompleteScalarDataArray?.();
        const spacing = volume?.spacing;
        if (!scalars?.length || !Array.isArray(spacing) || spacing.length < 3) {
          return null;
        }
        return maskVolume(scalars, [spacing[0], spacing[1], spacing[2]], segmentIndex);
      } catch (e) {
        return null;
      }
    },
  };

  const definitions = {
    computeHuStats: { commandFn: actions.computeHuStats },
    computeCobbAngle: { commandFn: actions.computeCobbAngle },
    computeAgatston: { commandFn: actions.computeAgatston },
    computeSuvBw: { commandFn: actions.computeSuvBw },
    computeSegmentVolumeCc: { commandFn: actions.computeSegmentVolumeCc },
  };

  return { actions, definitions, defaultContext: 'DEFAULT' };
}

export default getCommandsModule;
