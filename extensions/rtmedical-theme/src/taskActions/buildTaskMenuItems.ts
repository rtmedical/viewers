/**
 * RTV-154 — turns the static task-action registry + runtime context (user
 * permissions, handlers, confirmation, audit) into `HeaderMenuItem[]` ready to
 * feed `CommonHeader`'s "Tarefas" dropdown (RTV-153).
 *
 * Responsibilities:
 *  - RBAC: hide (default) or disable actions the user may not run.
 *  - Confirmation: destructive/sensitive actions are gated behind `confirm`.
 *    If no `confirm` is supplied they fail safe (treated as cancelled).
 *  - Audit: every attempt is recorded (invoked/cancelled/completed/error;
 *    plus `denied` for the defense-in-depth backstop on disabled items).
 *  - Wiring: only actions with a supplied handler are surfaced.
 *
 * Pure orchestration — no @ohif/* imports (RTV-114). Side effects come in
 * through injected `handlers`, `confirm` and `audit`.
 */
import type { HeaderMenuItem } from '../components/CommonHeader/HeaderDropdown';
import { canRunAction } from './rbac';
import { NOOP_AUDIT_LOGGER } from './auditLog';
import { TASK_ACTIONS, needsConfirmation } from './taskActionRegistry';
import type {
  AuditLogger,
  ConfirmFn,
  TaskActionDescriptor,
  TaskActionId,
  TaskHandler,
  UserPermissions,
} from './types';

/** Map of action id → side-effecting handler. Only mapped actions are shown. */
export type TaskHandlerMap = Partial<Record<TaskActionId, TaskHandler>>;

export interface BuildTaskMenuItemsOptions {
  /** Side-effecting handlers wired at the mode level. */
  handlers: TaskHandlerMap;
  /** Action descriptors (defaults to the canonical 7). */
  actions?: TaskActionDescriptor[];
  /** Current user's permissions for RBAC filtering. */
  user?: UserPermissions | null;
  /** Confirmation prompt for destructive/sensitive actions (defaults to deny). */
  confirm?: ConfirmFn;
  /** Audit logger (defaults to a no-op). */
  audit?: Pick<AuditLogger, 'log'>;
  /** Actor id/name recorded in audit entries. */
  actor?: string;
  /** Unauthorized actions: `'hide'` (default) removes them; `'disable'` greys them out. */
  unauthorized?: 'hide' | 'disable';
  /** i18n resolver: (labelKey, englishFallback) → localized label. */
  translate?: (key: string, fallback: string) => string;
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function buildTaskMenuItems(options: BuildTaskMenuItemsOptions): HeaderMenuItem[] {
  const {
    handlers,
    actions = TASK_ACTIONS,
    user = null,
    confirm,
    audit = NOOP_AUDIT_LOGGER,
    actor = 'unknown',
    unauthorized = 'hide',
    translate,
  } = options;

  // i18n: labels are English source; a caller-supplied translator (typically
  // i18next's t bound to the RTMedical namespace) localizes them per labelKey.
  const labelOf = (action: { label: string; labelKey?: string }): string =>
    (action.labelKey && translate?.(action.labelKey, action.label)) || action.label;

  const items: HeaderMenuItem[] = [];

  for (const action of actions) {
    const handler = handlers[action.id];
    // Only surface actions the current mode actually wired.
    if (!handler) {
      continue;
    }

    const allowed = canRunAction(user, action);

    if (!allowed) {
      if (unauthorized === 'hide') {
        continue;
      }
      // 'disable' — show greyed out, not selectable. The dropdown already
      // blocks clicks on disabled items; this onClick is a defense-in-depth
      // backstop that records the denied attempt and never runs a handler.
      items.push({
        id: action.id,
        label: labelOf(action),
        disabled: true,
        onClick: () => {
          audit.log({ action: action.id, actor, status: 'denied' });
        },
      });
      continue;
    }

    const onClick = async () => {
      if (needsConfirmation(action)) {
        const confirmed = confirm ? await confirm(action) : false;
        if (!confirmed) {
          audit.log({
            action: action.id,
            actor,
            status: 'cancelled',
            detail: confirm ? undefined : 'no confirm handler',
          });
          return;
        }
      }

      audit.log({ action: action.id, actor, status: 'invoked' });
      try {
        await handler();
        audit.log({ action: action.id, actor, status: 'completed' });
      } catch (error) {
        audit.log({
          action: action.id,
          actor,
          status: 'error',
          detail: errorDetail(error),
        });
      }
    };

    items.push({
      id: action.id,
      label: labelOf(action),
      onClick,
    });
  }

  return items;
}
