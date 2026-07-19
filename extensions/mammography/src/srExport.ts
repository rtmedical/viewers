/**
 * dcmjs glue for BI-RADS SR export (RTV-37): build a Mammography CAD SR from a
 * BI-RADS assessment ({@link ./mammographyCadSr}) and write a Part-10 file.
 * Mirrors `@ohif/extension-rtmedical-key-images` kosSerialize. STOW-RS export to
 * PACS is a separate backend ticket (RTV-39).
 */
import dcmjs from 'dcmjs';
import { BiradsAssessment } from './birads';
import { buildMammographyCadSr, BuildSrOptions, MAMMO_CAD_SR_SOP_CLASS_UID } from './mammographyCadSr';

const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1';
const IMPLEMENTATION_CLASS_UID = '1.2.826.0.1.3680043.10.999.1.3';

function toDa(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
function toTm(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export type SrSerializeOptions = Omit<BuildSrOptions, 'generateUID' | 'now'>;

/** Build a Mammography CAD SR (real UIDs + timestamp) and serialize to Part-10. */
export function serializeBiradsSrToArrayBuffer(
  assessment: BiradsAssessment,
  options: SrSerializeOptions = {}
): ArrayBuffer {
  const { DicomMetaDictionary, DicomDict } = (dcmjs as any).data;
  const now = new Date();
  const dataset = buildMammographyCadSr(assessment, {
    generateUID: () => DicomMetaDictionary.uid(),
    now: { date: toDa(now), time: toTm(now) },
    ...options,
  });

  const meta = {
    MediaStorageSOPClassUID: MAMMO_CAD_SR_SOP_CLASS_UID,
    MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
    TransferSyntaxUID: EXPLICIT_VR_LITTLE_ENDIAN,
    ImplementationClassUID: IMPLEMENTATION_CLASS_UID,
    ImplementationVersionName: 'RTMED_SR_1',
  };
  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
  return dicomDict.write();
}

/** Build + download the BI-RADS SR. No-op outside a DOM. */
export function downloadBiradsSr(
  assessment: BiradsAssessment,
  options: SrSerializeOptions & { filename?: string } = {}
): ArrayBuffer {
  const { filename, ...rest } = options;
  const buffer = serializeBiradsSrToArrayBuffer(assessment, rest);
  if (typeof document !== 'undefined' && typeof URL?.createObjectURL === 'function') {
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/dicom' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? 'birads-sr.dcm';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  return buffer;
}

export default serializeBiradsSrToArrayBuffer;
