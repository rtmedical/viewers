/**
 * dcmjs glue for de-identification (RTV-113): de-identify a naturalized dataset
 * and write a Part-10 DICOM file. The de-id policy/logic is the pure
 * {@link ./deidentify}; this only does the byte writing (mirrors
 * `@ohif/extension-rtmedical-key-images` kosSerialize).
 */
import dcmjs from 'dcmjs';
import { deidentify, DeidOptions } from './deidentify';

const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1';
const IMPLEMENTATION_CLASS_UID = '1.2.826.0.1.3680043.10.999.1.2';

/** Build a consistent UID remapper (same input UID → same new UID). */
export function makeUidRemapper(): (uid: string) => string {
  const { DicomMetaDictionary } = (dcmjs as any).data;
  const map = new Map<string, string>();
  return (uid: string) => {
    if (!map.has(uid)) map.set(uid, DicomMetaDictionary.uid());
    return map.get(uid)!;
  };
}

/**
 * De-identify a naturalized dataset and serialize to a Part-10 ArrayBuffer.
 * When `retainUids` is false and no `remapUid` is supplied, a consistent
 * remapper is created automatically.
 */
export function deidentifyToArrayBuffer(
  dataset: Record<string, any>,
  options: DeidOptions = {}
): ArrayBuffer {
  const { DicomMetaDictionary, DicomDict } = (dcmjs as any).data;
  const opts: DeidOptions =
    options.retainUids === false && !options.remapUid ? { ...options, remapUid: makeUidRemapper() } : options;

  const clean = deidentify(dataset, opts);

  const meta = {
    MediaStorageSOPClassUID: clean.SOPClassUID,
    MediaStorageSOPInstanceUID: clean.SOPInstanceUID,
    TransferSyntaxUID: EXPLICIT_VR_LITTLE_ENDIAN,
    ImplementationClassUID: IMPLEMENTATION_CLASS_UID,
    ImplementationVersionName: 'RTMED_DEID_1',
  };
  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(clean);
  return dicomDict.write();
}

/** De-identify + trigger a browser download. No-op outside a DOM. */
export function downloadDeidentified(
  dataset: Record<string, any>,
  options: DeidOptions & { filename?: string } = {}
): ArrayBuffer {
  const { filename, ...deidOptions } = options;
  const buffer = deidentifyToArrayBuffer(dataset, deidOptions);
  if (typeof document !== 'undefined' && typeof URL?.createObjectURL === 'function') {
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/dicom' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? 'deidentified.dcm';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  return buffer;
}

export default deidentifyToArrayBuffer;
