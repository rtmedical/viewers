/**
 * getPanelModule (RTV-48) — registers the AHA bullseye right panel.
 *
 * A mode opts in by listing '@ohif/extension-cardiology.panelModule.bullseye'
 * in its rightPanels. The label is translated at render time inside the panel
 * component (RTMedical namespace).
 */
import React from 'react';
import BullseyePanel from './BullseyePanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager }: PanelModuleParams) {
  return [
    {
      name: 'bullseye',
      iconName: 'tab-studies',
      iconLabel: 'Bullseye',
      label: 'Bullseye',
      component: (props: Record<string, unknown>) => (
        <BullseyePanel {...props} servicesManager={servicesManager} />
      ),
    },
  ];
}

export default getPanelModule;
