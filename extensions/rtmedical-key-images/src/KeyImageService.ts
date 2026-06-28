import { KeyImageManager } from './KeyImageManager';
import { KeyImageEvent, KeyImageReference } from './types';

/**
 * Payload broadcast on {@link EVENTS.KEY_IMAGES_CHANGED}.
 *
 * Carries both the discrete change (so listeners can react to a single
 * add/remove/clear) and a snapshot of the full selection after it (so a panel
 * can re-render its list without re-querying the service).
 */
export interface KeyImagesChangedEvent {
  /** The discrete mutation emitted by the underlying selection model. */
  change: KeyImageEvent;
  /** All selected references after the change, in insertion order. */
  keyImages: KeyImageReference[];
}

/** Optional configuration accepted at service registration time. */
export interface KeyImageServiceConfiguration {
  /**
   * Clear the selection when the hosting mode is exited. Key images are a
   * per-session annotation, so the default is `true`; set `false` to persist
   * the selection across modes within a session.
   */
  clearOnModeExit?: boolean;
}

type EventCallback = (payload: KeyImagesChangedEvent) => void;

/**
 * OHIF v3 service wrapping the framework-free {@link KeyImageManager} (RTV-148).
 *
 * It is the single source of truth for the key-image selection at runtime: the
 * commands module mutates it, the panel reads it, and both react to its events.
 * Following the RTV-114 zero-fork policy it does not extend or import
 * `@ohif/core`'s `PubSubService`; instead it implements the same small surface
 * (`EVENTS`, `subscribe`, `_broadcastEvent`) so it drops into the OHIF services
 * manager via {@link KeyImageService.REGISTRATION} while staying unit-testable
 * in isolation.
 */
export class KeyImageService {
  /** Named events, following the OHIF `event::*` convention. */
  static readonly EVENTS = {
    KEY_IMAGES_CHANGED: 'event::rtmedical:keyImages:changed',
  } as const;

  /**
   * Registration descriptor consumed by `servicesManager.registerService(...)`
   * from the extension's `preRegistration` hook.
   */
  static readonly REGISTRATION = {
    name: 'rtmedicalKeyImageService',
    altName: 'KeyImageService',
    create: ({
      configuration = {},
    }: { configuration?: KeyImageServiceConfiguration } = {}): KeyImageService =>
      new KeyImageService(configuration),
  };

  /** Instance handle to the static event map (OHIF accesses it per-instance). */
  readonly EVENTS = KeyImageService.EVENTS;

  private readonly manager = new KeyImageManager();
  private readonly listeners = new Map<string, Set<EventCallback>>();
  private readonly clearOnModeExit: boolean;
  private managerSubscription?: { unsubscribe: () => void };

  constructor(configuration: KeyImageServiceConfiguration = {}) {
    this.clearOnModeExit = configuration.clearOnModeExit !== false;

    // Bridge the model's mutation events to the OHIF-facing named event,
    // attaching a snapshot of the resulting selection on every change.
    this.managerSubscription = this.manager.subscribe((change: KeyImageEvent) => {
      this._broadcastEvent(this.EVENTS.KEY_IMAGES_CHANGED, {
        change,
        keyImages: this.manager.list(),
      });
    });
  }

  // ---- Selection API (delegates to the model) ----------------------------

  /** Flag a reference as a key image. Returns true if newly added. */
  addKeyImage(ref: KeyImageReference): boolean {
    return this.manager.add(ref);
  }

  /** Remove a key image by reference or canonical id. */
  removeKeyImage(refOrId: KeyImageReference | string): boolean {
    return this.manager.remove(refOrId);
  }

  /** Toggle a reference. Returns the resulting selected state. */
  toggleKeyImage(ref: KeyImageReference): boolean {
    return this.manager.toggle(ref);
  }

  /** Whether a reference (or id) is currently selected. */
  hasKeyImage(refOrId: KeyImageReference | string): boolean {
    return this.manager.has(refOrId);
  }

  /** Look up the stored reference for a canonical id, if any. */
  getKeyImage(id: string): KeyImageReference | undefined {
    return this.manager.get(id);
  }

  /** All selected references, in insertion order. */
  getKeyImages(): KeyImageReference[] {
    return this.manager.list();
  }

  /** Number of selected references. */
  getCount(): number {
    return this.manager.count();
  }

  /** Clear the whole selection. */
  clearKeyImages(): void {
    this.manager.clear();
  }

  // ---- Pub/Sub (OHIF PubSubService-compatible surface) -------------------

  /**
   * Subscribe to a named event. Returns an idempotent unsubscribe handle,
   * matching the OHIF convention.
   */
  subscribe(eventName: string, callback: EventCallback): { unsubscribe: () => void } {
    let set = this.listeners.get(eventName);
    if (!set) {
      set = new Set<EventCallback>();
      this.listeners.set(eventName, set);
    }
    set.add(callback);
    return {
      unsubscribe: () => {
        set?.delete(callback);
      },
    };
  }

  /** Broadcast a payload to every subscriber of `eventName`. */
  _broadcastEvent(eventName: string, payload: KeyImagesChangedEvent): void {
    const set = this.listeners.get(eventName);
    if (!set) {
      return;
    }
    // Snapshot so a handler that (un)subscribes mid-dispatch is safe.
    for (const callback of Array.from(set)) {
      callback(payload);
    }
  }

  // ---- OHIF lifecycle hooks ----------------------------------------------

  /** Called by OHIF when a mode is exited; clears unless configured otherwise. */
  onModeExit(): void {
    if (this.clearOnModeExit) {
      this.manager.clear();
    }
  }

  /** Reset to the empty selection (OHIF services manager `reset`). */
  reset(): void {
    this.manager.clear();
  }

  /** Tear down the model bridge and drop all subscribers. */
  destroy(): void {
    this.managerSubscription?.unsubscribe();
    this.managerSubscription = undefined;
    this.listeners.clear();
  }
}

export default KeyImageService;
