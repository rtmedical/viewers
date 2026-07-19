/**
 * getPanelModule (RTV-148) — registers the Key Images right panel.
 *
 * A mode opts in by listing
 *   '@ohif/extension-rtmedical-key-images.panelModule.keyImages'
 * in its rightPanels (see modes/longitudinal for the convention).
 */
import React from 'react';
import KeyImagesPanel from './KeyImagesPanel';

interface PanelModuleParams {
  servicesManager: { services: Record<string, unknown> };
  commandsManager: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager, commandsManager }: PanelModuleParams) {
  return [
    {
      name: 'keyImages',
      iconName: 'tab-studies',
      iconLabel: 'Key Images',
      label: 'Key Images',
      component: (props: Record<string, unknown>) => (
        <KeyImagesPanel
          {...props}
          servicesManager={servicesManager}
          commandsManager={commandsManager}
        />
      ),
    },
  ];
}

export default getPanelModule;
