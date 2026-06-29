/**
 * getPanelModule (RTV-163) — RT Treatment Records summary panel.
 * Opt in via '@ohif/extension-rt-record.panelModule.rtRecord' in rightPanels.
 */
import React from 'react';
import RtRecordPanel from './RtRecordPanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager }: PanelModuleParams) {
  return [
    {
      name: 'rtRecord',
      iconName: 'tab-studies',
      iconLabel: 'RT Records',
      label: 'RT Records',
      component: (props: Record<string, unknown>) => (
        <RtRecordPanel {...props} servicesManager={servicesManager} />
      ),
    },
  ];
}

export default getPanelModule;
