/**
 * getPanelModule (RTV-146 + Wave 4/Phase 3) — registers the RT Structures panels.
 * - '@ohif/extension-rt-struct.panelModule.rtStruct'  → summary table (right).
 * - '@ohif/extension-rt-struct.panelModule.roiWorkspace' → autoseg-style "Focus"
 *   grouped structures workspace with visibility/colour controls (left).
 */
import React from 'react';
import RtStructPanel from './RtStructPanel';
import RtStructWorkspacePanel from './RtStructWorkspacePanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager, commandsManager }: PanelModuleParams) {
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
    {
      name: 'roiWorkspace',
      iconName: 'tab-segmentation',
      iconLabel: 'Structures',
      label: 'Structures',
      component: (props: Record<string, unknown>) => (
        <RtStructWorkspacePanel
          {...props}
          servicesManager={servicesManager}
          commandsManager={commandsManager}
        />
      ),
    },
  ];
}

export default getPanelModule;
