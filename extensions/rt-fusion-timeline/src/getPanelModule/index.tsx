/**
 * getPanelModule (RTV-135) — Fusion Timeline panel.
 * Opt in via '@ohif/extension-rt-fusion-timeline.panelModule.fusionTimeline'.
 */
import React from 'react';
import FusionTimelinePanel from './FusionTimelinePanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager }: PanelModuleParams) {
  return [
    {
      name: 'fusionTimeline',
      iconName: 'tab-studies',
      iconLabel: 'Fusion Timeline',
      label: 'Fusion Timeline',
      component: (props: Record<string, unknown>) => (
        <FusionTimelinePanel {...props} servicesManager={servicesManager} />
      ),
    },
  ];
}

export default getPanelModule;
