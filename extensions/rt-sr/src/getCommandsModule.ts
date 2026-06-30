/**
 * Commands for the SR builders (RTV-36). Builder is pure
 * ({@link ./measurementSr}); byte writing is {@link ./srExport} (dcmjs).
 */
import { downloadMeasurementSr, MeasurementSrSerializeOptions } from './srExport';
import { SrMeasurement } from './measurementSr';

export function getCommandsModule() {
  const actions = {
    /** Build + download a TID 1500 measurement-report SR. */
    downloadMeasurementSr: ({
      measurements,
      filename,
      ...options
    }: { measurements?: SrMeasurement[]; filename?: string } & MeasurementSrSerializeOptions = {}): boolean => {
      if (!measurements?.length) return false;
      downloadMeasurementSr(measurements, { filename, ...options });
      return true;
    },
  };

  const definitions = {
    downloadMeasurementSr: { commandFn: actions.downloadMeasurementSr },
  };

  return { actions, definitions, defaultContext: 'DEFAULT' };
}

export default getCommandsModule;
