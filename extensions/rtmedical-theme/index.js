// extensions/rtmedical-theme/index.js

import ViewerLayout from './src/ViewerLayout';
import getCustomizationModule from './src/getCustomizationModule';
import getPanelModule from './src/getPanelModule';

export default {
  id: 'rtmedical-theme',
  getCustomizationModule,
  getPanelModule,
  getLayoutTemplateModule({ commandsManager, extensionManager, hotkeysManager, servicesManager }) {
    return [
      {
        id: 'customLayout',
        name: 'Custom Layout',
        component: ViewerLayout,
        commandsManager,
        extensionManager,
        hotkeysManager,
        servicesManager,
      },
    ];
  },
};
