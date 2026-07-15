import { useCallback, useEffect, useMemo, useState } from 'react';
import { segmentation as cstSegmentation, Enums as csToolsEnums } from '@cornerstonejs/tools';

/**
 * Live view of the hydrated RTSTRUCT segmentation(s) for the "Focus" structures
 * workspace (RTV Wave 4 / Phase 3, autoseg-style).
 *
 * The stock cornerstone-dicom-rt SopClassHandler hydrates an RTSTRUCT into a
 * Contour segmentation; `showRtStructInMpr` may add a Labelmap rep too. This hook
 * reads those segmentations from OHIF's SegmentationService, exposes each
 * segment's `{segmentIndex, label, color, visible}` (color/visibility are
 * per-viewport, read from a viewport that actually carries the representation),
 * and returns toggles that fan a visibility change across every viewport/rep so
 * all MPR panes update together. Read/visibility only — no editing (RTV-114).
 */

const REP_TYPES = [
  csToolsEnums.SegmentationRepresentations.Contour,
  csToolsEnums.SegmentationRepresentations.Labelmap,
  csToolsEnums.SegmentationRepresentations.Surface,
];

export interface RtSegment {
  segmentIndex: number;
  label: string;
  color: [number, number, number];
  visible: boolean;
}

interface RtSegmentation {
  segmentationId: string;
  label: string;
}

/** RTSTRUCT-derived segmentations = those carrying a Contour representation. */
function readRtStructSegmentations(segService: any): RtSegmentation[] {
  return ((segService?.getSegmentations?.() as any[]) || [])
    .filter(s => s?.representationData?.Contour)
    .map(s => ({ segmentationId: s.segmentationId, label: s.label || s.segmentationId }));
}

/** [{ viewportId, representations:[{type}] }] the segmentation is shown in. */
function repsFor(segService: any, segmentationId: string): any[] {
  try {
    return segService?.getRepresentationsForSegmentation?.(segmentationId) || [];
  } catch {
    return [];
  }
}

export interface UseRtStructSegments {
  segmentations: RtSegmentation[];
  selectedId?: string;
  setSelectedId: (id: string) => void;
  segments: RtSegment[];
  /** True once the RTSTRUCT is hydrated (a Contour segmentation exists). */
  hydrated: boolean;
  /** The active (selected) segment index, autoseg-style row highlight. */
  activeSegmentIndex?: number;
  /**
   * A viewport that carries the segmentation representation — required for
   * per-viewport writes such as setSegmentColor (RTV-213 Properties dialog).
   */
  primaryViewportId?: string;
  setVisibility: (segmentIndex: number, visible: boolean) => void;
  setGroupVisibility: (segmentIndexes: number[], visible: boolean) => void;
  setActive: (segmentIndex: number) => void;
}

export function useRtStructSegments(servicesManager: any): UseRtStructSegments {
  const { segmentationService, viewportGridService } = servicesManager?.services ?? {};
  const [segmentations, setSegmentations] = useState<RtSegmentation[]>(() =>
    readRtStructSegmentations(segmentationService)
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(
    () => readRtStructSegmentations(segmentationService)[0]?.segmentationId
  );
  // Bumped on any segmentation event to force a re-read of per-segment state.
  const [tick, setTick] = useState(0);
  // Active segment (autoseg-style row highlight). Set locally on click for an
  // instant response, then resynced from cornerstone on segmentation events.
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!segmentationService?.subscribe) {
      return undefined;
    }
    const resync = () => {
      setSegmentations(readRtStructSegmentations(segmentationService));
      setTick(t => t + 1);
    };
    resync();
    const E = segmentationService.EVENTS ?? {};
    const evs = [
      E.SEGMENTATION_MODIFIED,
      E.SEGMENTATION_ADDED,
      E.SEGMENTATION_REMOVED,
      E.SEGMENTATION_REPRESENTATION_MODIFIED,
      E.SEGMENTATION_DATA_MODIFIED,
    ].filter(Boolean);
    const subs = evs.map((e: string) => segmentationService.subscribe(e, resync));
    // Re-read colours/visibility when the active viewport changes.
    if (viewportGridService?.subscribe && viewportGridService.EVENTS?.ACTIVE_VIEWPORT_ID_CHANGED) {
      subs.push(
        viewportGridService.subscribe(
          viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
          () => setTick(t => t + 1)
        )
      );
    }
    return () => subs.forEach((s: any) => s?.unsubscribe?.());
  }, [segmentationService, viewportGridService]);

  const selected = useMemo(
    () => segmentations.find(s => s.segmentationId === selectedId) ?? segmentations[0],
    [segmentations, selectedId]
  );
  const segmentationId = selected?.segmentationId;

  // A viewport that actually carries the representation (needed to read colour/
  // visibility — calling on a viewport without the rep throws / returns null).
  const primaryViewportId = useMemo(() => {
    if (!segmentationId) {
      return undefined;
    }
    return repsFor(segmentationService, segmentationId)[0]?.viewportId;
    // tick: re-resolve when representations change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentationService, segmentationId, tick]);

  // Resync the active segment from the cornerstone segment-index state
  // (segmentationService.setActiveSegment delegates to
  // cstSegmentation.segmentIndex.setActiveSegmentIndex, so this is the source
  // of truth) whenever a segmentation event bumps `tick`.
  useEffect(() => {
    if (!segmentationId) {
      setActiveSegmentIndex(undefined);
      return;
    }
    try {
      const idx = cstSegmentation.segmentIndex.getActiveSegmentIndex(segmentationId);
      setActiveSegmentIndex(Number.isFinite(idx) && (idx as number) > 0 ? (idx as number) : undefined);
    } catch {
      /* keep the locally-set value */
    }
  }, [segmentationId, tick]);

  const segments = useMemo<RtSegment[]>(() => {
    if (!segmentationId) {
      return [];
    }
    // Labels come from the segmentation state and need no viewport; only colour
    // and visibility are per-viewport. If no viewport currently carries the rep
    // (e.g. after a layout change unmounts the MPR panes), still render the list
    // with default colour/visible rather than blanking to "Estruturas (0)".
    const seg = segmentationService?.getSegmentation?.(segmentationId);
    const segMap = seg?.segments ?? {};
    const out: RtSegment[] = [];
    Object.keys(segMap).forEach(key => {
      const s = segMap[key];
      if (!s) {
        return;
      }
      const index = s.segmentIndex ?? Number(key);
      if (!Number.isFinite(index) || index === 0) {
        return; // 0 = background
      }
      let color: [number, number, number] = [136, 136, 136];
      let visible = true;
      if (primaryViewportId) {
        try {
          const c = segmentationService.getSegmentColor(primaryViewportId, segmentationId, index);
          if (Array.isArray(c) && c.length >= 3) {
            color = [c[0], c[1], c[2]];
          }
        } catch {
          /* no rep on this viewport yet */
        }
        try {
          visible = cstSegmentation.config.visibility.getSegmentIndexVisibility(
            primaryViewportId,
            { segmentationId, type: csToolsEnums.SegmentationRepresentations.Contour },
            index
          );
        } catch {
          /* default visible */
        }
      }
      // Coerce: the RT hydration path sets label to `ROIName || ROINumber`, so
      // an empty ROIName yields a NUMBER — keep RtSegment.label a real string.
      out.push({ segmentIndex: index, label: String(s.label ?? '') || `ROI ${index}`, color, visible });
    });
    return out.sort((a, b) => a.segmentIndex - b.segmentIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentationService, segmentationId, primaryViewportId, tick]);

  const setVisibility = useCallback(
    (segmentIndex: number, visible: boolean) => {
      if (!segmentationId) {
        return;
      }
      // Fan the change across every viewport/rep so all MPR panes stay in sync.
      const reps = repsFor(segmentationService, segmentationId);
      reps.forEach((r: any) => {
        const types = (r.representations || []).map((rep: any) => rep.type);
        (types.length ? types : REP_TYPES).forEach((type: any) => {
          try {
            segmentationService.setSegmentVisibility(
              r.viewportId,
              segmentationId,
              segmentIndex,
              visible,
              type
            );
          } catch {
            /* rep absent on this viewport */
          }
        });
      });
      setTick(t => t + 1);
    },
    [segmentationService, segmentationId]
  );

  const setGroupVisibility = useCallback(
    (segmentIndexes: number[], visible: boolean) => {
      segmentIndexes.forEach(i => setVisibility(i, visible));
    },
    [setVisibility]
  );

  const setActive = useCallback(
    (segmentIndex: number) => {
      if (!segmentationId) {
        return;
      }
      // Instant local highlight; the service call + tick resync confirm it.
      setActiveSegmentIndex(segmentIndex);
      try {
        segmentationService.setActiveSegment(segmentationId, segmentIndex);
        setTick(t => t + 1);
      } catch {
        /* ignore */
      }
    },
    [segmentationService, segmentationId]
  );

  return {
    segmentations,
    selectedId: selected?.segmentationId,
    setSelectedId,
    segments,
    hydrated: segmentations.length > 0,
    activeSegmentIndex,
    primaryViewportId,
    setVisibility,
    setGroupVisibility,
    setActive,
  };
}

export default useRtStructSegments;
