import { KeyImageReference, KeyImageEvent } from './types';
import { getKeyImageId } from './keyImageId';

type Listener = (event: KeyImageEvent) => void;

/**
 * Framework-free, in-memory selection model for key images.
 *
 * Backs the OHIF panel/commands/service layers without depending on them, so
 * the selection semantics are unit-testable in isolation. Insertion order is
 * preserved (Map iteration order). Mutations emit exactly one event; no-op
 * mutations (re-adding a present ref, removing an absent one) emit nothing.
 */
export class KeyImageManager {
  private readonly items = new Map<string, KeyImageReference>();
  private readonly listeners = new Set<Listener>();

  /** Normalize a ref-or-id argument to its canonical id. */
  private toId(refOrId: KeyImageReference | string): string {
    return typeof refOrId === 'string' ? refOrId : getKeyImageId(refOrId);
  }

  private emit(event: KeyImageEvent): void {
    // Snapshot listeners so a handler that (un)subscribes mid-dispatch is safe.
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }

  /**
   * Add a reference. Returns true if newly added, false if already present.
   * First-add wins: re-adding an existing id does not overwrite its metadata.
   */
  add(ref: KeyImageReference): boolean {
    const id = getKeyImageId(ref);
    if (this.items.has(id)) {
      return false;
    }
    this.items.set(id, ref);
    this.emit({ type: 'added', id, ref, count: this.items.size });
    return true;
  }

  /** Remove by reference or id. Returns true if something was removed. */
  remove(refOrId: KeyImageReference | string): boolean {
    const id = this.toId(refOrId);
    if (!this.items.has(id)) {
      return false;
    }
    this.items.delete(id);
    this.emit({ type: 'removed', id, count: this.items.size });
    return true;
  }

  /**
   * Toggle membership. Returns the resulting state: true if now selected,
   * false if now de-selected.
   */
  toggle(ref: KeyImageReference): boolean {
    const id = getKeyImageId(ref);
    if (this.items.has(id)) {
      this.remove(id);
      return false;
    }
    this.add(ref);
    return true;
  }

  /** Whether a reference (or id) is currently selected. */
  has(refOrId: KeyImageReference | string): boolean {
    return this.items.has(this.toId(refOrId));
  }

  /** Look up the stored reference for an id, if any. */
  get(id: string): KeyImageReference | undefined {
    return this.items.get(id);
  }

  /** All selected references, in insertion order. */
  list(): KeyImageReference[] {
    return Array.from(this.items.values());
  }

  /** Number of selected references. */
  count(): number {
    return this.items.size;
  }

  /** Remove everything. Emits a single `cleared` event only if non-empty. */
  clear(): void {
    if (this.items.size === 0) {
      return;
    }
    this.items.clear();
    this.emit({ type: 'cleared', count: 0 });
  }

  /**
   * Subscribe to mutation events. Returns an unsubscribe handle (OHIF
   * convention) that is idempotent.
   */
  subscribe(listener: Listener): { unsubscribe: () => void } {
    this.listeners.add(listener);
    return {
      unsubscribe: () => {
        this.listeners.delete(listener);
      },
    };
  }
}
