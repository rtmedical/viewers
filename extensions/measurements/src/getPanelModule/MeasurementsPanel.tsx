/**
 * Advanced Measurements right-panel (RTV-27 epic): lists the available pure
 * calculators (HU stats, SUVbw, Cobb angle, Agatston) and their status.
 *
 * The calculators are pure ({@link ../measurements}) and exposed as commands;
 * capturing the ROI pixels / line annotations / lesion masks from the cornerstone
 * viewport to feed them is an integration follow-up. RTV-114: `@ohif/ui-next` only.
 */
import React from 'react';

const TOOLS = [
  { name: 'HU statistics', detail: 'min/max/mean/SD over a CT ROI', cmd: 'computeHuStats', ticket: 'RTV-28' },
  { name: 'SUVbw', detail: 'PET SUVbw (peak/max/mean) with decay correction', cmd: 'computeSuvBw', ticket: 'RTV-29' },
  { name: 'Cobb angle', detail: 'angle between two lines (scoliosis)', cmd: 'computeCobbAngle', ticket: 'RTV-30' },
  { name: 'Agatston score', detail: 'calcium score Σ(area × HU weight)', cmd: 'computeAgatston', ticket: 'RTV-46' },
];

export function MeasurementsPanel(): React.ReactElement {
  return (
    <div className="ohif-scrollbar flex h-full flex-col overflow-auto px-2 py-2 text-sm text-white" data-cy="measurements-panel">
      <span className="mb-2 text-base font-medium">Advanced Measurements</span>
      <table className="w-full border-collapse">
        <tbody>
          {TOOLS.map(t => (
            <tr key={t.cmd} className="border-t border-white/10">
              <td className="py-1">
                <div>{t.name}</div>
                <div className="text-muted-foreground text-xs">{t.detail}</div>
              </td>
              <td className="text-right align-top text-xs text-[#c6c6c6]">{t.ticket}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground mt-2 text-xs">
        Calculators are available as commands (pure + unit-tested). Capturing the
        ROI / line / lesions from the viewport to feed them is an integration
        follow-up.
      </p>
    </div>
  );
}

export default MeasurementsPanel;
