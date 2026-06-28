// extensions/rtmedical-theme/index.js

import ViewerLayout from './src/ViewerLayout';
import getCustomizationModule from './src/getCustomizationModule';
import getPanelModule from './src/getPanelModule';
import getHangingProtocolModule from './src/getHangingProtocolModule';
import getCommandsModule from './src/getCommandsModule';
import WorklistQueueService from './src/worklist/WorklistQueueService';

export default {
  id: 'rtmedical-theme',
  preRegistration({ servicesManager }) {
    servicesManager.registerService(WorklistQueueService.REGISTRATION);
  },
  getCustomizationModule,
  getPanelModule,
  getHangingProtocolModule,
  getCommandsModule,
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
