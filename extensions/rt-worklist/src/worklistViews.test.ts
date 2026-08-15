import { emptyFilterGroup, FilterGroup, upsertCriterion } from './worklistFilters';
import {
  applyView,
  createLocalViewStore,
  deleteView,
  isViewModified,
  listChips,
  listViews,
  reorderChips,
  sanitizeView,
  saveView,
  setPinned,
  SYSTEM_VIEWS,
  ViewStore,
  VIEWS_SCHEMA_VERSION,
  VIEWS_STORAGE_KEY,
} from './worklistViews';

/** An in-memory store, so the tests do not depend on jsdom storage semantics. */
function memoryStore(initial: any[] = []): ViewStore {
  let views = [...initial];
  return {
    load: () => views.map(v => ({ ...v })),
    save: next => {
      views = next.map(v => ({ ...v }));
    },
  };
}

const ctFilter = (): FilterGroup =>
  upsertCriterion(emptyFilterGroup(), { field: 'modality', operator: 'anyOf', value: ['ct'] });

describe('system views', () => {
  it('are always present and read-only', () => {
    const store = memoryStore();
    const views = listViews(store);
    for (const sys of SYSTEM_VIEWS) {
      expect(views.find(v => v.id === sys.id)).toBeDefined();
    }
    expect(saveView(store, { id: 'sys-urgent', name: 'Hijack' }).ok).toBe(false);
    expect(deleteView(store, 'sys-urgent').ok).toBe(false);
    expect(setPinned(store, 'sys-urgent', false).ok).toBe(false);
  });

  it('are never persisted, so an admin change reaches everyone', () => {
    // A stored copy would fight the admin list forever.
    const store = memoryStore();
    saveView(store, { name: 'Mine', filters: ctFilter() });
    expect(store.load().some(v => v.scope === 'system')).toBe(false);
  });

  it('ship pinned as chips, in order', () => {
    const chips = listChips(memoryStore());
    expect(chips.length).toBeGreaterThanOrEqual(4);
    expect(chips.map(c => c.order)).toEqual([...chips.map(c => c.order)].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });
});

describe('saveView', () => {
  it('saves and lists a user view', () => {
    const store = memoryStore();
    const result = saveView(store, { name: 'Meus CTs', filters: ctFilter() });
    expect(result.ok).toBe(true);
    expect(result.view?.scope).toBe('user');
    expect(listViews(store).some(v => v.name === 'Meus CTs')).toBe(true);
  });

  it('requires a name', () => {
    expect(saveView(memoryStore(), { name: '   ' }).ok).toBe(false);
  });

  it('replaces by id rather than duplicating', () => {
    const store = memoryStore();
    const first = saveView(store, { name: 'A', filters: ctFilter() }).view!;
    saveView(store, { ...first, name: 'A renamed' });
    const mine = store.load();
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe('A renamed');
  });

  it('keeps columns and sort with the view', () => {
    const store = memoryStore();
    const view = saveView(store, {
      name: 'Com colunas',
      filters: ctFilter(),
      columns: ['patient', 'date'],
      sort: { columnId: 'date', direction: 'desc' },
    }).view!;
    expect(applyView(view)).toEqual({
      filters: view.filters,
      columns: ['patient', 'date'],
      sort: { columnId: 'date', direction: 'desc' },
    });
  });
});

describe('sanitizeView', () => {
  it('demotes a stored view claiming to be a system view', () => {
    // Otherwise a hand-edited localStorage entry becomes undeletable.
    expect(sanitizeView({ id: 'x', name: 'X', scope: 'system' })?.scope).toBe('user');
  });

  it('keeps the group scope', () => {
    expect(sanitizeView({ id: 'x', name: 'X', scope: 'group' })?.scope).toBe('group');
  });

  it('drops entries with no id or name', () => {
    expect(sanitizeView({ name: 'X' })).toBeNull();
    expect(sanitizeView({ id: 'x' })).toBeNull();
    expect(sanitizeView(null)).toBeNull();
  });

  it('parses filters that were stored as a query string', () => {
    const view = sanitizeView({ id: 'x', name: 'X', filters: 'modality:anyOf:ct' });
    expect(view?.filters.criteria[0]).toMatchObject({ field: 'modality', operator: 'anyOf' });
  });

  it('drops non-string columns', () => {
    expect(sanitizeView({ id: 'x', name: 'X', columns: ['a', 2, null] })?.columns).toEqual(['a']);
  });
});

describe('deleteView / setPinned / reorderChips', () => {
  it('deletes a user view', () => {
    const store = memoryStore();
    const view = saveView(store, { name: 'Temp', filters: ctFilter() }).view!;
    expect(deleteView(store, view.id).ok).toBe(true);
    expect(store.load()).toHaveLength(0);
  });

  it('reports an unknown id', () => {
    expect(deleteView(memoryStore(), 'nope').ok).toBe(false);
    expect(setPinned(memoryStore(), 'nope', true).ok).toBe(false);
  });

  it('pins a user view as a chip', () => {
    const store = memoryStore();
    const view = saveView(store, { name: 'Plantao', filters: ctFilter() }).view!;
    expect(setPinned(store, view.id, true).ok).toBe(true);
    expect(listChips(store).some(c => c.id === view.id)).toBe(true);
    setPinned(store, view.id, false);
    expect(listChips(store).some(c => c.id === view.id)).toBe(false);
  });

  it('reorders chips and ignores unknown ids', () => {
    const store = memoryStore();
    const a = saveView(store, { name: 'A', filters: ctFilter(), pinned: true }).view!;
    const b = saveView(store, { name: 'B', filters: ctFilter(), pinned: true }).view!;
    reorderChips(store, [b.id, 'ghost', a.id]);
    const stored = store.load();
    expect(stored.find(v => v.id === b.id)?.order).toBe(0);
    expect(stored.find(v => v.id === a.id)?.order).toBe(2);
  });
});

describe('isViewModified', () => {
  it('is false right after applying a view', () => {
    const view = saveView(memoryStore(), { name: 'A', filters: ctFilter() }).view!;
    expect(isViewModified(view, view.filters)).toBe(false);
  });

  it('is true once the reader edits the filters', () => {
    const view = saveView(memoryStore(), { name: 'A', filters: ctFilter() }).view!;
    const edited = upsertCriterion(view.filters, {
      field: 'priority',
      operator: 'anyOf',
      value: ['urgent'],
    });
    expect(isViewModified(view, edited)).toBe(true);
  });

  it('is false with no view active', () => {
    expect(isViewModified(null, ctFilter())).toBe(false);
  });
});

describe('createLocalViewStore', () => {
  const fakeStorage = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  };

  it('round-trips through storage', () => {
    const storage = fakeStorage();
    const store = createLocalViewStore(storage);
    saveView(store, { name: 'Persistida', filters: ctFilter() });
    expect(createLocalViewStore(storage).load()).toHaveLength(1);
  });

  it('stamps the schema version', () => {
    const storage = fakeStorage();
    saveView(createLocalViewStore(storage), { name: 'A', filters: ctFilter() });
    expect(JSON.parse(storage.getItem(VIEWS_STORAGE_KEY)!).version).toBe(VIEWS_SCHEMA_VERSION);
  });

  it('returns nothing for junk or a foreign schema', () => {
    const storage = fakeStorage();
    for (const junk of ['not json', '{}', JSON.stringify({ version: 99, views: [] })]) {
      storage.setItem(VIEWS_STORAGE_KEY, junk);
      expect(createLocalViewStore(storage).load()).toEqual([]);
    }
  });

  it('drops malformed entries individually', () => {
    const storage = fakeStorage();
    storage.setItem(
      VIEWS_STORAGE_KEY,
      JSON.stringify({
        version: VIEWS_SCHEMA_VERSION,
        views: [{ id: 'a', name: 'A' }, { name: 'no id' }, null],
      })
    );
    expect(createLocalViewStore(storage).load()).toHaveLength(1);
  });

  it('survives storage throwing', () => {
    const hostile = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    } as unknown as Storage;
    const store = createLocalViewStore(hostile);
    expect(store.load()).toEqual([]);
    expect(() => store.save([])).not.toThrow();
  });
});
