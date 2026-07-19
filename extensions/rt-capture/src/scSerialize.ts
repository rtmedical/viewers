/**
 * DICOM byte-writing for Secondary Capture images (RTV-203) — the thin `dcmjs`
 * glue around the pure {@link ./scDataset} builder, mirroring the KOS
 * serializer in @ohif/extension-rtmedical-key-images.
 */
import dcmjs from 'dcmjs';
import {
  BuildScDatasetOptions,
  NaturalizedScDataset,
  ScPatientStudyContext,
  ScRgbImage,
  buildScNaturalizedDataset,
} from './scDataset';

const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1';
/** OHIF RT Medical implementation class UID root (org-private, illustrative). */
const IMPLEMENTATION_CLASS_UID = '1.2.826.0.1.3680043.10.999.1.1';

/** Format `Date` as DICOM DA (YYYYMMDD). */
export function toDa(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** Format `Date` as DICOM TM (HHMMSS). */
export function toTm(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** dcmjs UID factory. */
export function newUid(): string {
  return (dcmjs as any).data.DicomMetaDictionary.uid();
}

/**
 * Build the naturalized SC dataset with real (dcmjs) UIDs and a current
 * timestamp. Exposed so callers can STOW the naturalized form directly.
 */
export function buildScDatasetWithRealUids(
  image: ScRgbImage,
  context: ScPatientStudyContext,
  options: Omit<BuildScDatasetOptions, 'generateUID' | 'now'> & { now?: Date }
): NaturalizedScDataset {
  const now = options.now ?? new Date();
  return buildScNaturalizedDataset(image, context, {
    ...options,
    generateUID: newUid,
    now: { date: toDa(now), time: toTm(now) },
  });
}

/**
 * Serialize a naturalized SC dataset to a Part-10 DICOM file (Explicit VR
 * Little Endian) and return the raw `ArrayBuffer`.
 */
export function serializeScToArrayBuffer(dataset: NaturalizedScDataset): ArrayBuffer {
  const { DicomMetaDictionary, DicomDict } = (dcmjs as any).data;
  const meta = {
    MediaStorageSOPClassUID: dataset.SOPClassUID,
    MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
    TransferSyntaxUID: EXPLICIT_VR_LITTLE_ENDIAN,
    ImplementationClassUID: IMPLEMENTATION_CLASS_UID,
    ImplementationVersionName: 'RTMED_SC_1',
  };
  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
  return dicomDict.write();
}
