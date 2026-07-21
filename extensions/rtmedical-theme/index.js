// extensions/rtmedical-theme/index.js

import ViewerLayout from './src/ViewerLayout';
import getCustomizationModule from './src/getCustomizationModule';
import getPanelModule from './src/getPanelModule';
import getHangingProtocolModule from './src/getHangingProtocolModule';
import getCommandsModule from './src/getCommandsModule';
import WorklistQueueService from './src/worklist/WorklistQueueService';
import BgTaskService from './src/bgTasks/BgTaskService';
import wireBgTaskToasts from './src/bgTasks/wireBgTaskToasts';
import i18n from 'i18next';
import { RT_NAMESPACE, rtPtBR, rtEn } from './src/i18n/rtPtBR';
import { defaultBranding } from './src/whiteLabeling/defaultBranding';
import { setRouterBasename } from './src/whiteLabeling/publicUrl';
import { buildThemeCssVars } from './src/whiteLabeling/applyThemeOverride';
import { applyCarbonTheme, applyCarbonIconStyle } from './src/whiteLabeling/carbonTheme';
import { applyUiPolishStyle } from './src/whiteLabeling/uiPolish';
import { applyCarbonIcons } from './src/whiteLabeling/carbonIcons';
import {
  WhiteLabelingRootProvider,
  WhiteLabelingService,
  createContextLogoComponentFn,
} from './src/whiteLabeling/WhiteLabelingRootProvider';

export default {
  id: 'rtmedical-theme',
  preRegistration({ servicesManager, serviceProvidersManager, appConfig }) {
    setRouterBasename(appConfig?.routerBasename);
    servicesManager.registerService(WorklistQueueService.REGISTRATION);
    // RTV-159: background-task registry + per-task toasts. appInit registers
    // uiNotificationService BEFORE extensions preRegistration, so the toast
    // wiring can live here for the app's lifetime (no teardown needed).
    servicesManager.registerService(BgTaskService.REGISTRATION);
    try {
      const { rtmedicalBgTaskService, uiNotificationService } = servicesManager.services;
      if (rtmedicalBgTaskService && uiNotificationService) {
        wireBgTaskToasts(rtmedicalBgTaskService, uiNotificationService);
      }
    } catch (e) {
      /* task toasts are non-fatal */
    }
    servicesManager.registerService(
      WhiteLabelingService.REGISTRATION,
      appConfig?.rtmedicalWhiteLabeling
    );
    serviceProvidersManager.registerProvider(
      WhiteLabelingService.REGISTRATION.name,
      WhiteLabelingRootProvider
    );
    if (appConfig) {
      const whiteLabeling = appConfig.whiteLabeling ?? {};
      appConfig.whiteLabeling = {
        ...whiteLabeling,
        createLogoComponentFn: whiteLabeling.createLogoComponentFn ?? createContextLogoComponentFn,
      };
    }
    // RTV-9: RT-specific PT-BR strings (OHIF already ships the base pt-BR locale).
    i18n.addResourceBundle('pt-BR', RT_NAMESPACE, rtPtBR, true, true);
    i18n.addResourceBundle('en-US', RT_NAMESPACE, rtEn, true, true);
    // RTV-7: apply the default RT Medical theme palette (dark) at startup as
    // :root CSS variables. Tenant white-labeling (RTV-156) overrides these.
    try {
      if (typeof document !== 'undefined') {
        // RTV-7: repaint OHIF's ui-next design tokens with the IBM Carbon g100
        // palette (neutral greys + focused blue) so the whole viewer matches the
        // autoseg Carbon look. Icons use currentColor, so they follow along.
        // RTV-181: per-workstation Carbon theme choice — `?theme=g80|g100`
        // persists to localStorage; the product DEFAULT stays g100.
        let carbonThemeName = 'g100';
        try {
          const requested = new URLSearchParams(window.location.search).get('theme');
          if (requested === 'g80' || requested === 'g100') {
            localStorage.setItem('rt-carbon-theme', requested);
          }
          const stored = localStorage.getItem('rt-carbon-theme');
          if (stored === 'g80' || stored === 'g100') {
            carbonThemeName = stored;
          }
        } catch (e) {
          /* storage/URL unavailable — keep the default */
        }
        applyCarbonTheme(undefined, carbonThemeName);
        applyCarbonIconStyle();
        // RTV-212: tooltip clamps, shrinkable study cards, grey elevation,
        // loading skeleton — elevation surfaces follow the RTV-181 theme.
        applyUiPolishStyle(undefined, carbonThemeName);
        applyCarbonIcons();
        // Tenant white-labeling accent vars (RTV-156) layered on top.

        const vars = buildThemeCssVars(defaultBranding.theme);
        Object.entries(vars).forEach(([name, value]) =>
          document.documentElement.style.setProperty(name, value)
        );
      }
    } catch (e) {
      /* theming is non-fatal */
    }
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
