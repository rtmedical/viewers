/**
 * Build a naturalized DICOM **Grayscale Softcopy Presentation State** (GSPS)
 * dataset (RTV-200, Phase 1).
 *
 * Deliberately framework-free and free of any `dcmjs` import: it produces a
 * plain *naturalized* dataset object (DICOM keyword -> value, the shape
 * `dcmjs.data.DicomMetaDictionary.denaturalizeDataset` consumes) so the whole
 * IOD-shaping step is pure and unit-testable — same split as the SC builder in
 * @ohif/extension-rt-capture and the KOS builder in
 * @ohif/extension-rtmedical-key-images. The thin dcmjs byte writing wraps this
 * in {@link ./gspsSerialize}.
 *
 * Conforms to the Grayscale Softcopy Presentation State IOD (PS3.3 A.33):
 * Presentation State Identification + Relationship, Displayed Area, Softcopy
 * VOI LUT, Graphic Annotation/Layer and Softcopy Presentation LUT modules.
 */

/** Grayscale Softcopy Presentation State Storage. */
export const GSPS_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.11.1';

/** Series description grouping every presentation state of a study. */
export const GSPS_SERIES_DESCRIPTION = 'RT Medical Presentation States';

/** High series number so the PR series never collides with acquired series. */
export const GSPS_SERIES_NUMBER = '9902';

/** Single graphic layer every RT Medical annotation is filed under. */
export const GSPS_GRAPHIC_LAYER = 'RTMEDICAL';

/** ContentLabel is CS: uppercase A-Z 0-9 _ , at most 16 chars here. */
export const GSPS_CONTENT_LABEL_MAX_LENGTH = 16;

/** Fallback ContentLabel when the user label sanitizes to nothing. */
export const GSPS_DEFAULT_CONTENT_LABEL = 'RTMEDICAL';

/** Patient/Study identity to stamp on the GSPS (copied from source study). */
export interface GspsPatientStudyContext {
  PatientName?: unknown;
  PatientID?: string;
  PatientBirthDate?: string;
  PatientSex?: string;
  /** Study the GSPS is filed under — MUST be the source study to group in PACS. */
  StudyInstanceUID: string;
  StudyDate?: string;
  StudyTime?: string;
  AccessionNumber?: string;
  ReferringPhysicianName?: unknown;
  StudyID?: string;
}

/** Reference to one source image the presentation state applies to. */
export interface GspsImageRef {
  ReferencedSOPClassUID: string;
  ReferencedSOPInstanceUID: string;
}

/** One referenced series with the images the presentation state applies to. */
export interface GspsSeriesRef {
  SeriesInstanceUID: string;
  images: GspsImageRef[];
}

/** One VOI (window) entry; applies to `images` or to every reference. */
export interface GspsVoi {
  windowCenter: number;
  windowWidth: number;
  /** Subset of images this window applies to; defaults to all references. */
  images?: GspsImageRef[];
}

/** GSPS graphic types this builder emits (PS3.3 C.10.5 GraphicType). */
export type GspsGraphicType = 'POINT' | 'POLYLINE' | 'INTERPOLATED' | 'CIRCLE' | 'ELLIPSE';

/** One graphic object, already converted to PIXEL (column,row) coordinates. */
export interface GspsGraphicObject {
  graphicType: GspsGraphicType;
  /** Ordered [column, row] pairs in DICOM PIXEL units (TLHC pixel center = 0.5,0.5). */
  points: [number, number][];
  filled?: boolean;
}

/** One text object anchored at a PIXEL coordinate (annotation labels). */
export interface GspsTextObject {
  anchorPoint: [number, number];
  text: string;
}

/** Graphics/texts that apply to one set of referenced images (one layer item). */
export interface GspsGraphicAnnotation {
  images: GspsImageRef[];
  graphics: GspsGraphicObject[];
  texts?: GspsTextObject[];
}

/** Displayed area (full image, SCALE TO FIT) for one set of referenced images. */
export interface GspsDisplayedArea {
  images: GspsImageRef[];
  columns: number;
  rows: number;
}

/** Everything the presentation state captures (the "what to persist" input). */
/** Modality LUT (PS3.3 C.11.1) copied from the referenced series (B1). */
export interface GspsRescale {
  intercept: number;
  slope: number;
  type?: string;
}

export interface GspsInput {
  /**
   * Rescale of the referenced images. REQUIRED whenever the source images
   * carry RescaleIntercept/Slope: the GSPS grayscale pipeline REPLACES the
   * image's (PS3.4 N.2.3) — omitting it makes conformant viewers apply the
   * (post-rescale) window to STORED values.
   */
  rescale?: GspsRescale;
  /** Images the state applies to, grouped by series. At least one required. */
  referencedSeries: GspsSeriesRef[];
  /** Window/level entries (Softcopy VOI LUT). Optional (annotations-only GSPS). */
  voi?: GspsVoi[];
  /** Graphic annotations (already in PIXEL units). Optional (W/L-only GSPS). */
  graphicAnnotations?: GspsGraphicAnnotation[];
  /** Displayed Area entries; the command supplies one per referenced series. */
  displayedAreas?: GspsDisplayedArea[];
}

export interface BuildGspsDatasetOptions {
  /** UID factory (injected so this stays pure/testable). */
  generateUID: () => string;
  /** Series to file the presentation state under (one per study per session). */
  seriesInstanceUID: string;
  /** User label; sanitized to CS (A-Z 0-9 _, max 16) for ContentLabel. */
  contentLabel?: string;
  /** Free-text ContentDescription (LO, max 64 — truncated here). */
  contentDescription?: string;
  instanceNumber?: string | number;
  seriesDescription?: string;
  seriesNumber?: string | number;
  /** `{ date, time }` stamped on PresentationCreation/Series date-time (DA/TM). */
  now?: { date?: string; time?: string };
}

/** A naturalized DICOM dataset (keyword -> value), as dcmjs consumes. */
export type NaturalizedGspsDataset = Record<string, unknown>;

/**
 * Sanitize a free-text label into a ContentLabel-safe CS value: uppercase,
 * every run of characters outside A-Z/0-9/_ collapsed to a single `_`,
 * trimmed and truncated to {@link GSPS_CONTENT_LABEL_MAX_LENGTH}. Falls back
 * to {@link GSPS_DEFAULT_CONTENT_LABEL} when nothing survives. Pure.
 */
export function sanitizeContentLabel(label: unknown): string {
  const collapsed = String(label ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_');
  // Underscore trimming is done with index scans: the previous regexes
  // (/^_+|_+$/ and /_+$/) backtrack polynomially on long '_' runs
  // (CodeQL js/polynomial-redos — same class as the PR #88 URL fix).
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed.charCodeAt(start) === 95 /* '_' */) {
    start++;
  }
  while (end > start && collapsed.charCodeAt(end - 1) === 95) {
    end--;
  }
  let cut = Math.min(end, start + GSPS_CONTENT_LABEL_MAX_LENGTH);
  while (cut > start && collapsed.charCodeAt(cut - 1) === 95) {
    cut--;
  }
  const sanitized = collapsed.slice(start, cut);
  return sanitized || GSPS_DEFAULT_CONTENT_LABEL;
}

/** Keep only refs with both UIDs, mapped to a ReferencedImageSequence item. */
function toReferencedImageSequence(images: GspsImageRef[] | undefined): Record<string, string>[] {
  return (images ?? [])
    .filter(r => r?.ReferencedSOPClassUID && r?.ReferencedSOPInstanceUID)
    .map(r => ({
      ReferencedSOPClassUID: r.ReferencedSOPClassUID,
      ReferencedSOPInstanceUID: r.ReferencedSOPInstanceUID,
    }));
}

/**
 * Build a naturalized GSPS dataset from the captured presentation input + the
 * source study identity.
 *
 * @throws when no referenced image survives filtering (a GSPS that references
 *   nothing is meaningless) or when the source StudyInstanceUID is missing.
 */
export function buildGspsNaturalizedDataset(
  input: GspsInput,
  context: GspsPatientStudyContext,
  options: BuildGspsDatasetOptions
): NaturalizedGspsDataset {
  const referencedSeries = (input?.referencedSeries ?? [])
    .map(series => ({
      SeriesInstanceUID: series?.SeriesInstanceUID,
      images: toReferencedImageSequence(series?.images),
    }))
    .filter(series => series.SeriesInstanceUID && series.images.length);
  if (!referencedSeries.length) {
    throw new Error('buildGspsNaturalizedDataset requires at least one referenced image');
  }
  if (!context?.StudyInstanceUID) {
    throw new Error('buildGspsNaturalizedDataset requires the source StudyInstanceUID');
  }
  const { generateUID, seriesInstanceUID } = options ?? ({} as BuildGspsDatasetOptions);
  if (typeof generateUID !== 'function' || !seriesInstanceUID) {
    throw new Error('buildGspsNaturalizedDataset requires generateUID and seriesInstanceUID');
  }

  const date = options.now?.date ?? '';
  const time = options.now?.time ?? '';
  const allImages = referencedSeries.flatMap(series => series.images);

  const dataset: NaturalizedGspsDataset = {
    // SOP Common
    SOPClassUID: GSPS_SOP_CLASS_UID,
    SOPInstanceUID: generateUID(),
    SpecificCharacterSet: 'ISO_IR 192',
    // Patient + General Study — copied so the GSPS files under the SOURCE study.
    PatientName: context.PatientName ?? '',
    PatientID: context.PatientID ?? '',
    PatientBirthDate: context.PatientBirthDate ?? '',
    PatientSex: context.PatientSex ?? '',
    StudyInstanceUID: context.StudyInstanceUID,
    StudyDate: context.StudyDate ?? '',
    StudyTime: context.StudyTime ?? '',
    AccessionNumber: context.AccessionNumber ?? '',
    ReferringPhysicianName: context.ReferringPhysicianName ?? '',
    StudyID: context.StudyID ?? '',
    // Presentation Series (PS3.3 C.11.9) — dedicated PR series.
    Modality: 'PR',
    SeriesInstanceUID: seriesInstanceUID,
    SeriesNumber: String(options.seriesNumber ?? GSPS_SERIES_NUMBER),
    SeriesDescription: options.seriesDescription ?? GSPS_SERIES_DESCRIPTION,
    SeriesDate: date,
    SeriesTime: time,
    // General Equipment
    Manufacturer: 'RT Medical',
    ManufacturerModelName: 'RT Medical Viewer',
    // Presentation State Identification (PS3.3 C.11.10)
    ContentLabel: sanitizeContentLabel(options.contentLabel),
    ContentDescription: String(options.contentDescription ?? '').slice(0, 64),
    ContentCreatorName: 'RT Medical Viewer',
    PresentationCreationDate: date,
    PresentationCreationTime: time,
    InstanceNumber: String(options.instanceNumber ?? '1'),
    // Presentation State Relationship (PS3.3 C.11.11)
    ReferencedSeriesSequence: referencedSeries.map(series => ({
      SeriesInstanceUID: series.SeriesInstanceUID,
      ReferencedImageSequence: series.images,
    })),
    // Softcopy Presentation LUT (PS3.3 C.11.6) — no LUT transform in Phase 1.
    PresentationLUTShape: 'IDENTITY',
  };

  // Modality LUT (PS3.3 C.11.1): the GSPS pipeline replaces the image's, so
  // the source rescale must ride along or WC/WW (post-rescale units, e.g. HU)
  // would be applied to stored values by conformant consumers.
  if (input.rescale && Number.isFinite(input.rescale.intercept) && Number.isFinite(input.rescale.slope)) {
    dataset.RescaleIntercept = input.rescale.intercept;
    dataset.RescaleSlope = input.rescale.slope;
    dataset.RescaleType = input.rescale.type ?? 'US';
  }

  // Displayed Area (PS3.3 C.10.4) — whole image, scaled to fit.
  const displayedAreas = (input.displayedAreas ?? [])
    .map(area => ({
      images: toReferencedImageSequence(area?.images),
      columns: Number(area?.columns),
      rows: Number(area?.rows),
    }))
    .filter(area => area.images.length && area.columns > 0 && area.rows > 0);
  if (!displayedAreas.length) {
    // Type M module (PS3.3 A.33.1) — a GSPS without it is non-conformant.
    throw new Error('buildGspsNaturalizedDataset requires at least one displayed area');
  }
  {
    dataset.DisplayedAreaSelectionSequence = displayedAreas.map(area => ({
      ReferencedImageSequence: area.images,
      DisplayedAreaTopLeftHandCorner: [1, 1],
      DisplayedAreaBottomRightHandCorner: [area.columns, area.rows],
      PresentationSizeMode: 'SCALE TO FIT',
    }));
  }

  // Softcopy VOI LUT (PS3.3 C.11.8) — the persisted window/level.
  const voiEntries = (input.voi ?? []).filter(
    voi => Number.isFinite(voi?.windowCenter) && Number.isFinite(voi?.windowWidth)
  );
  if (voiEntries.length) {
    dataset.SoftcopyVOILUTSequence = voiEntries.map(voi => {
      const images = toReferencedImageSequence(voi.images);
      return {
        ReferencedImageSequence: images.length ? images : allImages,
        WindowCenter: voi.windowCenter,
        WindowWidth: voi.windowWidth,
      };
    });
  }

  // Graphic Layer + Graphic Annotation (PS3.3 C.10.7 / C.10.5).
  const graphicAnnotations = (input.graphicAnnotations ?? [])
    .map(annotation => ({
      images: toReferencedImageSequence(annotation?.images),
      graphics: (annotation?.graphics ?? []).filter(g => g?.points?.length),
      texts: (annotation?.texts ?? []).filter(t => t?.text && t?.anchorPoint?.length === 2),
    }))
    .filter(a => a.images.length && (a.graphics.length || a.texts.length));
  if (graphicAnnotations.length) {
    dataset.GraphicLayerSequence = [
      {
        GraphicLayer: GSPS_GRAPHIC_LAYER,
        GraphicLayerOrder: 1,
        GraphicLayerDescription: 'RT Medical viewer annotations',
      },
    ];
    dataset.GraphicAnnotationSequence = graphicAnnotations.map(annotation => {
      const item: Record<string, unknown> = {
        GraphicLayer: GSPS_GRAPHIC_LAYER,
        ReferencedImageSequence: annotation.images,
      };
      if (annotation.graphics.length) {
        item.GraphicObjectSequence = annotation.graphics.map(graphic => {
          const obj: Record<string, unknown> = {
            GraphicAnnotationUnits: 'PIXEL',
            GraphicDimensions: 2,
            NumberOfGraphicPoints: graphic.points.length,
            // GraphicData is the flat [col, row, col, row, ...] float list.
            GraphicData: graphic.points.flatMap(([column, row]) => [column, row]),
            GraphicType: graphic.graphicType,
          };
          // GraphicFilled is Type 1C — closed geometry only (PS3.3 C.10.5).
          const first = graphic.points[0];
          const last = graphic.points[graphic.points.length - 1];
          const closedPolyline =
            graphic.graphicType === 'POLYLINE' &&
            graphic.points.length > 2 &&
            first[0] === last[0] &&
            first[1] === last[1];
          if (graphic.graphicType === 'CIRCLE' || graphic.graphicType === 'ELLIPSE' || closedPolyline) {
            obj.GraphicFilled = graphic.filled ? 'Y' : 'N';
          }
          return obj;
        });
      }
      if (annotation.texts.length) {
        item.TextObjectSequence = annotation.texts.map(text => ({
          AnchorPoint: [text.anchorPoint[0], text.anchorPoint[1]],
          AnchorPointAnnotationUnits: 'PIXEL',
          UnformattedTextValue: String(text.text).slice(0, 1024),
          AnchorPointVisibility: 'Y',
        }));
      }
      return item;
    });
  }

  return dataset;
}
