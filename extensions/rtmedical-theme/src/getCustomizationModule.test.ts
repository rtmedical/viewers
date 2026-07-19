import { CustomizationService } from '@ohif/core';

jest.mock('@ohif/ui-next', () => {
  const AboutModal: any = () => null;
  AboutModal.ProductName = () => null;
  AboutModal.ProductVersion = () => null;
  AboutModal.ProductBeta = () => null;
  AboutModal.Body = () => null;
  AboutModal.DetailItem = () => null;

  return { AboutModal };
});

import getCustomizationModule from './getCustomizationModule';
import { WhiteLabelingService } from './whiteLabeling/WhiteLabelingRootProvider';

describe('getCustomizationModule', () => {
  function createFixture(configuration: Record<string, unknown> = {}) {
    const customizationService = new CustomizationService({
      commandsManager: {},
      configuration,
    });
    const whiteLabelingService = new WhiteLabelingService(
      {
        defaultTenant: 'clinic',
        tenants: {
          clinic: {
            productName: 'Clinic Viewer',
          },
        },
      },
      customizationService
    );
    const modules = getCustomizationModule({
      servicesManager: {
        services: {
          [WhiteLabelingService.REGISTRATION.name]: whiteLabelingService,
        },
      },
    });
    const defaultModule = modules.find(module => module.name === 'default');
    const registeredAboutModal = modules.find(module => module.name === 'ohif.aboutModal')?.value;
    const defaultAboutModal = () => null;
    const moduleEntries = new Map<string, { value: unknown }>([
      [
        '@ohif/extension-default.customizationModule.default',
        { value: { 'ohif.aboutModal': defaultAboutModal } },
      ],
      ['rtmedical-theme.customizationModule.default', { value: defaultModule?.value }],
    ]);
    const extensionManager = {
      getRegisteredExtensionIds: () => ['@ohif/extension-default', 'rtmedical-theme'],
      getModuleEntry: (key: string) => moduleEntries.get(key),
    };
    customizationService.init(extensionManager as never);
    whiteLabelingService.installAboutModal();

    return {
      customizationService,
      defaultAboutModal,
      extensionManager,
      registeredAboutModal,
      whiteLabelingService,
    };
  }

  it('registers the tenant-aware About modal through the extension service', () => {
    const { customizationService, defaultAboutModal, registeredAboutModal } = createFixture();

    expect(customizationService.getCustomization('ohif.aboutModal')).toBe(registeredAboutModal);
    expect(customizationService.getCustomization('ohif.aboutModal')).not.toBe(defaultAboutModal);
    expect(customizationService.getCustomization('rtmedical.whiteLabeling')).toBeDefined();
  });

  it('preserves an explicit app override across mode entry', () => {
    const configuredAboutModal = () => null;
    const { customizationService, extensionManager, whiteLabelingService } = createFixture({
      'ohif.aboutModal': configuredAboutModal,
    });

    expect(customizationService.getCustomization('ohif.aboutModal')).toBe(configuredAboutModal);

    customizationService.onModeEnter();
    whiteLabelingService.onModeEnter();

    expect(customizationService.getCustomization('ohif.aboutModal')).toBe(configuredAboutModal);
    expect(extensionManager.getRegisteredExtensionIds()).toContain('rtmedical-theme');
  });

  it('allows a mode to override the tenant-aware default', () => {
    const modeAboutModal = () => null;
    const { customizationService } = createFixture();

    customizationService.setCustomizations(
      { 'ohif.aboutModal': modeAboutModal },
      customizationService.Scope.Mode
    );

    expect(customizationService.getCustomization('ohif.aboutModal')).toBe(modeAboutModal);
  });

  it('does not redefine the default About customization during lifecycle resets', () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { customizationService, whiteLabelingService } = createFixture();

    customizationService.onModeEnter();
    whiteLabelingService.onModeEnter();
    customizationService.onModeExit();
    whiteLabelingService.onModeExit();

    expect(warning).not.toHaveBeenCalledWith(
      expect.stringContaining('Trying to update existing default')
    );
    warning.mockRestore();
  });
});
