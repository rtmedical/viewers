/**
 * Commands for the SR builders (RTV-36). Builder is pure
 * ({@link ./measurementSr}); byte writing is {@link ./srExport} (dcmjs).
 */
import { downloadMeasurementSr, MeasurementSrSerializeOptions, downloadCadRadsSr, CadRadsSrSerializeOptions } from './srExport';
import { SrMeasurement } from './measurementSr';
import { CadRadsAssessment } from './cadRadsSr';

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

    /** Build + download a TID 3000 CAD-RADS SR. */
    downloadCadRadsSr: ({
      assessment,
      filename,
      ...options
    }: { assessment?: CadRadsAssessment; filename?: string } & CadRadsSrSerializeOptions = {}): boolean => {
      if (!assessment?.category) return false;
      downloadCadRadsSr(assessment, { filename, ...options });
      return true;
    },
  };

  const definitions = {
    downloadMeasurementSr: { commandFn: actions.downloadMeasurementSr },
    downloadCadRadsSr: { commandFn: actions.downloadCadRadsSr },
  };

  return { actions, definitions, defaultContext: 'DEFAULT' };
}

export default getCommandsModule;
