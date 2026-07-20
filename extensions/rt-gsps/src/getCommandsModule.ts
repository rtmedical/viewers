/**
 * GSPS commands (RTV-200, Phase 1):
 *
 * - `saveGsps`  — persist the ACTIVE viewport's presentation (window/level +
 *   the cornerstone annotations drawn on its series) as a DICOM Grayscale
 *   Softcopy Presentation State → STOW-RS to the active data source. With no
 *   annotations it still saves a W/L-only GSPS.
 * - `applyGsps` — apply a stored GSPS display set (created by the rt-gsps
 *   SopClassHandler) to the ACTIVE viewport: first VOI entry → `voiRange`.
 *
 * The GSPS is filed under the SOURCE study, in a dedicated "RT Medical
 * Presentation States" series (one SeriesInstanceUID per study per app
 * session). Success/failure surfaces as a toast; STOW failure (PACS offline)
 * is caught and reported without crashing.
 *
 * Coordinate note: `worldToImageCoords` returns continuous [column, row]
 * image coordinates with the TLHC pixel center at (0.5, 0.5) — exactly the
 * DICOM Graphic Annotation PIXEL convention (PS3.3 C.10.5), so points are
 * emitted as-is with no half-pixel offset.
 *
 * FOLLOW-UP (declared): `applyGsps` applies the VOI only; re-hydrating
 * GraphicObjectSequence/TextObjectSequence back into cornerstone annotation
 * tools (and honoring per-image VOI/displayed-area subsets) is GSPS Phase 2.
 */
import { utilities as csUtils } from '@cornerstonejs/core';
import { annotation as csToolsAnnotation } from '@cornerstonejs/tools';

import {
  GspsGraphicAnnotation,
  GspsGraphicObject,
  GspsImageRef,
  GspsPatientStudyContext,
  GspsTextObject,
} from './gspsDataset';
import { buildGspsDatasetWithRealUids, newUid, toDa } from './gspsSerialize';
import { ParsedGsps } from './parseGspsInstance';

/** One PR series per study per session, so presentation states group in PACS. */
const seriesByStudy = new Map<string, string>();
let instanceCounter = 0;

function gspsSeriesFor(studyInstanceUID: string): string {
  let uid = seriesByStudy.get(studyInstanceUID);
  if (!uid) {
    uid = newUid();
    seriesByStudy.set(studyInstanceUID, uid);
  }
  return uid;
}

/** Pull patient/study identity from the viewport's display sets. */
function contextFromDisplaySets(displaySets: any[]): GspsPatientStudyContext | null {
  for (const ds of displaySets ?? []) {
    const instance = ds?.instances?.[0] ?? ds?.instance;
    if (instance?.StudyInstanceUID) {
      return {
        PatientName: instance.PatientName,
        PatientID: instance.PatientID,
        PatientBirthDate: instance.PatientBirthDate,
        PatientSex: instance.PatientSex,
        StudyInstanceUID: instance.StudyInstanceUID,
        StudyDate: instance.StudyDate,
        StudyTime: instance.StudyTime,
        AccessionNumber: instance.AccessionNumber,
        ReferringPhysicianName: instance.ReferringPhysicianName,
        StudyID: instance.StudyID,
      };
    }
  }
  return null;
}

interface ImageIndexEntry {
  ref: GspsImageRef;
  seriesInstanceUID: string;
  /** True when PixelSpacing row != col — worldToImageCoords pairs the
   * spacings incorrectly upstream, so graphics would come out skewed. */
  anisotropic: boolean;
}

/**
 * Index every image instance of the viewport's IMAGE display sets: series →
 * refs (for ReferencedSeriesSequence / DisplayedArea) and imageId → ref (to
 * match annotations by `metadata.referencedImageId`).
 */
function indexImageDisplaySets(
  displaySets: any[],
  studyInstanceUID: string
): {
  seriesRefs: Map<string, GspsImageRef[]>;
  byImageId: Map<string, ImageIndexEntry>;
  dimensionsBySeries: Map<string, { columns: number; rows: number }>;
  backgroundSeriesUID: string | null;
  rescale: { intercept: number; slope: number; type?: string } | null;
} {
  const seriesRefs = new Map<string, GspsImageRef[]>();
  const byImageId = new Map<string, ImageIndexEntry>();
  const dimensionsBySeries = new Map<string, { columns: number; rows: number }>();
  let backgroundSeriesUID: string | null = null;
  let rescale: { intercept: number; slope: number; type?: string } | null = null;

  const imageDisplaySets = (displaySets ?? []).filter(
    ds => (ds?.numImageFrames ?? 0) > 0 && ds?.instances?.length
  );
  for (const ds of imageDisplaySets) {
    for (const instance of ds.instances) {
      const seriesInstanceUID = instance?.SeriesInstanceUID;
      if (!seriesInstanceUID || !instance?.SOPClassUID || !instance?.SOPInstanceUID) {
        continue;
      }
      // A GSPS references images of ONE study (PS3.3 C.11.11); a fusion
      // viewport may also carry an overlay from ANOTHER study — skip it.
      if (instance.StudyInstanceUID && instance.StudyInstanceUID !== studyInstanceUID) {
        continue;
      }
      if (!backgroundSeriesUID) {
        backgroundSeriesUID = seriesInstanceUID;
      }
      if (!rescale && backgroundSeriesUID === seriesInstanceUID) {
        const intercept = Number(instance.RescaleIntercept);
        const slope = Number(instance.RescaleSlope);
        if (Number.isFinite(intercept) && Number.isFinite(slope)) {
          rescale = {
            intercept,
            slope,
            type: typeof instance.RescaleType === 'string' ? instance.RescaleType : undefined,
          };
        }
      }
      const ref: GspsImageRef = {
        ReferencedSOPClassUID: instance.SOPClassUID,
        ReferencedSOPInstanceUID: instance.SOPInstanceUID,
      };
      const refs = seriesRefs.get(seriesInstanceUID) ?? [];
      refs.push(ref);
      seriesRefs.set(seriesInstanceUID, refs);
      if (instance.imageId) {
        const spacing = instance.PixelSpacing;
        const anisotropic =
          Array.isArray(spacing) &&
          spacing.length === 2 &&
          Number(spacing[0]) !== Number(spacing[1]);
        byImageId.set(instance.imageId, { ref, seriesInstanceUID, anisotropic });
      }
      if (!dimensionsBySeries.has(seriesInstanceUID) && instance.Columns && instance.Rows) {
        dimensionsBySeries.set(seriesInstanceUID, {
          columns: Number(instance.Columns),
          rows: Number(instance.Rows),
        });
      }
    }
  }
  return { seriesRefs, byImageId, dimensionsBySeries, backgroundSeriesUID, rescale };
}

/** Order 4 corner points as a perimeter walk (angle around the centroid). */
function perimeterOrder(points: [number, number][]): [number, number][] {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [...points].sort(
    (a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx)
  );
}

/** Squared distance between two [column, row] points. */
function dist2(a: [number, number], b: [number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

/**
 * Map one cornerstone annotation (points already in PIXEL units) to GSPS
 * graphic objects. Unknown tools fall back to an open POLYLINE.
 */
function toGraphicObjects(toolName: string, points: [number, number][]): GspsGraphicObject[] {
  switch (toolName) {
    case 'Probe':
      return [{ graphicType: 'POINT', points: [points[0]] }];
    case 'CircleROI':
      // Handles are [center, point-on-circumference] — the CIRCLE encoding.
      return points.length >= 2 ? [{ graphicType: 'CIRCLE', points: points.slice(0, 2) }] : [];
    case 'EllipticalROI': {
      if (points.length < 4) {
        return [{ graphicType: 'POLYLINE', points }];
      }
      // Handles are two axis-endpoint pairs; GSPS wants major axis first.
      const [a, b] = [points.slice(0, 2), points.slice(2, 4)];
      const ordered = dist2(a[0] as [number, number], a[1] as [number, number]) >=
        dist2(b[0] as [number, number], b[1] as [number, number])
        ? [...a, ...b]
        : [...b, ...a];
      return [{ graphicType: 'ELLIPSE', points: ordered as [number, number][] }];
    }
    case 'RectangleROI': {
      if (points.length < 4) {
        return [{ graphicType: 'POLYLINE', points }];
      }
      const walk = perimeterOrder(points.slice(0, 4));
      return [{ graphicType: 'POLYLINE', points: [...walk, walk[0]] }];
    }
    case 'Bidirectional':
    case 'CobbAngle':
      // Two independent 2-point segments.
      return points.length >= 4
        ? [
            { graphicType: 'POLYLINE', points: points.slice(0, 2) },
            { graphicType: 'POLYLINE', points: points.slice(2, 4) },
          ]
        : [{ graphicType: 'POLYLINE', points }];
    default:
      // Length, Angle, ArrowAnnotate, PlanarFreehandROI, SplineROI, ...
      return [{ graphicType: 'POLYLINE', points }];
  }
}

export function getCommandsModule({ servicesManager, extensionManager }: any) {
  const {
    viewportGridService,
    cornerstoneViewportService,
    displaySetService,
    uiNotificationService,
  } = servicesManager.services;

  const notify = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    try {
      uiNotificationService?.show?.({ title, message, type, duration: 4000 });
    } catch (e) {
      /* toasts must never break the command */
    }
  };

  const getActiveViewport = () => {
    const activeViewportId =
      viewportGridService.getActiveViewportId?.() ??
      viewportGridService.getState?.()?.activeViewportId;
    return {
      activeViewportId,
      viewport: cornerstoneViewportService.getCornerstoneViewport(activeViewportId),
    };
  };

  /**
   * Collect the annotations drawn on the indexed images, converted from WORLD
   * handle points to PIXEL, grouped per referenced image. Freehand contours
   * use the full `data.contour.polyline` (closed by repeating the first point).
   */
  const collectGraphicAnnotations = (
    byImageId: Map<string, ImageIndexEntry>
  ): GspsGraphicAnnotation[] => {
    const perImage = new Map<string, GspsGraphicAnnotation>();
    const annotations = csToolsAnnotation?.state?.getAllAnnotations?.() ?? [];
    for (const item of annotations) {
      const imageId = item?.metadata?.referencedImageId;
      const target = imageId ? byImageId.get(imageId) : undefined;
      if (!target) {
        continue;
      }
      // Hidden annotations are not part of the presented state.
      if (item?.isVisible === false) {
        continue;
      }
      // Anisotropic pixels: the installed worldToImageCoords pairs the
      // spacings incorrectly (upstream), producing skewed GraphicData —
      // skip graphics for those images rather than store wrong geometry.
      if (target.anisotropic) {
        continue;
      }
      const contour = item?.data?.contour;
      const worldPoints: number[][] = contour?.polyline ?? item?.data?.handles?.points ?? [];
      let pixelPoints = worldPoints
        .map(point => {
          try {
            return csUtils.worldToImageCoords(imageId, point as any);
          } catch (e) {
            return undefined;
          }
        })
        .filter(Boolean) as [number, number][];
      if (!pixelPoints.length) {
        continue;
      }
      if (contour?.polyline && contour?.closed) {
        pixelPoints = [...pixelPoints, pixelPoints[0]];
      }
      const toolName = item?.metadata?.toolName ?? '';
      const graphics = contour?.polyline
        ? [{ graphicType: 'POLYLINE', points: pixelPoints } as GspsGraphicObject]
        : toGraphicObjects(toolName, pixelPoints);
      const label = item?.data?.text ?? item?.data?.label;
      const texts: GspsTextObject[] = label
        ? [{ anchorPoint: pixelPoints[pixelPoints.length - 1], text: String(label) }]
        : [];

      const entry = perImage.get(imageId) ?? { images: [target.ref], graphics: [], texts: [] };
      entry.graphics.push(...graphics);
      entry.texts.push(...texts);
      perImage.set(imageId, entry);
    }
    return [...perImage.values()];
  };

  const actions = {
    /**
     * Active viewport → GSPS (W/L + annotations) → PACS. Saves a W/L-only
     * presentation state when no annotation targets the visible series.
     */
    saveGsps: async ({ label, description }: { label?: string; description?: string } = {}) => {
      const { activeViewportId, viewport } = getActiveViewport();
      if (!viewport) {
        notify('error', 'Presentation State', 'No active viewport to save.');
        return false;
      }
      const displaySets =
        cornerstoneViewportService.getViewportDisplaySets?.(activeViewportId) ?? [];
      const context = contextFromDisplaySets(displaySets);
      if (!context) {
        notify('error', 'Presentation State', 'No study loaded in the active viewport.');
        return false;
      }
      const { seriesRefs, byImageId, dimensionsBySeries, backgroundSeriesUID, rescale } =
        indexImageDisplaySets(displaySets, context.StudyInstanceUID);
      if (!seriesRefs.size) {
        notify('error', 'Presentation State', 'The active viewport shows no referenceable images.');
        return false;
      }

      // Window/level of the active viewport. getProperties() without a
      // volumeId returns the BACKGROUND volume's properties, so the VOI is
      // scoped to the background series (fusion overlays keep their own).
      // DICOM LINEAR convention (PS3.3 C.11.2.1.2): WW = |u-l|+1, WC = (l+u+1)/2.
      const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
      const voiRange = viewport.getProperties?.()?.voiRange;
      const backgroundRefs = backgroundSeriesUID ? seriesRefs.get(backgroundSeriesUID) : undefined;
      const voi = voiRange
        ? [
            {
              windowWidth: round6(Math.abs(voiRange.upper - voiRange.lower) + 1),
              windowCenter: round6((voiRange.lower + voiRange.upper + 1) / 2),
              images: backgroundRefs,
            },
          ]
        : [];

      const graphicAnnotations = collectGraphicAnnotations(byImageId);
      const referencedSeries = [...seriesRefs.entries()].map(([SeriesInstanceUID, images]) => ({
        SeriesInstanceUID,
        images,
      }));
      // Displayed Area is a mandatory GSPS module — fall back to the
      // viewport's image data dimensions when the metadata lacks Rows/Columns.
      const vpDims = viewport.getImageData?.()?.dimensions;
      const fallbackDims =
        Array.isArray(vpDims) && vpDims[0] > 0 && vpDims[1] > 0
          ? { columns: Number(vpDims[0]), rows: Number(vpDims[1]) }
          : null;
      const displayedAreas = referencedSeries
        .map(series => {
          const dims = dimensionsBySeries.get(series.SeriesInstanceUID) ?? fallbackDims;
          return dims ? { images: series.images, ...dims } : null;
        })
        .filter(Boolean) as { images: GspsImageRef[]; columns: number; rows: number }[];
      if (!displayedAreas.length) {
        notify('error', 'Presentation State', 'Image dimensions unavailable — cannot build a conformant GSPS.');
        return false;
      }

      const dataset = buildGspsDatasetWithRealUids(
        { referencedSeries, voi, graphicAnnotations, displayedAreas, rescale: rescale ?? undefined },
        context,
        {
          seriesInstanceUID: gspsSeriesFor(context.StudyInstanceUID),
          instanceNumber: ++instanceCounter,
          contentLabel: label,
          contentDescription: description ?? `RT Medical GSPS - ${toDa(new Date())}`,
        }
      );

      const dataSource =
        extensionManager.getActiveDataSources?.()?.[0] ?? extensionManager.getDataSources?.()?.[0];
      if (!dataSource?.store?.dicom) {
        notify('error', 'Presentation State', 'The active data source does not support STOW-RS.');
        return false;
      }
      try {
        await dataSource.store.dicom(dataset);
      } catch (e) {
        notify('error', 'Presentation State', 'Failed to store on the PACS (offline?). Try again.');
        return false;
      }
      // Invalidate cached study metadata so the new series shows after refresh.
      try {
        dataSource.deleteStudyMetadataPromise?.(context.StudyInstanceUID);
      } catch (e) {
        /* refresh hint only */
      }
      const annotationCount = graphicAnnotations.reduce(
        (sum, a) => sum + a.graphics.length + (a.texts?.length ?? 0),
        0
      );
      notify(
        'success',
        'Presentation State',
        annotationCount
          ? `Presentation state saved to the PACS (${annotationCount} annotation object(s)).`
          : 'Presentation state saved to the PACS (window/level only).'
      );
      return true;
    },

    /**
     * Apply a stored GSPS display set to the ACTIVE viewport: first VOI entry
     * → `viewport.setProperties({ voiRange })` + render. Annotation
     * re-hydration is the declared Phase 2 follow-up (see module doc).
     */
    applyGsps: ({ displaySetInstanceUID }: { displaySetInstanceUID?: string } = {}) => {
      // Without an explicit UID (toolbar button), apply the NEWEST GSPS
      // display set of the loaded study.
      const displaySet = displaySetInstanceUID
        ? displaySetService.getDisplaySetByUID?.(displaySetInstanceUID)
        : (displaySetService.getActiveDisplaySets?.() ?? [])
            .filter((ds: any) => ds?.gsps)
            .pop();
      const gsps: ParsedGsps | undefined = displaySet?.gsps;
      if (!gsps) {
        notify('error', 'Presentation State', 'No presentation state found to apply.');
        return false;
      }
      const { viewport } = getActiveViewport();
      if (!viewport) {
        notify('error', 'Presentation State', 'No active viewport to apply the state to.');
        return false;
      }
      const voi = gsps.voi?.[0];
      if (!voi) {
        notify('info', 'Presentation State', 'This presentation state carries no window/level.');
        return false;
      }
      // Inverse of the DICOM LINEAR convention used on save (C.11.2.1.2).
      const voiRange = {
        lower: voi.windowCenter - 0.5 - (voi.windowWidth - 1) / 2,
        upper: voi.windowCenter - 0.5 + (voi.windowWidth - 1) / 2,
      };
      try {
        viewport.setProperties({ voiRange });
        viewport.render();
      } catch (e) {
        notify('error', 'Presentation State', 'Failed to apply the window/level.');
        return false;
      }
      notify(
        'success',
        'Presentation State',
        `Applied "${gsps.contentLabel ?? 'presentation state'}" (window/level).`
      );
      return true;
    },
  };

  return {
    actions,
    definitions: {
      saveGsps: { commandFn: actions.saveGsps },
      applyGsps: { commandFn: actions.applyGsps },
    },
    defaultContext: 'CORNERSTONE',
  };
}

export default getCommandsModule;
