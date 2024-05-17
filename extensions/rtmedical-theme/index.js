// extensions/rtmedical-theme/index.js

import ViewerLayout from './src/ViewerLayout';

export default {
  id: 'rtmedical-theme',
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
