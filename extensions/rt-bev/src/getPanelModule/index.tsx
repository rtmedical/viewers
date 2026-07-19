/**
 * getPanelModule (Phase B) — BEV panel.
 * Opt in via '@ohif/extension-rt-bev.panelModule.bev' in rightPanels.
 */
import React from 'react';
import BevPanel from './BevPanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager, commandsManager }: PanelModuleParams) {
  return [
    {
      name: 'bev',
      iconName: 'tab-studies',
      iconLabel: 'BEV',
      label: 'BEV',
      component: (props: Record<string, unknown>) => (
        <BevPanel
          {...props}
          servicesManager={servicesManager}
          commandsManager={commandsManager}
        />
      ),
    },
  ];
}

export default getPanelModule;
