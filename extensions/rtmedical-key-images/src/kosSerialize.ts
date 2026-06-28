/**
 * DICOM byte-writing for KOS documents (RTV-148) — the thin `dcmjs` glue around
 * the pure {@link ./kosDataset} builder. The IOD shaping lives in the (pure,
 * unit-tested) builder; this module only turns a descriptor into Part-10 bytes,
 * mirroring how the native OHIF extensions use `dcmjs`.
 */
import dcmjs from 'dcmjs';
import { KosDescriptor } from './kos';
import {
  buildKosNaturalizedDataset,
  KosPatientStudyContext,
  NaturalizedKosDataset,
} from './kosDataset';

const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1';
/** OHIF RT Medical implementation class UID root (org-private, illustrative). */
const IMPLEMENTATION_CLASS_UID = '1.2.826.0.1.3680043.10.999.1.1';

export interface SerializeKosOptions extends KosPatientStudyContext {
  description?: string;
  seriesNumber?: string | number;
  instanceNumber?: string | number;
}

/** Format `Date` as DICOM DA (YYYYMMDD). */
function toDa(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** Format `Date` as DICOM TM (HHMMSS). */
function toTm(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Build the naturalized KOS dataset with real (dcmjs) UIDs and a current
 * timestamp. Exposed for callers that want the dataset before writing bytes.
 */
export function buildKosDatasetWithRealUids(
  descriptor: KosDescriptor,
  options: SerializeKosOptions = {}
): NaturalizedKosDataset {
  const { DicomMetaDictionary } = (dcmjs as any).data;
  const now = new Date();
  return buildKosNaturalizedDataset(descriptor, {
    generateUID: () => DicomMetaDictionary.uid(),
    now: { date: toDa(now), time: toTm(now) },
    ...options,
  });
}

/**
 * Serialize a KOS descriptor to a Part-10 DICOM file (Explicit VR Little
 * Endian) and return the raw `ArrayBuffer`.
 */
export function serializeKosToArrayBuffer(
  descriptor: KosDescriptor,
  options: SerializeKosOptions = {}
): ArrayBuffer {
  const { DicomMetaDictionary, DicomDict } = (dcmjs as any).data;

  const dataset = buildKosDatasetWithRealUids(descriptor, options);

  const meta = {
    MediaStorageSOPClassUID: dataset.SOPClassUID,
    MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
    TransferSyntaxUID: EXPLICIT_VR_LITTLE_ENDIAN,
    ImplementationClassUID: IMPLEMENTATION_CLASS_UID,
    ImplementationVersionName: 'RTMED_KOS_1',
  };

  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
  return dicomDict.write();
}

/**
 * Serialize a KOS descriptor and trigger a browser download. No-op outside a
 * DOM environment (returns the buffer so callers can still persist it).
 */
export function downloadKosDocument(
  descriptor: KosDescriptor,
  options: SerializeKosOptions & { filename?: string } = {}
): ArrayBuffer {
  const { filename, ...serializeOptions } = options;
  const buffer = serializeKosToArrayBuffer(descriptor, serializeOptions);

  if (typeof document !== 'undefined' && typeof URL?.createObjectURL === 'function') {
    const blob = new Blob([buffer], { type: 'application/dicom' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename ?? 'key-object-selection.dcm';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  return buffer;
}

export default serializeKosToArrayBuffer;
