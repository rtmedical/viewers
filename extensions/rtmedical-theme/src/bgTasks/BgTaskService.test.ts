import { BgTaskService, BG_TASKS_MAX, BgTaskEvent } from './BgTaskService';

describe('BgTaskService', () => {
  it('starts empty', () => {
    const svc = new BgTaskService();
    expect(svc.getTasks()).toEqual([]);
  });

  it('runs the start → update → complete lifecycle with sequential ids', () => {
    const svc = new BgTaskService();
    const id = svc.startTask({ kind: 'cine-export', label: 'Export Cine' }, '2026-01-01T10:00:00.000Z');
    expect(id).toBe('bgtask-1');
    expect(svc.startTask({ kind: 'upload', label: 'Upload' })).toBe('bgtask-2');

    let [second, first] = svc.getTasks();
    expect(first).toMatchObject({
      id: 'bgtask-1',
      kind: 'cine-export',
      label: 'Export Cine',
      status: 'running',
      startedAt: '2026-01-01T10:00:00.000Z',
    });
    expect(second.status).toBe('running');

    const updated = svc.updateTask(id, { progress: 40, detail: 'frame 48/120' });
    expect(updated).toMatchObject({ id, progress: 40, detail: 'frame 48/120' });

    const completed = svc.completeTask(id, { status: 'success', detail: 'video.mp4' }, '2026-01-01T10:01:00.000Z');
    expect(completed).toMatchObject({
      id,
      status: 'success',
      detail: 'video.mp4',
      completedAt: '2026-01-01T10:01:00.000Z',
    });
    [second, first] = svc.getTasks();
    expect(first.status).toBe('success');
    expect(second.status).toBe('running');
  });

  it('records error completions', () => {
    const svc = new BgTaskService();
    const id = svc.startTask({ kind: 'cine-export', label: 'Export Cine' });
    expect(svc.completeTask(id, { status: 'error', detail: 'aborted' })).toMatchObject({
      status: 'error',
      detail: 'aborted',
    });
  });

  it('broadcasts TASK_STARTED/UPDATED/COMPLETED with task + history snapshot', () => {
    const svc = new BgTaskService();
    const events: Array<{ name: string; payload: BgTaskEvent }> = [];
    const record = (name: string) => (payload: BgTaskEvent) => events.push({ name, payload });
    svc.subscribe(svc.EVENTS.TASK_STARTED, record('started'));
    svc.subscribe(svc.EVENTS.TASK_UPDATED, record('updated'));
    svc.subscribe(svc.EVENTS.TASK_COMPLETED, record('completed'));

    const id = svc.startTask({ kind: 'k', label: 'L' });
    svc.updateTask(id, { progress: 50 });
    svc.completeTask(id, { status: 'success' });

    expect(events.map(e => e.name)).toEqual(['started', 'updated', 'completed']);
    expect(events[0].payload.task).toMatchObject({ id, status: 'running' });
    expect(events[1].payload.task).toMatchObject({ id, progress: 50 });
    expect(events[2].payload.task).toMatchObject({ id, status: 'success' });
    expect(events[2].payload.tasks).toHaveLength(1);
  });

  it('unsubscribe stops the callback', () => {
    const svc = new BgTaskService();
    const seen: string[] = [];
    const sub = svc.subscribe(svc.EVENTS.TASK_STARTED, ({ task }) => seen.push(task.id));
    svc.startTask({ kind: 'k', label: 'a' });
    sub.unsubscribe();
    svc.startTask({ kind: 'k', label: 'b' });
    expect(seen).toEqual(['bgtask-1']);
  });

  it(`caps the history at ${BG_TASKS_MAX} (FIFO) and orders newest first`, () => {
    const svc = new BgTaskService();
    for (let i = 1; i <= BG_TASKS_MAX + 5; i++) {
      svc.startTask({ kind: 'k', label: `task ${i}` });
    }
    const tasks = svc.getTasks();
    expect(tasks).toHaveLength(BG_TASKS_MAX);
    // Newest first...
    expect(tasks[0].id).toBe(`bgtask-${BG_TASKS_MAX + 5}`);
    // ...and the 5 oldest fell off the end.
    expect(tasks[tasks.length - 1].id).toBe('bgtask-6');
    // Updates to an evicted task no-op.
    expect(svc.updateTask('bgtask-1', { progress: 10 })).toBeUndefined();
    expect(svc.completeTask('bgtask-1', { status: 'success' })).toBeUndefined();
  });

  it('no-ops on unknown ids and after completion (single-shot completion)', () => {
    const svc = new BgTaskService();
    const events: string[] = [];
    svc.subscribe(svc.EVENTS.TASK_UPDATED, () => events.push('updated'));
    svc.subscribe(svc.EVENTS.TASK_COMPLETED, () => events.push('completed'));

    expect(svc.updateTask('nope', { progress: 1 })).toBeUndefined();
    expect(svc.completeTask('nope', { status: 'success' })).toBeUndefined();

    const id = svc.startTask({ kind: 'k', label: 'L' });
    svc.completeTask(id, { status: 'success' });
    expect(svc.completeTask(id, { status: 'error' })).toBeUndefined();
    expect(svc.updateTask(id, { progress: 99 })).toBeUndefined();
    expect(events).toEqual(['completed']);
    expect(svc.getTasks()[0].status).toBe('success');
  });

  it('clamps progress to 0–100 and ignores non-finite values', () => {
    const svc = new BgTaskService();
    const id = svc.startTask({ kind: 'k', label: 'L' });
    expect(svc.updateTask(id, { progress: 150 })?.progress).toBe(100);
    expect(svc.updateTask(id, { progress: -5 })?.progress).toBe(0);
    expect(svc.updateTask(id, { progress: NaN })?.progress).toBe(0); // unchanged
  });

  it('uses the injected clock when no per-call now is given', () => {
    const svc = new BgTaskService(() => '2026-02-02T12:00:00.000Z');
    const id = svc.startTask({ kind: 'k', label: 'L' });
    expect(svc.getTasks()[0].startedAt).toBe('2026-02-02T12:00:00.000Z');
    // Per-call override wins over the injected clock.
    expect(svc.completeTask(id, { status: 'success' }, 'override')?.completedAt).toBe('override');
  });

  it('REGISTRATION.create wires a real ISO clock (the impure wrapper)', () => {
    expect(BgTaskService.REGISTRATION.name).toBe('rtmedicalBgTaskService');
    const svc = BgTaskService.REGISTRATION.create();
    svc.startTask({ kind: 'k', label: 'L' });
    expect(svc.getTasks()[0].startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('keeps the producer-registered onClick on getTasks copies', () => {
    const svc = new BgTaskService();
    const onClick = jest.fn();
    svc.startTask({ kind: 'k', label: 'L', onClick });
    svc.getTasks()[0].onClick?.();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
