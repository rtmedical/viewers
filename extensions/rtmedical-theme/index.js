// extensions/rtmedical-theme/index.js

import ViewerLayout from './src/ViewerLayout';
import getCustomizationModule from './src/getCustomizationModule';
import getPanelModule from './src/getPanelModule';
import getHangingProtocolModule from './src/getHangingProtocolModule';
import getCommandsModule from './src/getCommandsModule';
import WorklistQueueService from './src/worklist/WorklistQueueService';
import i18n from 'i18next';
import { RT_NAMESPACE, rtPtBR, rtEn } from './src/i18n/rtPtBR';

export default {
  id: 'rtmedical-theme',
  preRegistration({ servicesManager }) {
    servicesManager.registerService(WorklistQueueService.REGISTRATION);
    // RTV-9: RT-specific PT-BR strings (OHIF already ships the base pt-BR locale).
    i18n.addResourceBundle('pt-BR', RT_NAMESPACE, rtPtBR, true, true);
    i18n.addResourceBundle('en-US', RT_NAMESPACE, rtEn, true, true);
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
