/**
 * wireBgTaskToasts (RTV-159) — bridges the pure BgTaskService event stream to
 * OHIF's uiNotificationService (rt-capture toast pattern): an info toast when
 * a task starts and a success/error toast when it completes, both titled with
 * the task label. Kept OUT of the service so the core stays framework-free.
 *
 * Called from the extension's preRegistration (uiNotificationService is
 * registered by appInit BEFORE extensions load, so it is available there).
 * Returns a teardown that unsubscribes both listeners.
 */
import type { BgTaskEvent, BgTaskService } from './BgTaskService';

interface UINotificationServiceLike {
  show?: (options: {
    title: string;
    message: string;
    type: 'success' | 'error' | 'info';
    duration?: number;
  }) => unknown;
}

export function wireBgTaskToasts(
  bgTaskService: BgTaskService,
  uiNotificationService: UINotificationServiceLike
): () => void {
  const toast = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    try {
      uiNotificationService?.show?.({ title, message, type, duration: 4000 });
    } catch (e) {
      /* toasts must never break the producing task */
    }
  };

  const subscriptions = [
    bgTaskService.subscribe(bgTaskService.EVENTS.TASK_STARTED, ({ task }: BgTaskEvent) => {
      toast('info', task.label, task.detail ?? 'Running in the background...');
    }),
    bgTaskService.subscribe(bgTaskService.EVENTS.TASK_COMPLETED, ({ task }: BgTaskEvent) => {
      if (task.status === 'error') {
        toast('error', task.label, task.detail ?? 'Task failed.');
      } else {
        toast('success', task.label, task.detail ?? 'Task completed.');
      }
    }),
  ];

  return () => subscriptions.forEach(({ unsubscribe }) => unsubscribe());
}

export default wireBgTaskToasts;
