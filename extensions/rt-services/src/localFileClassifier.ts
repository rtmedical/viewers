/**
 * Local-file classification / partitioning for drag-drop ingestion (RTV-160).
 *
 * OHIF v3 already ingests local files natively (`platform/app/src/routes/Local/
 * filesToStudies` + `DicomLocalDataSource` + `pdfFileLoader` handle DICOM/PDF,
 * multi-file batches, SOP-class detection and progress). Re-porting the legacy
 * connectviewer loader would duplicate that, so this extension does NOT — it adds
 * the reusable, framework-free *classification/validation* layer the native
 * route does not expose, useful for validating a drag-drop set (e.g. RTVW)
 * before handing it to the native ingest pipeline.
 */

export type LocalFileKind = 'dicom' | 'pdf' | 'image' | 'unknown';

/** Minimal shape we need from a browser File (name + MIME type). */
export interface LocalFileLike {
  name?: string;
  type?: string;
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'tif', 'tiff']);
const DICOM_EXT = new Set(['dcm', 'dicom', 'ima', 'img']);

function extensionOf(name?: string): string {
  if (!name) return '';
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * Classify a single file by MIME type first, then extension. Extension-less
 * files are treated as DICOM (a common convention for DICOM Part-10 files).
 */
export function classifyFile(file: LocalFileLike): LocalFileKind {
  const type = (file?.type || '').toLowerCase();
  if (type === 'application/dicom') return 'dicom';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/')) return 'image';

  const ext = extensionOf(file?.name);
  if (ext === '') return 'dicom'; // extension-less → assume DICOM Part-10
  if (DICOM_EXT.has(ext)) return 'dicom';
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXT.has(ext)) return 'image';
  return 'unknown';
}

export interface LocalFilePartition<T extends LocalFileLike = LocalFileLike> {
  dicom: T[];
  pdf: T[];
  image: T[];
  unknown: T[];
  summary: {
    total: number;
    dicom: number;
    pdf: number;
    image: number;
    unknown: number;
    /** True when at least one file is ingestible by the native pipeline. */
    ingestible: boolean;
  };
}

/** Partition a list of files by {@link classifyFile}. */
export function partitionLocalFiles<T extends LocalFileLike>(files: T[]): LocalFilePartition<T> {
  const part: LocalFilePartition<T> = {
    dicom: [],
    pdf: [],
    image: [],
    unknown: [],
    summary: { total: 0, dicom: 0, pdf: 0, image: 0, unknown: 0, ingestible: false },
  };
  for (const file of files ?? []) {
    part[classifyFile(file)].push(file);
  }
  part.summary = {
    total: (files ?? []).length,
    dicom: part.dicom.length,
    pdf: part.pdf.length,
    image: part.image.length,
    unknown: part.unknown.length,
    ingestible: part.dicom.length + part.pdf.length > 0,
  };
  return part;
}

export default classifyFile;
