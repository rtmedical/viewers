/**
 * Saved worklist views and quick-filter chips — pure core (RTV-187, RTV-186).
 *
 * A view is a named snapshot of *filters + visible columns + sort*. A chip is the same
 * thing pinned above the list. Modelling them as one type rather than two is
 * deliberate: "Urgentes" as a chip and "Urgentes" as a saved view are the same
 * intention, and keeping them separate would mean two editors, two storage shapes and
 * two ways for them to disagree.
 *
 * ## Persistence
 *
 * Everything goes through a small {@link ViewStore} adapter. The default is
 * localStorage, which makes the feature work today; swapping in the Connect endpoints
 * (`/api/worklist-views`) later is one implementation of the same three methods, with
 * no change to any logic here. That seam is the point — RTV-187 is blocked on backend
 * only for *sharing*, not for working.
 *
 * Framework-free. Zero-fork per RTV-114.
 */

import { emptyFilterGroup, FilterGroup, parseFilters, serializeFilters } from './worklistFilters';

export type ViewScope = 'user' | 'group' | 'system';

export interface SavedView {
  id: string;
  name: string;
  /** `system` views are read-only; `group` views are shared. */
  scope: ViewScope;
  filters: FilterGroup;
  /** Visible column ids, in order. Omitted means "whatever the profile says". */
  columns?: string[];
  sort?: { columnId: string; direction: 'asc' | 'desc' };
  /** Shown as a chip above the list (RTV-186). */
  pinned?: boolean;
  /** Ordering among the chips. */
  order?: number;
}

export const VIEWS_STORAGE_KEY = 'rt.worklistViews.v1';
export const VIEWS_SCHEMA_VERSION = 1;

/** Persistence seam: localStorage today, the Connect API later. */
export interface ViewStore {
  load(): SavedView[];
  save(views: SavedView[]): void;
}

/** Views an admin defines. Read-only, and always present. */
export const SYSTEM_VIEWS: SavedView[] = [
  {
    id: 'sys-unreported',
    name: 'Sem laudo',
    scope: 'system',
    pinned: true,
    order: 0,
    filters: {
      combinator: 'and',
      criteria: [{ field: 'reportStatus', operator: 'anyOf', value: ['none', 'draft'] }],
    },
  },
  {
    id: 'sys-urgent',
    name: 'Urgentes',
    scope: 'system',
    pinned: true,
    order: 1,
    filters: {
      combinator: 'and',
      criteria: [{ field: 'priority', operator: 'anyOf', value: ['urgent', 'emergency'] }],
    },
  },
  {
    id: 'sys-ct',
    name: 'CT',
    scope: 'system',
    pinned: true,
    order: 2,
    filters: {
      combinator: 'and',
      criteria: [{ field: 'modality', operator: 'anyOf', value: ['ct'] }],
    },
  },
  {
    id: 'sys-mr',
    name: 'MR',
    scope: 'system',
    pinned: true,
    order: 3,
    filters: {
      combinator: 'and',
      criteria: [{ field: 'modality', operator: 'anyOf', value: ['mr'] }],
    },
  },
];

function slug(name: string): string {
  return (
    String(name ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'view'
  );
}

/**
 * Sanitises one stored view, or returns null.
 *
 * Storage is shared with every other app on the origin and survives upgrades, so a
 * malformed entry is dropped rather than trusted. A stored view claiming
 * `scope: 'system'` is demoted to `user`: system views come from the admin list, and
 * letting localStorage mint one would make a hand-edited entry undeletable.
 */
export function sanitizeView(raw: unknown): SavedView | null {
  const candidate = raw as Partial<SavedView> | null;
  const id = typeof candidate?.id === 'string' ? candidate.id.trim() : '';
  const name = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
  if (!id || !name) {
    return null;
  }
  const scope: ViewScope = candidate?.scope === 'group' ? 'group' : 'user';
  const filters =
    candidate?.filters && Array.isArray((candidate.filters as FilterGroup).criteria)
      ? (candidate.filters as FilterGroup)
      : parseFilters(candidate?.filters as never);

  return {
    id,
    name,
    scope,
    filters: filters ?? emptyFilterGroup(),
    columns: Array.isArray(candidate?.columns)
      ? candidate.columns.filter(c => typeof c === 'string')
      : undefined,
    sort:
      candidate?.sort && typeof candidate.sort.columnId === 'string'
        ? {
            columnId: candidate.sort.columnId,
            direction: candidate.sort.direction === 'desc' ? 'desc' : 'asc',
          }
        : undefined,
    pinned: candidate?.pinned === true,
    order: Number.isFinite(Number(candidate?.order)) ? Number(candidate.order) : undefined,
  };
}

/** A localStorage-backed store. Falls back to in-memory when storage is unavailable. */
export function createLocalViewStore(storage?: Storage): ViewStore {
  let memory: SavedView[] = [];
  const resolve = (): Storage | null => {
    try {
      return storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    } catch {
      return null;
    }
  };

  return {
    load(): SavedView[] {
      const target = resolve();
      if (!target) {
        return memory;
      }
      try {
        const parsed = JSON.parse(target.getItem(VIEWS_STORAGE_KEY) ?? '');
        if (!parsed || parsed.version !== VIEWS_SCHEMA_VERSION || !Array.isArray(parsed.views)) {
          return [];
        }
        return parsed.views.map(sanitizeView).filter(Boolean) as SavedView[];
      } catch {
        return [];
      }
    },
    save(views: SavedView[]): void {
      memory = views;
      const target = resolve();
      try {
        target?.setItem(
          VIEWS_STORAGE_KEY,
          JSON.stringify({ version: VIEWS_SCHEMA_VERSION, views })
        );
      } catch {
        // A full quota must not stop the reader from filtering.
      }
    },
  };
}

export interface ViewsResult {
  ok: boolean;
  reason?: string;
  views?: SavedView[];
  view?: SavedView;
}

/**
 * The view collection: system views first, then the stored ones.
 *
 * System views are never persisted, so an admin changing the list changes it for
 * everyone immediately rather than fighting stale copies in every browser.
 */
export function listViews(store: ViewStore): SavedView[] {
  const stored = store?.load?.() ?? [];
  return [...SYSTEM_VIEWS, ...stored.filter(v => v.scope !== 'system')];
}

/** Views pinned as chips, in order (RTV-186). */
export function listChips(store: ViewStore): SavedView[] {
  return listViews(store)
    .filter(v => v.pinned)
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
}

/** Saves a new view, or replaces one by id. System views cannot be overwritten. */
export function saveView(store: ViewStore, view: Partial<SavedView>): ViewsResult {
  const name = String(view?.name ?? '').trim();
  if (!name) {
    return { ok: false, reason: 'A view needs a name.' };
  }
  const id = String(view?.id ?? '').trim() || `${slug(name)}-${(store.load() ?? []).length + 1}`;
  if (SYSTEM_VIEWS.some(v => v.id === id)) {
    return { ok: false, reason: 'System views are read-only.' };
  }

  const sanitized = sanitizeView({ ...view, id, name });
  if (!sanitized) {
    return { ok: false, reason: 'The view could not be saved.' };
  }

  const stored = store.load().filter(v => v.id !== id);
  const views = [...stored, sanitized];
  store.save(views);
  return { ok: true, view: sanitized, views };
}

export function deleteView(store: ViewStore, id: string): ViewsResult {
  if (SYSTEM_VIEWS.some(v => v.id === id)) {
    return { ok: false, reason: 'System views cannot be deleted.' };
  }
  const stored = store.load();
  const views = stored.filter(v => v.id !== id);
  if (views.length === stored.length) {
    return { ok: false, reason: `No view with id ${id}.` };
  }
  store.save(views);
  return { ok: true, views };
}

/** Pins or unpins a view as a chip. */
export function setPinned(store: ViewStore, id: string, pinned: boolean): ViewsResult {
  const view = listViews(store).find(v => v.id === id);
  if (!view) {
    return { ok: false, reason: `No view with id ${id}.` };
  }
  if (view.scope === 'system') {
    return { ok: false, reason: 'System views are read-only.' };
  }
  return saveView(store, { ...view, pinned });
}

/** Reorders the chips to the given id order. Unknown ids are ignored. */
export function reorderChips(store: ViewStore, orderedIds: string[]): ViewsResult {
  const stored = store.load();
  const position = new Map((orderedIds ?? []).map((id, index) => [id, index]));
  const views = stored.map(v =>
    position.has(v.id) ? { ...v, order: position.get(v.id) } : v
  );
  store.save(views);
  return { ok: true, views };
}

/**
 * Whether the active state still matches the view it was activated from (RTV-187's
 * "modified" asterisk).
 *
 * Compared through the serialised filter string rather than deep equality, so criteria
 * added in a different order still count as the same filter.
 */
export function isViewModified(view: SavedView | null | undefined, active: FilterGroup): boolean {
  if (!view) {
    return false;
  }
  return serializeFilters(view.filters) !== serializeFilters(active ?? emptyFilterGroup());
}

/** The active state to apply when a view is selected. */
export function applyView(view: SavedView): {
  filters: FilterGroup;
  columns?: string[];
  sort?: SavedView['sort'];
} {
  return {
    filters: view?.filters ?? emptyFilterGroup(),
    columns: view?.columns,
    sort: view?.sort,
  };
}
