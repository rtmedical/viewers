import { createAuditLogger } from './auditLog';
import type { AuditEntry } from './types';

describe('createAuditLogger', () => {
  it('stamps entries using the injected clock', () => {
    let t = 1000;
    const logger = createAuditLogger({ now: () => t });
    logger.log({ action: 'export', actor: 'rad1', status: 'invoked' });
    t = 2000;
    logger.log({ action: 'export', actor: 'rad1', status: 'completed' });

    const entries = logger.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].timestamp).toBe(1000);
    expect(entries[1].timestamp).toBe(2000);
  });

  it('honors an explicit timestamp', () => {
    const logger = createAuditLogger({ now: () => 999 });
    const entry = logger.log({ action: 'export', actor: 'a', status: 'invoked', timestamp: 42 });
    expect(entry.timestamp).toBe(42);
  });

  it('forwards every entry to the sink', () => {
    const received: AuditEntry[] = [];
    const logger = createAuditLogger({ now: () => 1, sink: e => received.push(e) });
    logger.log({ action: 'deleteStudy', actor: 'admin', status: 'completed' });
    expect(received).toHaveLength(1);
    expect(received[0].action).toBe('deleteStudy');
  });

  it('never lets a throwing sink break logging', () => {
    const logger = createAuditLogger({
      now: () => 1,
      sink: () => {
        throw new Error('network down');
      },
    });
    expect(() => logger.log({ action: 'export', actor: 'a', status: 'invoked' })).not.toThrow();
    expect(logger.getEntries()).toHaveLength(1);
  });

  it('bounds the buffer to capacity (drops oldest)', () => {
    const logger = createAuditLogger({ now: () => 1, capacity: 3 });
    for (let i = 0; i < 5; i += 1) {
      logger.log({ action: 'export', actor: 'a', status: 'invoked', detail: String(i) });
    }
    const details = logger.getEntries().map(e => e.detail);
    expect(details).toEqual(['2', '3', '4']);
  });

  it('clear() empties the buffer', () => {
    const logger = createAuditLogger({ now: () => 1 });
    logger.log({ action: 'export', actor: 'a', status: 'invoked' });
    logger.clear();
    expect(logger.getEntries()).toHaveLength(0);
  });

  it('getEntries returns a copy (callers cannot mutate internal state)', () => {
    const logger = createAuditLogger({ now: () => 1 });
    logger.log({ action: 'export', actor: 'a', status: 'invoked' });
    logger.getEntries().push({ action: 'import', actor: 'x', status: 'invoked', timestamp: 0 });
    expect(logger.getEntries()).toHaveLength(1);
  });
});
