/**
 * getPanelModule (RTV-201) — Radiation Dose Report panel.
 * Opt in via '@ohif/extension-dose-tracking.panelModule.doseReport' in rightPanels.
 */
import React from 'react';
import DoseReportPanel from './DoseReportPanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager }: PanelModuleParams) {
  return [
    {
      name: 'doseReport',
      iconName: 'tab-studies',
      iconLabel: 'Dose',
      label: 'Dose Report',
      component: (props: Record<string, unknown>) => (
        <DoseReportPanel {...props} servicesManager={servicesManager} />
      ),
    },
  ];
}

export default getPanelModule;
