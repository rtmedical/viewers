/**
 * getPanelModule (RTV-140) — RT Print panel.
 * Opt in via '@ohif/extension-rt-print.panelModule.rtPrint' in rightPanels.
 */
import React from 'react';
import RtPrintPanel from './RtPrintPanel';

interface PanelModuleParams {
  servicesManager?: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule(_params: PanelModuleParams) {
  return [
    {
      name: 'rtPrint',
      iconName: 'tab-studies',
      iconLabel: 'RT Print',
      label: 'RT Print',
      component: () => <RtPrintPanel />,
    },
  ];
}

export default getPanelModule;
