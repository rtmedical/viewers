/**
 * Commands for local-file drag-drop support (RTV-160).
 *
 * Framework-free: these commands classify/validate a dropped file set so a host
 * (a mode, a toolbar, or the RTVW desktop shell) can decide what to ingest. The
 * actual DICOM/PDF ingestion is OHIF v3's native pipeline
 * (`routes/Local/filesToStudies` + `DicomLocalDataSource`); this module does not
 * duplicate it. RTV-114: no `@ohif/core` import.
 */
import { partitionLocalFiles, LocalFileLike, LocalFilePartition } from './localFileClassifier';

export function getCommandsModule() {
  const actions = {
    /** Partition a dropped/selected file set by kind (dicom/pdf/image/unknown). */
    classifyLocalFiles: ({ files }: { files: LocalFileLike[] }): LocalFilePartition =>
      partitionLocalFiles(files ?? []),

    /**
     * Human-readable validation summary for a drag-drop set — e.g.
     * "12 DICOM, 1 PDF — 2 files ignored". Returns `null` for an empty set.
     */
    summarizeLocalFileDrop: ({ files }: { files: LocalFileLike[] }): string | null => {
      const { summary } = partitionLocalFiles(files ?? []);
      if (!summary.total) return null;
      // Only DICOM/PDF are ingestible by the native pipeline; images + unknown
      // are reported as ignored.
      const parts: string[] = [];
      if (summary.dicom) parts.push(`${summary.dicom} DICOM`);
      if (summary.pdf) parts.push(`${summary.pdf} PDF`);
      const ignored = summary.image + summary.unknown;
      const head = parts.length ? parts.join(', ') : 'no ingestible files';
      return ignored ? `${head} — ${ignored} ignored` : head;
    },
  };

  const definitions = {
    classifyLocalFiles: { commandFn: actions.classifyLocalFiles },
    summarizeLocalFileDrop: { commandFn: actions.summarizeLocalFileDrop },
  };

  return { actions, definitions, defaultContext: 'DEFAULT' };
}

export default getCommandsModule;
