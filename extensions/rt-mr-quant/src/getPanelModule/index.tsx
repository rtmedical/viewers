/**
 * getPanelModule (RTV-82) — Parametric map panel.
 * Opt in via '@ohif/extension-rt-mr-quant.panelModule.parametricMap' in rightPanels.
 */
import React from 'react';
import ParametricMapPanel from './ParametricMapPanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager, commandsManager }: PanelModuleParams) {
  return [
    {
      name: 'parametricMap',
      iconName: 'tab-studies',
      iconLabel: 'Parametric',
      label: 'Parametric map',
      component: (props: Record<string, unknown>) => (
        <ParametricMapPanel
          {...props}
          servicesManager={servicesManager}
          commandsManager={commandsManager}
        />
      ),
    },
  ];
}

export default getPanelModule;
