import WorklistQueueService from './worklist/WorklistQueueService';

/**
 * RT workflow commands (RTV-120). Worklist next/prev navigation built on the
 * stock `navigateHistory` command (SPA navigation), reading the queue/cursor
 * from WorklistQueueService. Bind to header buttons or hotkeys (k/j).
 * RTV-114: only public command/service APIs.
 */
interface CommandsModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
}

export default function getCommandsModule({
  servicesManager,
  commandsManager,
}: CommandsModuleParams) {
  const getQueue = (): WorklistQueueService | undefined =>
    servicesManager.services[WorklistQueueService.REGISTRATION.name];

  const navigateToStudy = (studyUID?: string): boolean => {
    if (!studyUID) {
      return false;
    }
    commandsManager.runCommand('navigateHistory', {
      to: `viewer?StudyInstanceUIDs=${studyUID}`,
    });
    return true;
  };

  const actions = {
    nextStudyInWorklist: (): boolean => navigateToStudy(getQueue()?.getNextStudyUID()),
    prevStudyInWorklist: (): boolean => navigateToStudy(getQueue()?.getPrevStudyUID()),
    // RTV-124: reveal an RT side panel by id from a toolbar button (FUSÃO/LAUDO/
    // IMPRESSÃO). Same one-liner the RTV-126 auto-reveal uses; SidePanelWithServices
    // listens for ACTIVATE_PANEL and switches the tab even when collapsed.
    activateRtPanel: ({ panelId }: { panelId?: string }): boolean => {
      const { panelService } = servicesManager.services;
      if (!panelService || !panelId) {
        return false;
      }
      panelService.activatePanel(panelId, true);
      return true;
    },
  };

  const definitions = {
    nextStudyInWorklist: { commandFn: actions.nextStudyInWorklist },
    prevStudyInWorklist: { commandFn: actions.prevStudyInWorklist },
    activateRtPanel: { commandFn: actions.activateRtPanel },
  };

  return { actions, definitions, defaultContext: 'DEFAULT' };
}
