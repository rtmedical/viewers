/**
 * BgTasksPanel (RTV-159) — history of the session's background tasks (last
 * 50, newest first) from the BgTaskService: status icon, label, detail, start
 * time and an inline progress bar while the task is running. Subscribes to
 * the service's TASK_* events (pub-sub over polling, per repo convention).
 *
 * Clicking a row runs the onClick the producer registered via
 * startTask({ onClick }) — there is no per-task page in the viewer, so rows
 * without one are a documented no-op click.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BgTask, BgTaskService } from './BgTaskService';

interface ServicesManagerLike {
  services: Record<string, unknown>;
}

export interface BgTasksPanelProps {
  servicesManager: ServicesManagerLike;
}

/** '2026-07-21T14:03:05.000Z' → localized 'HH:MM:SS' ('' when absent/invalid). */
function formatTime(iso?: string): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
}

function StatusIcon({ status }: { status: BgTask['status'] }): React.ReactElement {
  if (status === 'success') {
    return <span className="text-green-500">✓</span>;
  }
  if (status === 'error') {
    return <span className="text-red-500">✕</span>;
  }
  return <span className="animate-pulse text-blue-400">●</span>;
}

export function BgTasksPanel({ servicesManager }: BgTasksPanelProps): React.ReactElement {
  const { t } = useTranslation('RTMedical');
  const bgTaskService = servicesManager.services.rtmedicalBgTaskService as
    | BgTaskService
    | undefined;

  const [tasks, setTasks] = useState<BgTask[]>(() => bgTaskService?.getTasks() ?? []);

  const refresh = useCallback(
    () => setTasks(bgTaskService?.getTasks() ?? []),
    [bgTaskService]
  );

  useEffect(() => {
    if (!bgTaskService) {
      return undefined;
    }
    refresh();
    const subscriptions = [
      bgTaskService.subscribe(bgTaskService.EVENTS.TASK_STARTED, refresh),
      bgTaskService.subscribe(bgTaskService.EVENTS.TASK_UPDATED, refresh),
      bgTaskService.subscribe(bgTaskService.EVENTS.TASK_COMPLETED, refresh),
    ];
    return () => subscriptions.forEach(({ unsubscribe }) => unsubscribe());
  }, [bgTaskService, refresh]);

  return (
    <div
      className="ohif-scrollbar flex h-full flex-col text-white"
      data-cy="rt-bgtasks-panel"
    >
      <div className="px-2 py-2">
        <span className="text-base font-medium">{t('bgtask_panel_title')}</span>
      </div>
      {tasks.length === 0 ? (
        <div className="text-muted-foreground px-2 py-4 text-sm">{t('bgtask_empty')}</div>
      ) : (
        <ul className="flex-1 overflow-auto px-1">
          {tasks.map(task => (
            <li key={task.id}>
              <button
                type="button"
                data-cy="rt-bgtask-item"
                className="w-full rounded px-1 py-1 text-left text-sm hover:bg-black/30"
                title={`${t(`bgtask_${task.status}`)}${task.detail ? ` — ${task.detail}` : ''}`}
                onClick={() => task.onClick?.()}
              >
                <div className="flex items-center gap-2">
                  <StatusIcon status={task.status} />
                  <span className="flex-1 truncate font-medium">{task.label}</span>
                  <span className="text-muted-foreground text-xs">
                    {formatTime(task.startedAt)}
                  </span>
                </div>
                <div className="text-muted-foreground flex items-center gap-2 pl-5 text-xs">
                  <span>{t(`bgtask_${task.status}`)}</span>
                  {task.detail ? <span className="truncate">{task.detail}</span> : null}
                </div>
                {task.status === 'running' ? (
                  <div className="ml-5 mt-1 h-1 rounded bg-black/40">
                    {typeof task.progress === 'number' ? (
                      <div
                        className="h-1 rounded bg-blue-400"
                        style={{ width: `${task.progress}%` }}
                        data-cy="rt-bgtask-progress"
                      />
                    ) : (
                      // No reported progress yet → indeterminate pulse.
                      <div className="h-1 w-full animate-pulse rounded bg-blue-400/50" />
                    )}
                  </div>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default BgTasksPanel;
