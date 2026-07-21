/**
 * RTV-159 — BgTasksPanel behaviour: renders the BgTaskService history (newest
 * first), live-updates via the TASK_* pub-sub events, shows the inline
 * progress bar only while running, and clicking a row runs the producer's
 * onClick (no-op when absent). i18n is mocked so the test is hermetic.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { BgTaskService } from './BgTaskService';
import BgTasksPanel from './BgTasksPanel';

const renderPanel = (svc?: BgTaskService) =>
  render(
    <BgTasksPanel
      servicesManager={{ services: svc ? { rtmedicalBgTaskService: svc } : {} }}
    />
  );

/** The panel exposes Playwright hooks via data-cy (repo convention). */
const items = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-cy="rt-bgtask-item"]'));
const progressBar = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-cy="rt-bgtask-progress"]');

describe('BgTasksPanel', () => {
  it('shows the empty state (and survives a missing service)', () => {
    const { container } = renderPanel(undefined);
    expect(screen.getByText('bgtask_empty')).toBeDefined();
    expect(container.querySelector('[data-cy="rt-bgtasks-panel"]')).not.toBeNull();
  });

  it('lists tasks newest first with status + detail and live-updates on events', () => {
    const svc = new BgTaskService(() => '2026-01-01T10:00:00.000Z');
    svc.startTask({ kind: 'k', label: 'First task' });
    const { container } = renderPanel(svc);

    expect(items(container)).toHaveLength(1);

    let id2 = '';
    act(() => {
      id2 = svc.startTask({ kind: 'k', label: 'Second task' });
    });
    const rows = items(container);
    expect(rows).toHaveLength(2);
    // Newest first.
    expect(rows[0].textContent).toContain('Second task');
    expect(rows[1].textContent).toContain('First task');

    act(() => {
      svc.updateTask(id2, { progress: 40, detail: 'frame 48/120' });
    });
    expect(screen.getByText('frame 48/120')).toBeDefined();
    expect(progressBar(container)?.style.width).toBe('40%');

    act(() => {
      svc.completeTask(id2, { status: 'error', detail: 'aborted' });
    });
    // Completed → no determinate progress bar; error status label shown.
    expect(progressBar(container)).toBeNull();
    expect(screen.getByText('bgtask_error')).toBeDefined();
    expect(screen.getByText('aborted')).toBeDefined();
  });

  it('clicking a row runs the registered onClick and no-ops without one', () => {
    const svc = new BgTaskService();
    const onClick = jest.fn();
    svc.startTask({ kind: 'k', label: 'No action' });
    svc.startTask({ kind: 'k', label: 'With action', onClick });
    const { container } = renderPanel(svc);

    const [withAction, noAction] = items(container);
    fireEvent.click(withAction);
    expect(onClick).toHaveBeenCalledTimes(1);
    // Documented no-op: no task page exists; nothing throws.
    expect(() => fireEvent.click(noAction)).not.toThrow();
  });

  it('unsubscribes on unmount', () => {
    const svc = new BgTaskService();
    const { unmount } = renderPanel(svc);
    unmount();
    // No React "update on unmounted component" warnings / throws.
    expect(() => svc.startTask({ kind: 'k', label: 'after unmount' })).not.toThrow();
  });
});
