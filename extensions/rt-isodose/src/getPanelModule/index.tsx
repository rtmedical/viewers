/**
 * getPanelModule (RTV-137) — Isodoses panel.
 * Opt in via '@ohif/extension-rt-isodose.panelModule.isodose' in rightPanels.
 */
import React from 'react';
import IsodosePanel from './IsodosePanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager }: PanelModuleParams) {
  return [
    {
      name: 'isodose',
      iconName: 'tab-studies',
      iconLabel: 'Isodoses',
      label: 'Isodoses',
      component: (props: Record<string, unknown>) => (
        <IsodosePanel {...props} servicesManager={servicesManager} />
      ),
    },
  ];
}

export default getPanelModule;
