import WorklistQueueService from './worklist/WorklistQueueService';
import { applyTouchGestures, removeTouchGestures } from './touch/touchGestures';
import type { TeardownTouchGestures } from './touch/touchGestures';

/**
 * RT workflow commands (RTV-120). Worklist next/prev navigation built on the
 * stock `navigateHistory` command (SPA navigation), reading the queue/cursor
 * from WorklistQueueService. Bind to header buttons or hotkeys (k/j).
 * RTV-114: only public command/service APIs.
 */
interface CommandsModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager: {
    run: (input: unknown, options?: Record<string, unknown>) => unknown;
    runCommand: (
      name: string,
      options?: Record<string, unknown>,
      context?: string
    ) => unknown;
  };
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
    // RTV-210: touch/tablet gestures (iPad rounds). Modes call this in
    // onModeEnter (after the tool groups exist) and keep the returned teardown
    // for onModeExit — onModeExit does not receive commandsManager
    // (Mode.tsx:329-333), so the teardown travels as the command's return
    // value. 'removeTouchGestures' is the command-shaped fallback.
    applyTouchGestures: ({
      toolGroupIds,
    }: {
      toolGroupIds?: string[];
    } = {}): TeardownTouchGestures =>
      applyTouchGestures({ servicesManager, commandsManager, toolGroupIds }),
    removeTouchGestures: (): void => removeTouchGestures(),
  };

  const definitions = {
    nextStudyInWorklist: { commandFn: actions.nextStudyInWorklist },
    prevStudyInWorklist: { commandFn: actions.prevStudyInWorklist },
    activateRtPanel: { commandFn: actions.activateRtPanel },
    applyTouchGestures: { commandFn: actions.applyTouchGestures },
    removeTouchGestures: { commandFn: actions.removeTouchGestures },
  };

  return { actions, definitions, defaultContext: 'DEFAULT' };
}
