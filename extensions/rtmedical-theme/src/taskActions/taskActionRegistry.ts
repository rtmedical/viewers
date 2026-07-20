/**
 * RTV-154 — canonical registry of the 7 header task actions.
 *
 * Metadata only (labels, required permissions, destructive/confirmation flags).
 * The actual behaviour is supplied as injected handlers at the mode level, so
 * this stays a pure, side-effect-free data module.
 */
import type { TaskActionDescriptor, TaskActionId } from './types';

/** The 7 RTV-154 actions, in display order. */
export const TASK_ACTIONS: TaskActionDescriptor[] = [
  {
    id: 'export',
    label: 'Export study',
    labelKey: 'task_export',
    requiredPermissions: ['study:export'],
  },
  {
    id: 'import',
    label: 'Import files',
    labelKey: 'task_import',
    requiredPermissions: ['study:import'],
  },
  {
    id: 'updateCalibration',
    label: 'Update calibration',
    labelKey: 'task_update_calibration',
    requiredPermissions: ['image:calibrate'],
  },
  {
    id: 'saveReport',
    label: 'Save report',
    labelKey: 'task_save_report',
    requiredPermissions: ['report:write'],
  },
  {
    id: 'generateKeyImages',
    label: 'Generate key images',
    labelKey: 'task_generate_key_images',
    requiredPermissions: ['keyimage:create'],
  },
  {
    id: 'changePatientInfo',
    label: 'Edit patient info',
    labelKey: 'task_change_patient_info',
    requiredPermissions: ['patient:edit'],
    // Non-destructive but sensitive: edits patient demographics → confirm first.
    requiresConfirmation: true,
  },
  {
    id: 'deleteStudy',
    label: 'Delete study',
    labelKey: 'task_delete_study',
    requiredPermissions: ['study:delete'],
    // Destructive: irreversible removal → always confirm + audit.
    destructive: true,
  },
];

/** Lookup map by action id. */
export const TASK_ACTIONS_BY_ID: Record<TaskActionId, TaskActionDescriptor> = TASK_ACTIONS.reduce(
  (acc, action) => {
    acc[action.id] = action;
    return acc;
  },
  {} as Record<TaskActionId, TaskActionDescriptor>
);

/** Returns the descriptor for an id, or undefined if unknown. */
export function getTaskAction(id: TaskActionId): TaskActionDescriptor | undefined {
  return TASK_ACTIONS_BY_ID[id];
}

/** True when the action must be confirmed before running (destructive or sensitive). */
export function needsConfirmation(action: TaskActionDescriptor): boolean {
  return Boolean(action.destructive || action.requiresConfirmation);
}
