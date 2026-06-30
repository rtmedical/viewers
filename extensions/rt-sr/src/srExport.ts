/**
 * dcmjs glue for the SR builders (RTV-36): serialize a built SR dataset to a
 * Part-10 file. Mirrors the KOS / Mammography-CAD-SR exporters. STOW-RS push to
 * PACS is a separate backend ticket (RTV-39).
 */
import dcmjs from 'dcmjs';
import {
  buildMeasurementSr,
  BuildMeasurementSrOptions,
  SrMeasurement,
  COMPREHENSIVE_SR_SOP_CLASS_UID,
} from './measurementSr';

const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1';
const IMPLEMENTATION_CLASS_UID = '1.2.826.0.1.3680043.10.999.1.4';

function toDa(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
function toTm(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Serialize a naturalized SR dataset to a Part-10 ArrayBuffer. */
export function serializeSrToArrayBuffer(dataset: Record<string, any>): ArrayBuffer {
  const { DicomMetaDictionary, DicomDict } = (dcmjs as any).data;
  const meta = {
    MediaStorageSOPClassUID: dataset.SOPClassUID,
    MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
    TransferSyntaxUID: EXPLICIT_VR_LITTLE_ENDIAN,
    ImplementationClassUID: IMPLEMENTATION_CLASS_UID,
    ImplementationVersionName: 'RTMED_SR_1',
  };
  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
  return dicomDict.write();
}

export type MeasurementSrSerializeOptions = Omit<BuildMeasurementSrOptions, 'generateUID' | 'now'>;

/** Build a TID 1500 SR (real UIDs + timestamp) and serialize to Part-10. */
export function serializeMeasurementSr(
  measurements: SrMeasurement[],
  options: MeasurementSrSerializeOptions = {}
): ArrayBuffer {
  const { DicomMetaDictionary } = (dcmjs as any).data;
  const now = new Date();
  const dataset = buildMeasurementSr(measurements, {
    generateUID: () => DicomMetaDictionary.uid(),
    now: { date: toDa(now), time: toTm(now) },
    ...options,
  });
  return serializeSrToArrayBuffer(dataset);
}

/** Build + download a TID 1500 measurement SR. No-op outside a DOM. */
export function downloadMeasurementSr(
  measurements: SrMeasurement[],
  options: MeasurementSrSerializeOptions & { filename?: string } = {}
): ArrayBuffer {
  const { filename, ...rest } = options;
  const buffer = serializeMeasurementSr(measurements, rest);
  if (typeof document !== 'undefined' && typeof URL?.createObjectURL === 'function') {
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/dicom' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? 'measurement-sr.dcm';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  return buffer;
}

export { COMPREHENSIVE_SR_SOP_CLASS_UID };
export default serializeMeasurementSr;
