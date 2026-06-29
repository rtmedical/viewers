/**
 * getCustomizationModule (RTV-78) — exposes BI-RADS finding labels as
 * `measurementLabels` so mammography annotation tools can categorize markings
 * with ACR BI-RADS terms. Framework-free (no `@ohif/core`); data-only.
 *
 * Wiring these labels into a specific mode's labelling flow is a mode-config
 * follow-up; the catalogue itself lives here (pure, tested in birads.test).
 */
import { BIRADS_MEASUREMENT_LABELS } from './birads';

export function getCustomizationModule() {
  return [
    {
      name: 'biradsMeasurementLabels',
      value: {
        measurementLabels: {
          labels: BIRADS_MEASUREMENT_LABELS,
        },
      },
    },
  ];
}

export default getCustomizationModule;
