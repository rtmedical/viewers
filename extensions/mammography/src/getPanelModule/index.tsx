/**
 * getPanelModule (RTV-78) — BI-RADS form panel.
 * Opt in via '@ohif/extension-mammography.panelModule.birads' in rightPanels.
 */
import React from 'react';
import BiradsPanel from './BiradsPanel';

interface PanelModuleParams {
  servicesManager?: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule(params: PanelModuleParams) {
  return [
    {
      name: 'birads',
      iconName: 'tab-studies',
      iconLabel: 'BI-RADS',
      label: 'BI-RADS',
      component: () => <BiradsPanel commandsManager={params?.commandsManager} />,
    },
  ];
}

export default getPanelModule;
