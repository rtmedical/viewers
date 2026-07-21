/**
 * getPanelModule (RTV-132) — registers the RT Plan "Ficha" right panel.
 *
 * A mode opts in by listing
 *   '@ohif/extension-rt-plan.panelModule.rtPlan'
 * in its rightPanels.
 */
import React from 'react';
import RTPlanPanel from './RTPlanPanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager, commandsManager }: PanelModuleParams) {
  return [
    {
      name: 'rtPlan',
      iconName: 'tab-studies',
      iconLabel: 'RT Plan',
      label: 'RT Plan',
      component: (props: Record<string, unknown>) => (
        <RTPlanPanel
          {...props}
          servicesManager={servicesManager}
          commandsManager={commandsManager}
        />
      ),
    },
  ];
}

export default getPanelModule;
