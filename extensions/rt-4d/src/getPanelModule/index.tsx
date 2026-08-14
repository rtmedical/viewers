/**
 * getPanelModule (RTV-93, RTV-51) — 4D / gating panel.
 * Opt in via '@ohif/extension-rt-4d.panelModule.rt4d' in rightPanels.
 */
import React from 'react';
import Rt4dPanel from './Rt4dPanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => any };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager, commandsManager }: PanelModuleParams) {
  return [
    {
      name: 'rt4d',
      iconName: 'tab-4d',
      iconLabel: '4D',
      label: '4D / gating',
      component: (props: Record<string, unknown>) => (
        <Rt4dPanel {...props} servicesManager={servicesManager} commandsManager={commandsManager} />
      ),
    },
  ];
}

export default getPanelModule;
