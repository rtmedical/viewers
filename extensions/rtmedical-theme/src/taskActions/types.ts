/**
 * RTV-154 — Tasks Dropdown domain types.
 *
 * Pure, framework-agnostic descriptions of the header "Tarefas" actions, the
 * RBAC inputs, the audit record and the confirmation/handler contracts. Kept
 * free of @ohif/core, @ohif/app and @ohif/ui imports (RTV-114) so the logic is
 * trivially unit-testable and the side-effecting bits are injected at the mode
 * level.
 */

/** Canonical task action identifiers (the 7 RTV-154 actions). */
export type TaskActionId =
  | 'export'
  | 'import'
  | 'updateCalibration'
  | 'saveReport'
  | 'generateKeyImages'
  | 'changePatientInfo'
  | 'deleteStudy';

/** Static metadata describing a single task action. */
export interface TaskActionDescriptor {
  id: TaskActionId;
  /** Visible (PT-BR) label. */
  label: string;
  /**
   * Permission keys the user must hold to run the action. ALL are required
   * (AND semantics). An empty array means the action is always permitted.
   */
  requiredPermissions: string[];
  /**
   * Destructive action (e.g. delete). Always forces a confirmation prompt and
   * is flagged for emphasis in the audit trail.
   */
  destructive?: boolean;
  /**
   * Forces a confirmation prompt even when not destructive — for sensitive but
   * non-destructive edits (e.g. changing patient demographics).
   */
  requiresConfirmation?: boolean;
}

/**
 * What the current user is allowed to do. `permissions` are matched directly;
 * the `'*'` wildcard permission or the `admin` role grants everything.
 */
export interface UserPermissions {
  permissions?: string[];
  roles?: string[];
}

/** Lifecycle status recorded for every audited action attempt. */
export type AuditStatus =
  | 'invoked'
  | 'denied'
  | 'cancelled'
  | 'completed'
  | 'error';

/** A single immutable audit-trail record. */
export interface AuditEntry {
  action: TaskActionId;
  actor: string;
  status: AuditStatus;
  timestamp: number;
  detail?: string;
}

/** External audit transport (e.g. POST to the Connect API). Must not throw. */
export type AuditSink = (entry: AuditEntry) => void;

/** In-memory audit logger with an injectable external sink. */
export interface AuditLogger {
  /** Append an entry; `timestamp` is filled from the injected clock if omitted. */
  log: (entry: Omit<AuditEntry, 'timestamp'> & { timestamp?: number }) => AuditEntry;
  /** Snapshot of buffered entries (newest last). */
  getEntries: () => AuditEntry[];
  /** Drop all buffered entries. */
  clear: () => void;
}

/** Resolves truthy to proceed with a destructive/sensitive action. */
export type ConfirmFn = (action: TaskActionDescriptor) => boolean | Promise<boolean>;

/** Side-effecting action handler, wired at the mode level (e.g. commandsManager). */
export type TaskHandler = () => void | Promise<void>;
