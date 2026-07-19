/**
 * Build a naturalized DICOM **Secondary Capture Image** dataset (RTV-203).
 *
 * Deliberately framework-free and free of any `dcmjs` import: it produces a
 * plain *naturalized* dataset object (DICOM keyword -> value, the shape
 * `dcmjs.data.DicomMetaDictionary.denaturalizeDataset` consumes) so the whole
 * IOD-shaping step is pure and unit-testable — same split as the KOS builder
 * in @ohif/extension-rtmedical-key-images. The thin dcmjs byte writing wraps
 * this in {@link ./scSerialize}.
 *
 * Conforms to the Secondary Capture Image IOD (PS3.3 A.8) with an RGB
 * Image Pixel module (8-bit, SamplesPerPixel 3, PlanarConfiguration 0) —
 * exactly what a viewport screenshot is.
 */

/** Secondary Capture Image Storage. */
export const SC_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.7';

/** Series description grouping every capture of a study (ticket item 4). */
export const SC_SERIES_DESCRIPTION = 'RT Medical Captures';

/** High series number so the SC series never collides with acquired series. */
export const SC_SERIES_NUMBER = '9901';

/** Patient/Study identity to stamp on the generated SC (copied from source). */
export interface ScPatientStudyContext {
  PatientName?: unknown;
  PatientID?: string;
  PatientBirthDate?: string;
  PatientSex?: string;
  /** Study the SC is filed under — MUST be the source study to group in PACS. */
  StudyInstanceUID: string;
  StudyDate?: string;
  StudyTime?: string;
  AccessionNumber?: string;
  ReferringPhysicianName?: unknown;
  StudyID?: string;
}

/** A single-frame RGB image (already alpha-stripped) to embed. */
export interface ScRgbImage {
  rows: number;
  columns: number;
  /** Interleaved R,G,B bytes, length rows*columns*3 (pad handled here). */
  rgb: Uint8Array;
}

/** Reference to a source image shown in the captured viewport (optional). */
export interface ScSourceImageRef {
  ReferencedSOPClassUID: string;
  ReferencedSOPInstanceUID: string;
}

export interface BuildScDatasetOptions {
  /** UID factory (injected so this stays pure/testable). */
  generateUID: () => string;
  /** Series to file the capture under (one per study per session). */
  seriesInstanceUID: string;
  instanceNumber?: string | number;
  seriesDescription?: string;
  seriesNumber?: string | number;
  /** `{ date, time }` stamped on Content/Series date-time (DA/TM). */
  now?: { date?: string; time?: string };
  /** Free-text note; the ticket asks for "RT Medical SC - [date]". */
  imageComments?: string;
  /** Source images visible in the capture, for SourceImageSequence. */
  sourceImages?: ScSourceImageRef[];
}

/** A naturalized DICOM dataset (keyword -> value), as dcmjs consumes. */
export type NaturalizedScDataset = Record<string, unknown>;

/**
 * Strip the alpha channel from RGBA canvas pixels (`ctx.getImageData().data`)
 * into interleaved RGB bytes. Pure.
 */
export function rgbaToRgb(rgba: ArrayLike<number>): Uint8Array {
  const pixels = Math.floor(rgba.length / 4);
  const rgb = new Uint8Array(pixels * 3);
  for (let i = 0, o = 0; i < pixels; i++, o += 3) {
    const s = i * 4;
    rgb[o] = rgba[s];
    rgb[o + 1] = rgba[s + 1];
    rgb[o + 2] = rgba[s + 2];
  }
  return rgb;
}

/**
 * DICOM OB values must have even length — pad with one trailing zero byte if
 * needed and return an ArrayBuffer ready for PixelData. Pure.
 */
export function toEvenArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const even = bytes.length % 2 === 0 ? bytes : (() => {
    const padded = new Uint8Array(bytes.length + 1);
    padded.set(bytes);
    return padded;
  })();
  // Slice to a standalone ArrayBuffer of exactly the right size.
  return even.buffer.slice(even.byteOffset, even.byteOffset + even.byteLength);
}

/**
 * Build a naturalized Secondary Capture dataset from an RGB image + the source
 * study identity.
 *
 * @throws when the image is empty or the pixel buffer length mismatches.
 */
export function buildScNaturalizedDataset(
  image: ScRgbImage,
  context: ScPatientStudyContext,
  options: BuildScDatasetOptions
): NaturalizedScDataset {
  const { rows, columns, rgb } = image ?? ({} as ScRgbImage);
  if (!rows || !columns || !rgb?.length) {
    throw new Error('buildScNaturalizedDataset requires a non-empty RGB image');
  }
  if (rgb.length !== rows * columns * 3) {
    throw new Error(
      `RGB buffer length ${rgb.length} does not match rows*columns*3 = ${rows * columns * 3}`
    );
  }
  if (!context?.StudyInstanceUID) {
    throw new Error('buildScNaturalizedDataset requires the source StudyInstanceUID');
  }
  const { generateUID, seriesInstanceUID } = options;
  if (typeof generateUID !== 'function' || !seriesInstanceUID) {
    throw new Error('buildScNaturalizedDataset requires generateUID and seriesInstanceUID');
  }

  const date = options.now?.date ?? '';
  const time = options.now?.time ?? '';

  const dataset: NaturalizedScDataset = {
    // SOP Common
    SOPClassUID: SC_SOP_CLASS_UID,
    SOPInstanceUID: generateUID(),
    SpecificCharacterSet: 'ISO_IR 192',
    // Patient + General Study — copied so the SC files under the SOURCE study.
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
    // General Series — dedicated capture series (ticket item 4).
    Modality: 'OT',
    SeriesInstanceUID: seriesInstanceUID,
    SeriesNumber: String(options.seriesNumber ?? SC_SERIES_NUMBER),
    SeriesDescription: options.seriesDescription ?? SC_SERIES_DESCRIPTION,
    SeriesDate: date,
    SeriesTime: time,
    // SC Equipment (PS3.3 C.8.6.1)
    ConversionType: 'WSD',
    SecondaryCaptureDeviceManufacturer: 'RT Medical',
    SecondaryCaptureDeviceManufacturerModelName: 'RT Medical Viewer',
    // General Image
    InstanceNumber: String(options.instanceNumber ?? '1'),
    ImageType: ['DERIVED', 'SECONDARY'],
    ContentDate: date,
    ContentTime: time,
    BurnedInAnnotation: 'YES',
    // Image Pixel — 8-bit interleaved RGB
    SamplesPerPixel: 3,
    PhotometricInterpretation: 'RGB',
    PlanarConfiguration: 0,
    Rows: rows,
    Columns: columns,
    BitsAllocated: 8,
    BitsStored: 8,
    HighBit: 7,
    PixelRepresentation: 0,
    PixelData: toEvenArrayBuffer(rgb),
    // dcmjs cannot infer PixelData's VR from a naturalized dataset (it logs
    // an error and guesses OW); 8-bit data is OB — declare it explicitly.
    _vrMap: { PixelData: 'OB' },
  };

  if (options.imageComments) {
    dataset.ImageComments = options.imageComments;
  }
  const sourceImages = (options.sourceImages ?? []).filter(
    r => r?.ReferencedSOPClassUID && r?.ReferencedSOPInstanceUID
  );
  if (sourceImages.length) {
    dataset.SourceImageSequence = sourceImages.map(r => ({
      ReferencedSOPClassUID: r.ReferencedSOPClassUID,
      ReferencedSOPInstanceUID: r.ReferencedSOPInstanceUID,
    }));
  }
  return dataset;
}
