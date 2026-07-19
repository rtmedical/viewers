import { WhiteLabelingProvider, useWhiteLabeling } from './whiteLabeling/WhiteLabelingContext';
import { Logo, createLogoComponentFn } from './whiteLabeling/Logo';
import { defaultBranding } from './whiteLabeling/defaultBranding';
import { createRtMedicalAboutModal } from './whiteLabeling/RtMedicalAboutModal';
import { WhiteLabelingService } from './whiteLabeling/WhiteLabelingRootProvider';
import { CommonHeader } from './components/CommonHeader';
import { TASK_ACTIONS, buildTaskMenuItems, canRunAction, createAuditLogger } from './taskActions';

/**
 * Registers RT Medical theme customizations with OHIF's CustomizationService.
 *
 * Consumers (modes / panels / the app shell) read these via
 * `customizationService.getCustomization('rtmedical.whiteLabeling')` and wrap
 * their tree in `WhiteLabelingProvider`, or use `createLogoComponentFn` to feed
 * the native `whiteLabeling.createLogoComponentFn` config hook. No @ohif/core,
 * @ohif/app or @ohif/ui sources are modified (RTV-114).
 */
interface GetCustomizationModuleOptions {
  servicesManager?: {
    services?: Record<string, unknown>;
  };
}

export default function getCustomizationModule({
  servicesManager,
}: GetCustomizationModuleOptions = {}) {
  const whiteLabelingService = servicesManager?.services?.[
    WhiteLabelingService.REGISTRATION.name
  ] as WhiteLabelingService | undefined;
  const AboutModal = createRtMedicalAboutModal(whiteLabelingService);
  whiteLabelingService?.setAboutModal(AboutModal);
  const whiteLabelingCustomization = {
    Provider: WhiteLabelingProvider,
    useWhiteLabeling,
    Logo,
    createLogoComponentFn,
    defaultBranding,
  };
  const commonHeaderCustomization = {
    // RTV-153 - mode-shareable header. Bind live patient/study/user data
    // and task/menu handlers at the mode level (see README).
    CommonHeader,
  };
  const taskActionsCustomization = {
    // RTV-154 - header "Tarefas" dropdown. Modes provide handlers + the
    // current user's permissions; `buildTaskMenuItems` applies RBAC,
    // confirmation for destructive/sensitive actions and audit logging,
    // returning items ready for `CommonHeader.tasks`. No @ohif/core,
    // @ohif/app or @ohif/ui sources are modified (RTV-114).
    TASK_ACTIONS,
    buildTaskMenuItems,
    canRunAction,
    createAuditLogger,
  };
  return [
    {
      // These extension-owned ids do not collide with OHIF defaults. About is
      // installed separately in mode scope so app and mode overrides retain
      // their documented priority without redefining OHIF's default.
      name: 'default',
      value: {
        'rtmedical.whiteLabeling': whiteLabelingCustomization,
        'rtmedical.commonHeader': commonHeaderCustomization,
        'rtmedical.taskActions': taskActionsCustomization,
      },
    },
    {
      name: 'rtmedical.whiteLabeling',
      value: whiteLabelingCustomization,
    },
    {
      name: 'ohif.aboutModal',
      value: AboutModal,
    },
    {
      name: 'rtmedical.commonHeader',
      value: commonHeaderCustomization,
    },
    {
      name: 'rtmedical.taskActions',
      value: taskActionsCustomization,
    },
  ];
}
