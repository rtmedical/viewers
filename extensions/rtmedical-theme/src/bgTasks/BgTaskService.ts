/**
 * BgTaskService (RTV-159) — framework-free, session-cached registry of
 * client-side background tasks (cine/3D video exports, SC/SR/KOS stores,
 * DICOM uploads…). Producers call startTask/updateTask/completeTask; the
 * pub-sub event stream drives the per-task toasts (wireBgTaskToasts) and the
 * history panel (BgTasksPanel).
 *
 * RTV-114: no @ohif/core|app|ui dependency — drops into the OHIF services
 * manager via REGISTRATION while staying unit-testable. The core is PURE:
 * ids derive from a per-instance counter and timestamps come from either the
 * per-call `now` override or the injected `nowProvider`. The only impure line
 * is REGISTRATION.create, which injects `() => new Date().toISOString()`.
 */

export type BgTaskStatus = 'running' | 'success' | 'error';

export interface BgTaskStartOptions {
  /** Machine-readable task family, e.g. 'cine-export', 'dicom-upload'. */
  kind: string;
  /** Human-readable name shown in toasts and the history panel. */
  label: string;
  /** Optional initial detail line (panel subtitle / toast message). */
  detail?: string;
  /**
   * Optional click action for the panel row. There is no per-task page in the
   * viewer, so a task without an onClick renders as a documented no-op click;
   * producers that DO have a target (e.g. re-download) plug it in here.
   */
  onClick?: () => void;
}

export interface BgTaskUpdate {
  /** Percentage 0–100 (clamped); omit to keep the current value. */
  progress?: number;
  detail?: string;
}

export interface BgTaskResult {
  status: 'success' | 'error';
  detail?: string;
}

export interface BgTask {
  id: string;
  kind: string;
  label: string;
  status: BgTaskStatus;
  /** Percentage 0–100 while running; producers report it via updateTask. */
  progress?: number;
  detail?: string;
  /** ISO-8601 timestamps (from the injected clock / per-call override). */
  startedAt?: string;
  completedAt?: string;
  onClick?: () => void;
}

export interface BgTaskEvent {
  /** Snapshot copy of the task the event is about. */
  task: BgTask;
  /** Full history snapshot (newest first, capped) for cheap re-renders. */
  tasks: BgTask[];
}

type EventCallback = (payload: BgTaskEvent) => void;

/** History cap — the oldest task is dropped (FIFO) past this many. */
export const BG_TASKS_MAX = 50;

export class BgTaskService {
  static readonly EVENTS = {
    TASK_STARTED: 'event::rtmedical:bgtask:started',
    TASK_UPDATED: 'event::rtmedical:bgtask:updated',
    TASK_COMPLETED: 'event::rtmedical:bgtask:completed',
  } as const;

  static readonly REGISTRATION = {
    name: 'rtmedicalBgTaskService',
    altName: 'BgTaskService',
    /** Impure wrapper: injects the real wall clock into the pure core. */
    create: (): BgTaskService => new BgTaskService(() => new Date().toISOString()),
  };

  readonly EVENTS = BgTaskService.EVENTS;

  /** Newest first; index 0 is the most recent task. */
  private tasks: BgTask[] = [];
  private counter = 0;
  private readonly listeners = new Map<string, Set<EventCallback>>();

  constructor(private readonly nowProvider?: () => string) {}

  /**
   * Register a new running task and broadcast TASK_STARTED.
   * Returns the sequential task id ('bgtask-<n>').
   */
  startTask(options: BgTaskStartOptions, now?: string): string {
    const id = `bgtask-${++this.counter}`;
    const task: BgTask = {
      id,
      kind: options.kind,
      label: options.label,
      status: 'running',
      detail: options.detail,
      startedAt: this._resolveNow(now),
      onClick: options.onClick,
    };
    this.tasks.unshift(task);
    if (this.tasks.length > BG_TASKS_MAX) {
      // FIFO cap: the oldest task falls off; late updates to it no-op.
      this.tasks.pop();
    }
    this._broadcastEvent(this.EVENTS.TASK_STARTED, task);
    return id;
  }

  /**
   * Report progress/detail on a RUNNING task and broadcast TASK_UPDATED.
   * Unknown ids (never started or evicted by the cap) and tasks that already
   * completed no-op and return undefined.
   */
  updateTask(id: string, changes: BgTaskUpdate = {}): BgTask | undefined {
    const task = this.tasks.find(t => t.id === id);
    if (!task || task.status !== 'running') {
      return undefined;
    }
    if (typeof changes.progress === 'number' && Number.isFinite(changes.progress)) {
      task.progress = Math.min(100, Math.max(0, changes.progress));
    }
    if (changes.detail !== undefined) {
      task.detail = changes.detail;
    }
    this._broadcastEvent(this.EVENTS.TASK_UPDATED, task);
    return { ...task };
  }

  /**
   * Finish a RUNNING task as success|error and broadcast TASK_COMPLETED.
   * Completing twice (or an unknown/evicted id) no-ops — this keeps the
   * per-task completion toast single-shot by construction.
   */
  completeTask(id: string, result: BgTaskResult, now?: string): BgTask | undefined {
    const task = this.tasks.find(t => t.id === id);
    if (!task || task.status !== 'running') {
      return undefined;
    }
    task.status = result.status;
    if (result.detail !== undefined) {
      task.detail = result.detail;
    }
    task.completedAt = this._resolveNow(now);
    this._broadcastEvent(this.EVENTS.TASK_COMPLETED, task);
    return { ...task };
  }

  /** History snapshot: newest first, capped at BG_TASKS_MAX, shallow copies. */
  getTasks(): BgTask[] {
    return this.tasks.map(task => ({ ...task }));
  }

  subscribe(eventName: string, callback: EventCallback): { unsubscribe: () => void } {
    let set = this.listeners.get(eventName);
    if (!set) {
      set = new Set();
      this.listeners.set(eventName, set);
    }
    set.add(callback);
    return {
      unsubscribe: () => {
        this.listeners.get(eventName)?.delete(callback);
      },
    };
  }

  _broadcastEvent(eventName: string, task: BgTask): void {
    const set = this.listeners.get(eventName);
    if (!set) {
      return;
    }
    const payload: BgTaskEvent = { task: { ...task }, tasks: this.getTasks() };
    for (const callback of Array.from(set)) {
      callback(payload);
    }
  }

  /** Per-call override wins; otherwise the injected clock (if any). */
  private _resolveNow(now?: string): string | undefined {
    return now ?? this.nowProvider?.();
  }

  /** Task history is cached per session — surviving mode changes is intentional. */
  onModeExit(): void {
    /* keep cache */
  }
}

export default BgTaskService;
