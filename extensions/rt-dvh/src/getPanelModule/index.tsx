/**
 * getPanelModule (RTV-131) — registers the DVH right panel.
 *
 * A mode opts in by listing '@ohif/extension-rt-dvh.panelModule.dvh' in its
 * rightPanels.
 */
import React from 'react';
import DvhPanel from './DvhPanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager }: PanelModuleParams) {
  return [
    {
      name: 'dvh',
      iconName: 'tab-studies',
      iconLabel: 'DVH',
      label: 'DVH',
      component: (props: Record<string, unknown>) => (
        <DvhPanel {...props} servicesManager={servicesManager} />
      ),
    },
  ];
}

export default getPanelModule;
