/**
 * De-identification commands (RTV-113). The de-id policy is the pure
 * {@link ./deidentify}; byte writing is {@link ./deidExport} (dcmjs).
 */
import { downloadDeidentified } from './deidExport';
import { DeidOptions } from './deidentify';

export function getCommandsModule() {
  const actions = {
    /**
     * De-identify a naturalized instance and download it as Part-10 DICOM.
     * Returns false if no instance was provided.
     */
    downloadDeidentifiedInstance: ({
      instance,
      filename,
      ...options
    }: { instance?: Record<string, any>; filename?: string } & DeidOptions = {}): boolean => {
      if (!instance) return false;
      downloadDeidentified(instance, { filename, ...options });
      return true;
    },
  };

  const definitions = {
    downloadDeidentifiedInstance: { commandFn: actions.downloadDeidentifiedInstance },
  };

  return { actions, definitions, defaultContext: 'DEFAULT' };
}

export default getCommandsModule;
