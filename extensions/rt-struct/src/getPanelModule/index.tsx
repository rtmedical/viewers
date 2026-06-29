/**
 * getPanelModule (RTV-146) — registers the RT Structures summary right panel.
 * Opt in via '@ohif/extension-rt-struct.panelModule.rtStruct' in rightPanels.
 */
import React from 'react';
import RtStructPanel from './RtStructPanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager }: PanelModuleParams) {
  return [
    {
      name: 'rtStruct',
      iconName: 'tab-studies',
      iconLabel: 'Structures',
      label: 'Structures',
      component: (props: Record<string, unknown>) => (
        <RtStructPanel {...props} servicesManager={servicesManager} />
      ),
    },
  ];
}

export default getPanelModule;
