/**
 * RTV-154 — Tasks Dropdown public surface.
 *
 * Re-exports the registry, RBAC helpers, audit logger and the
 * `buildTaskMenuItems` orchestrator that feeds `CommonHeader` (RTV-153).
 */
export * from './types';
export {
  TASK_ACTIONS,
  TASK_ACTIONS_BY_ID,
  getTaskAction,
  needsConfirmation,
} from './taskActionRegistry';
export { WILDCARD_PERMISSION, ADMIN_ROLE, isAdmin, hasPermission, canRunAction } from './rbac';
export { createAuditLogger, NOOP_AUDIT_LOGGER } from './auditLog';
export type { CreateAuditLoggerOptions } from './auditLog';
export { buildTaskMenuItems } from './buildTaskMenuItems';
export type { TaskHandlerMap, BuildTaskMenuItemsOptions } from './buildTaskMenuItems';
