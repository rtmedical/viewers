/**
 * getPanelModule (RTV-113) — De-identification panel.
 * Opt in via '@ohif/extension-deid.panelModule.deid' in rightPanels.
 */
import React from 'react';
import DeidPanel from './DeidPanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager }: PanelModuleParams) {
  return [
    {
      name: 'deid',
      iconName: 'tab-studies',
      iconLabel: 'De-identify',
      label: 'De-identification',
      component: (props: Record<string, unknown>) => (
        <DeidPanel {...props} servicesManager={servicesManager} />
      ),
    },
  ];
}

export default getPanelModule;
