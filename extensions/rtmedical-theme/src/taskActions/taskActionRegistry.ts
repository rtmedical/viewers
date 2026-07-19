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
    label: 'Exportar estudo',
    requiredPermissions: ['study:export'],
  },
  {
    id: 'import',
    label: 'Importar arquivos',
    requiredPermissions: ['study:import'],
  },
  {
    id: 'updateCalibration',
    label: 'Atualizar calibração',
    requiredPermissions: ['image:calibrate'],
  },
  {
    id: 'saveReport',
    label: 'Salvar laudo',
    requiredPermissions: ['report:write'],
  },
  {
    id: 'generateKeyImages',
    label: 'Gerar imagens-chave',
    requiredPermissions: ['keyimage:create'],
  },
  {
    id: 'changePatientInfo',
    label: 'Alterar dados do paciente',
    requiredPermissions: ['patient:edit'],
    // Non-destructive but sensitive: edits patient demographics → confirm first.
    requiresConfirmation: true,
  },
  {
    id: 'deleteStudy',
    label: 'Excluir estudo',
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
