/**
 * Commands for the mammography extension (RTV-37): export a BI-RADS assessment
 * as a Mammography CAD SR (TID 2000). Builder is pure ({@link ./mammographyCadSr});
 * byte writing is {@link ./srExport} (dcmjs).
 */
import { downloadBiradsSr, SrSerializeOptions } from './srExport';
import { BiradsAssessment } from './birads';

export function getCommandsModule() {
  const actions = {
    /** Build + download a Mammography CAD SR for a BI-RADS assessment. */
    downloadBiradsSr: ({
      assessment,
      filename,
      ...options
    }: { assessment?: BiradsAssessment; filename?: string } & SrSerializeOptions = {}): boolean => {
      if (!assessment) return false;
      downloadBiradsSr(assessment, { filename, ...options });
      return true;
    },
  };

  const definitions = {
    downloadBiradsSr: { commandFn: actions.downloadBiradsSr },
  };

  return { actions, definitions, defaultContext: 'DEFAULT' };
}

export default getCommandsModule;
