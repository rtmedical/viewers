import {
  TASK_ACTIONS,
  TASK_ACTIONS_BY_ID,
  getTaskAction,
  needsConfirmation,
} from './taskActionRegistry';

describe('taskActionRegistry', () => {
  it('defines exactly the 7 RTV-154 actions with unique ids', () => {
    expect(TASK_ACTIONS).toHaveLength(7);
    const ids = TASK_ACTIONS.map(a => a.id);
    expect(new Set(ids).size).toBe(7);
    expect(ids).toEqual([
      'export',
      'import',
      'updateCalibration',
      'saveReport',
      'generateKeyImages',
      'changePatientInfo',
      'deleteStudy',
    ]);
  });

  it('gives every action a label and at least one required permission', () => {
    for (const action of TASK_ACTIONS) {
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.requiredPermissions.length).toBeGreaterThan(0);
    }
  });

  it('flags deleteStudy as destructive and changePatientInfo as confirm-required', () => {
    expect(getTaskAction('deleteStudy')?.destructive).toBe(true);
    expect(getTaskAction('changePatientInfo')?.requiresConfirmation).toBe(true);
  });

  it('needsConfirmation is true only for destructive or confirm-required actions', () => {
    expect(needsConfirmation(TASK_ACTIONS_BY_ID.deleteStudy)).toBe(true);
    expect(needsConfirmation(TASK_ACTIONS_BY_ID.changePatientInfo)).toBe(true);
    expect(needsConfirmation(TASK_ACTIONS_BY_ID.export)).toBe(false);
  });

  it('getTaskAction returns the descriptor or undefined', () => {
    expect(getTaskAction('export')?.id).toBe('export');
    // @ts-expect-error — unknown id is rejected at compile time, undefined at runtime.
    expect(getTaskAction('nope')).toBeUndefined();
  });
});
