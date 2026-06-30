/**
 * getPanelModule (RTV-27 epic) — Advanced Measurements panel.
 * Opt in via '@ohif/extension-measurements.panelModule.measurements'.
 */
import React from 'react';
import MeasurementsPanel from './MeasurementsPanel';

interface PanelModuleParams {
  servicesManager?: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule(_params: PanelModuleParams) {
  return [
    {
      name: 'measurements',
      iconName: 'tab-studies',
      iconLabel: 'Measurements',
      label: 'Advanced Measurements',
      component: () => <MeasurementsPanel />,
    },
  ];
}

export default getPanelModule;
