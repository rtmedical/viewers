/**
 * WorklistQueueService (RTV-120) — framework-free, session-cached queue of the
 * studies in the current worklist, plus the cursor position. The next/prev
 * commands and (future) header buttons read from it; live population from the
 * data source / RIS worklist integrates in RTV-182.
 *
 * RTV-114: no @ohif/core|app|ui dependency — drops into the OHIF services
 * manager via REGISTRATION while staying unit-testable.
 */
export interface WorklistPosition {
  /** Zero-based cursor; -1 when the queue is empty/unknown. */
  index: number;
  total: number;
}

export interface WorklistQueueChangedEvent {
  position: WorklistPosition;
  queue: string[];
}

type EventCallback = (payload: WorklistQueueChangedEvent) => void;

export class WorklistQueueService {
  static readonly EVENTS = {
    QUEUE_CHANGED: 'event::rtmedical:worklist:changed',
  } as const;

  static readonly REGISTRATION = {
    name: 'rtmedicalWorklistQueueService',
    altName: 'WorklistQueueService',
    create: (): WorklistQueueService => new WorklistQueueService(),
  };

  readonly EVENTS = WorklistQueueService.EVENTS;

  private queue: string[] = [];
  private index = -1;
  private readonly listeners = new Map<string, Set<EventCallback>>();

  /** Replace the queue (dedup, drop falsy) and set the cursor to currentUID (or 0). */
  setQueue(studyUIDs: string[], currentUID?: string): void {
    this.queue = Array.from(new Set((studyUIDs || []).filter(Boolean)));
    if (currentUID) {
      this.index = this.queue.indexOf(currentUID);
    } else {
      this.index = this.queue.length ? 0 : -1;
    }
    this._broadcast();
  }

  /** Move the cursor to match the currently-open study, if it is in the queue. */
  syncCurrent(currentUID: string): void {
    const next = this.queue.indexOf(currentUID);
    if (next !== -1 && next !== this.index) {
      this.index = next;
      this._broadcast();
    }
  }

  getQueue(): string[] {
    return [...this.queue];
  }

  getCurrentIndex(): number {
    return this.index;
  }

  getNextStudyUID(): string | undefined {
    return this.index >= 0 && this.index < this.queue.length - 1
      ? this.queue[this.index + 1]
      : undefined;
  }

  getPrevStudyUID(): string | undefined {
    return this.index > 0 ? this.queue[this.index - 1] : undefined;
  }

  hasNext(): boolean {
    return this.getNextStudyUID() !== undefined;
  }

  hasPrev(): boolean {
    return this.getPrevStudyUID() !== undefined;
  }

  /** Position for a "3/15" indicator: human index is `index + 1`. */
  getPosition(): WorklistPosition {
    return { index: this.index, total: this.queue.length };
  }

  clear(): void {
    this.queue = [];
    this.index = -1;
    this._broadcast();
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

  _broadcast(): void {
    const set = this.listeners.get(this.EVENTS.QUEUE_CHANGED);
    if (!set) {
      return;
    }
    const payload: WorklistQueueChangedEvent = {
      position: this.getPosition(),
      queue: this.getQueue(),
    };
    for (const callback of Array.from(set)) {
      callback(payload);
    }
  }

  /** Queue is cached per session — surviving mode changes is intentional. */
  onModeExit(): void {
    /* keep cache */
  }
}

export default WorklistQueueService;
