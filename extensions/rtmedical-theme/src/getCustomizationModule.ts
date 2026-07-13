import { WhiteLabelingProvider, useWhiteLabeling } from './whiteLabeling/WhiteLabelingContext';
import { Logo, createLogoComponentFn } from './whiteLabeling/Logo';
import { defaultBranding } from './whiteLabeling/defaultBranding';
import { RtMedicalAboutModal } from './whiteLabeling/RtMedicalAboutModal';
import { CommonHeader } from './components/CommonHeader';
import {
  TASK_ACTIONS,
  buildTaskMenuItems,
  canRunAction,
  createAuditLogger,
} from './taskActions';

/**
 * Registers RT Medical theme customizations with OHIF's CustomizationService.
 *
 * Consumers (modes / panels / the app shell) read these via
 * `customizationService.getCustomization('rtmedical.whiteLabeling')` and wrap
 * their tree in `WhiteLabelingProvider`, or use `createLogoComponentFn` to feed
 * the native `whiteLabeling.createLogoComponentFn` config hook. No @ohif/core,
 * @ohif/app or @ohif/ui sources are modified (RTV-114).
 */
export default function getCustomizationModule() {
  return [
    {
      name: 'rtmedical.whiteLabeling',
      value: {
        Provider: WhiteLabelingProvider,
        useWhiteLabeling,
        Logo,
        createLogoComponentFn,
        defaultBranding,
      },
    },
    {
      name: 'ohif.aboutModal',
      value: RtMedicalAboutModal,
    },
    {
      name: 'rtmedical.commonHeader',
      value: {
        // RTV-153 — mode-shareable header. Bind live patient/study/user data
        // and task/menu handlers at the mode level (see README).
        CommonHeader,
      },
    },
    {
      name: 'rtmedical.taskActions',
      value: {
        // RTV-154 — header "Tarefas" dropdown. Modes provide handlers + the
        // current user's permissions; `buildTaskMenuItems` applies RBAC,
        // confirmation for destructive/sensitive actions and audit logging,
        // returning items ready for `CommonHeader.tasks`. No @ohif/core,
        // @ohif/app or @ohif/ui sources are modified (RTV-114).
        TASK_ACTIONS,
        buildTaskMenuItems,
        canRunAction,
        createAuditLogger,
      },
    },
  ];
}
