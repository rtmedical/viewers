/**
 * getPanelModule (RTV-197) — Fusion config panel.
 * Opt in via '@ohif/extension-rt-fusion.panelModule.fusion' in rightPanels.
 */
import React from 'react';
import FusionPanel from './FusionPanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager }: PanelModuleParams) {
  return [
    {
      name: 'fusion',
      iconName: 'tab-studies',
      iconLabel: 'Fusion',
      label: 'Fusion',
      component: (props: Record<string, unknown>) => (
        <FusionPanel {...props} servicesManager={servicesManager} />
      ),
    },
  ];
}

export default getPanelModule;
