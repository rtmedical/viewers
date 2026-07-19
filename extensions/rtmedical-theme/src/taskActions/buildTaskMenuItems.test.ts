import { buildTaskMenuItems } from './buildTaskMenuItems';
import { createAuditLogger } from './auditLog';
import type { UserPermissions } from './types';

const RADIOLOGIST: UserPermissions = {
  permissions: ['study:export', 'study:import', 'report:write'],
};

describe('buildTaskMenuItems', () => {
  it('only surfaces actions that have a wired handler', () => {
    const items = buildTaskMenuItems({
      handlers: { export: () => undefined },
      user: { permissions: ['*'] },
    });
    expect(items.map(i => i.id)).toEqual(['export']);
  });

  it('hides actions the user lacks permission for (default)', () => {
    const items = buildTaskMenuItems({
      handlers: { export: () => undefined, deleteStudy: () => undefined },
      user: RADIOLOGIST,
    });
    expect(items.map(i => i.id)).toEqual(['export']);
  });

  it('disables (instead of hiding) unauthorized actions when asked', () => {
    const items = buildTaskMenuItems({
      handlers: { export: () => undefined, deleteStudy: () => undefined },
      user: RADIOLOGIST,
      unauthorized: 'disable',
    });
    expect(items.map(i => i.id)).toEqual(['export', 'deleteStudy']);
    expect(items.find(i => i.id === 'deleteStudy')?.disabled).toBe(true);
    expect(items.find(i => i.id === 'export')?.disabled).toBeUndefined();
  });

  it('audits a denied attempt (and never runs the handler) on a disabled item', () => {
    const audit = createAuditLogger({ now: () => 1 });
    const run = jest.fn();
    const items = buildTaskMenuItems({
      handlers: { deleteStudy: run },
      user: RADIOLOGIST,
      unauthorized: 'disable',
      audit,
      actor: 'rad1',
    });
    const deleteItem = items.find(i => i.id === 'deleteStudy');
    expect(deleteItem?.disabled).toBe(true);
    deleteItem?.onClick();
    expect(run).not.toHaveBeenCalled();
    expect(audit.getEntries()).toEqual([
      { action: 'deleteStudy', actor: 'rad1', status: 'denied', detail: undefined, timestamp: 1 },
    ]);
  });

  it('runs a non-destructive handler and audits invoked + completed', async () => {
    const audit = createAuditLogger({ now: () => 1 });
    const run = jest.fn();
    const items = buildTaskMenuItems({
      handlers: { export: run },
      user: RADIOLOGIST,
      audit,
      actor: 'rad1',
    });
    await items[0].onClick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(audit.getEntries().map(e => e.status)).toEqual(['invoked', 'completed']);
    expect(audit.getEntries()[0].actor).toBe('rad1');
  });

  it('runs a destructive action only after confirmation', async () => {
    const audit = createAuditLogger({ now: () => 1 });
    const run = jest.fn();
    const items = buildTaskMenuItems({
      handlers: { deleteStudy: run },
      user: { roles: ['admin'] },
      confirm: () => true,
      audit,
    });
    await items[0].onClick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(audit.getEntries().map(e => e.status)).toEqual(['invoked', 'completed']);
  });

  it('cancels a destructive action when confirmation is declined', async () => {
    const audit = createAuditLogger({ now: () => 1 });
    const run = jest.fn();
    const items = buildTaskMenuItems({
      handlers: { deleteStudy: run },
      user: { roles: ['admin'] },
      confirm: () => false,
      audit,
    });
    await items[0].onClick();
    expect(run).not.toHaveBeenCalled();
    expect(audit.getEntries().map(e => e.status)).toEqual(['cancelled']);
  });

  it('fails safe: a confirm-required action with no confirm handler is cancelled', async () => {
    const audit = createAuditLogger({ now: () => 1 });
    const run = jest.fn();
    const items = buildTaskMenuItems({
      handlers: { deleteStudy: run },
      user: { roles: ['admin'] },
      audit,
    });
    await items[0].onClick();
    expect(run).not.toHaveBeenCalled();
    const entry = audit.getEntries()[0];
    expect(entry.status).toBe('cancelled');
    expect(entry.detail).toBe('no confirm handler');
  });

  it('audits an error when the handler throws', async () => {
    const audit = createAuditLogger({ now: () => 1 });
    const items = buildTaskMenuItems({
      handlers: {
        export: () => {
          throw new Error('boom');
        },
      },
      user: { permissions: ['*'] },
      audit,
    });
    await items[0].onClick();
    const statuses = audit.getEntries().map(e => e.status);
    expect(statuses).toEqual(['invoked', 'error']);
    expect(audit.getEntries()[1].detail).toBe('boom');
  });

  it('awaits async handler rejection and records it as an error', async () => {
    const audit = createAuditLogger({ now: () => 1 });
    const items = buildTaskMenuItems({
      handlers: { export: () => Promise.reject(new Error('async boom')) },
      user: { permissions: ['*'] },
      audit,
    });
    await items[0].onClick();
    expect(audit.getEntries()[1].status).toBe('error');
    expect(audit.getEntries()[1].detail).toBe('async boom');
  });

  it('an admin sees every wired action', () => {
    const items = buildTaskMenuItems({
      handlers: {
        export: () => undefined,
        deleteStudy: () => undefined,
        changePatientInfo: () => undefined,
      },
      user: { roles: ['admin'] },
    });
    expect(items.map(i => i.id)).toEqual(['export', 'changePatientInfo', 'deleteStudy']);
  });
});
