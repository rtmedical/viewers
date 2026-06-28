import { WorklistQueueService } from './WorklistQueueService';

const uids = ['s1', 's2', 's3'];

describe('WorklistQueueService', () => {
  it('starts empty', () => {
    const svc = new WorklistQueueService();
    expect(svc.getPosition()).toEqual({ index: -1, total: 0 });
    expect(svc.hasNext()).toBe(false);
    expect(svc.hasPrev()).toBe(false);
  });

  it('dedups + drops falsy and defaults the cursor to the first study', () => {
    const svc = new WorklistQueueService();
    svc.setQueue(['s1', 's1', '', 's2', undefined as unknown as string]);
    expect(svc.getQueue()).toEqual(['s1', 's2']);
    expect(svc.getPosition()).toEqual({ index: 0, total: 2 });
  });

  it('positions the cursor on the provided current study', () => {
    const svc = new WorklistQueueService();
    svc.setQueue(uids, 's2');
    expect(svc.getCurrentIndex()).toBe(1);
    expect(svc.getPrevStudyUID()).toBe('s1');
    expect(svc.getNextStudyUID()).toBe('s3');
  });

  it('reports no next/prev at the ends', () => {
    const svc = new WorklistQueueService();
    svc.setQueue(uids, 's1');
    expect(svc.hasPrev()).toBe(false);
    expect(svc.getPrevStudyUID()).toBeUndefined();
    svc.setQueue(uids, 's3');
    expect(svc.hasNext()).toBe(false);
    expect(svc.getNextStudyUID()).toBeUndefined();
  });

  it('syncCurrent moves the cursor and notifies subscribers', () => {
    const svc = new WorklistQueueService();
    svc.setQueue(uids, 's1');
    const events: number[] = [];
    const sub = svc.subscribe(svc.EVENTS.QUEUE_CHANGED, p => events.push(p.position.index));
    svc.syncCurrent('s3');
    expect(svc.getCurrentIndex()).toBe(2);
    expect(events).toEqual([2]);
    svc.syncCurrent('not-in-queue');
    expect(events).toEqual([2]); // no spurious event
    sub.unsubscribe();
  });

  it('clears the queue', () => {
    const svc = new WorklistQueueService();
    svc.setQueue(uids, 's2');
    svc.clear();
    expect(svc.getPosition()).toEqual({ index: -1, total: 0 });
  });
});
