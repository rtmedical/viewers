import { BgTaskService } from './BgTaskService';
import { wireBgTaskToasts } from './wireBgTaskToasts';

describe('wireBgTaskToasts', () => {
  const setup = () => {
    const svc = new BgTaskService();
    const show = jest.fn();
    const teardown = wireBgTaskToasts(svc, { show });
    return { svc, show, teardown };
  };

  it('shows an info toast on TASK_STARTED titled with the label', () => {
    const { svc, show } = setup();
    svc.startTask({ kind: 'cine-export', label: 'Export Cine' });
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info', title: 'Export Cine' })
    );
  });

  it('shows a success toast on successful completion (detail as message)', () => {
    const { svc, show } = setup();
    const id = svc.startTask({ kind: 'k', label: 'Export Cine' });
    show.mockClear();
    svc.completeTask(id, { status: 'success', detail: 'MP4: video.mp4' });
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', title: 'Export Cine', message: 'MP4: video.mp4' })
    );
  });

  it('shows an error toast on failed completion', () => {
    const { svc, show } = setup();
    const id = svc.startTask({ kind: 'k', label: 'Export 3D Spin' });
    show.mockClear();
    svc.completeTask(id, { status: 'error' });
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', title: 'Export 3D Spin' })
    );
  });

  it('does not toast TASK_UPDATED (progress stays in the panel)', () => {
    const { svc, show } = setup();
    const id = svc.startTask({ kind: 'k', label: 'L' });
    show.mockClear();
    svc.updateTask(id, { progress: 50 });
    expect(show).not.toHaveBeenCalled();
  });

  it('teardown unsubscribes both listeners', () => {
    const { svc, show, teardown } = setup();
    teardown();
    const id = svc.startTask({ kind: 'k', label: 'L' });
    svc.completeTask(id, { status: 'success' });
    expect(show).not.toHaveBeenCalled();
  });

  it('a throwing notification service never breaks the producing task', () => {
    const svc = new BgTaskService();
    wireBgTaskToasts(svc, {
      show: () => {
        throw new Error('toast boom');
      },
    });
    expect(() => {
      const id = svc.startTask({ kind: 'k', label: 'L' });
      svc.completeTask(id, { status: 'success' });
    }).not.toThrow();
    expect(svc.getTasks()[0].status).toBe('success');
  });
});
