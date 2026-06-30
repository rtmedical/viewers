/**
 * getPanelModule (RTV-79) — CAD findings panel.
 * Opt in via '@ohif/extension-cad.panelModule.cad' in rightPanels.
 */
import React from 'react';
import CadPanel from './CadPanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager }: PanelModuleParams) {
  return [
    {
      name: 'cad',
      iconName: 'tab-studies',
      iconLabel: 'CAD',
      label: 'CAD Findings',
      component: (props: Record<string, unknown>) => (
        <CadPanel {...props} servicesManager={servicesManager} />
      ),
    },
  ];
}

export default getPanelModule;
