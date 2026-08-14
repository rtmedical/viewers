import {
  activateTab,
  activateTabAt,
  activeTab,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  cycleTab,
  deserializeTabs,
  emptyState,
  moveTab,
  nextActiveAfterClose,
  openTab,
  renameTab,
  serializeTabs,
  setTabSnapshot,
  TAB_LIMIT,
  TABS_SCHEMA_VERSION,
  TabsState,
} from './tabsModel';

/** Opens N tabs named s1..sN. */
function withTabs(count: number): TabsState {
  let state = emptyState();
  for (let i = 1; i <= count; i++) {
    state = openTab(state, { label: `Study ${i}`, StudyInstanceUID: `s${i}` }).state;
  }
  return state;
}

describe('openTab', () => {
  it('opens and activates a tab', () => {
    const { state, outcome } = openTab(emptyState(), {
      label: 'Silva',
      StudyInstanceUID: '1.2.3',
    });
    expect(outcome).toBe('opened');
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe('1.2.3');
    expect(state.tabs[0].label).toBe('Silva');
  });

  it('uses the StudyInstanceUID as the id by default', () => {
    const { state } = openTab(emptyState(), { label: 'x', StudyInstanceUID: '1.2.3' });
    expect(state.tabs[0].id).toBe('1.2.3');
  });

  it('activates the existing tab instead of duplicating a study', () => {
    // Two tabs on one study would give the reader two divergent measurement
    // states for the same patient.
    const first = openTab(emptyState(), { label: 'Silva', StudyInstanceUID: '1.2.3' }).state;
    const second = openTab(first, { label: 'Silva again', StudyInstanceUID: '1.2.3' });

    expect(second.outcome).toBe('activated');
    expect(second.state.tabs).toHaveLength(1);
    expect(second.state.tabs[0].label).toBe('Silva');
    expect(second.state.activeTabId).toBe('1.2.3');
  });

  it('reactivates an already-open study that is not active', () => {
    const state = withTabs(3);
    const result = openTab(state, { label: 'Study 1', StudyInstanceUID: 's1' });
    expect(result.outcome).toBe('activated');
    expect(result.state.activeTabId).toBe('s1');
  });

  it('rejects past the tab limit instead of evicting a tab', () => {
    // Evicting could discard unsaved measurements.
    const full = withTabs(TAB_LIMIT);
    const result = openTab(full, { label: 'one more', StudyInstanceUID: 'extra' });

    expect(result.outcome).toBe('rejected');
    expect(result.reason).toContain(String(TAB_LIMIT));
    expect(result.state.tabs).toHaveLength(TAB_LIMIT);
    expect(result.state).toBe(full);
  });

  it('refuses a tab with no study uid', () => {
    expect(openTab(emptyState(), { label: 'x', StudyInstanceUID: '' }).outcome).toBe('rejected');
    expect(openTab(emptyState(), { label: 'x', StudyInstanceUID: '   ' }).outcome).toBe('rejected');
  });

  it('falls back to the uid when no label is given', () => {
    const { state } = openTab(emptyState(), { label: '', StudyInstanceUID: '1.2.3' });
    expect(state.tabs[0].label).toBe('1.2.3');
  });
});

describe('closeTab', () => {
  it('activates the tab to the right', () => {
    // Browser behaviour, and it keeps the reader's place when closing a run of tabs.
    let state = withTabs(3);
    state = activateTab(state, 's2');
    state = closeTab(state, 's2');

    expect(state.tabs.map(t => t.id)).toEqual(['s1', 's3']);
    expect(state.activeTabId).toBe('s3');
  });

  it('falls back to the left when closing the last tab', () => {
    let state = withTabs(3);
    state = activateTab(state, 's3');
    state = closeTab(state, 's3');
    expect(state.activeTabId).toBe('s2');
  });

  it('leaves nothing active when the last tab closes', () => {
    const state = closeTab(withTabs(1), 's1');
    expect(state.tabs).toEqual([]);
    expect(state.activeTabId).toBeNull();
  });

  it('does not move the active tab when closing a different one', () => {
    let state = withTabs(3);
    state = activateTab(state, 's1');
    state = closeTab(state, 's3');
    expect(state.activeTabId).toBe('s1');
  });

  it('ignores an unknown id', () => {
    const state = withTabs(2);
    expect(closeTab(state, 'nope')).toBe(state);
  });
});

describe('nextActiveAfterClose', () => {
  it('picks the right neighbour', () => {
    const { tabs } = withTabs(3);
    expect(nextActiveAfterClose(tabs, 0)).toBe('s2');
    expect(nextActiveAfterClose(tabs, 1)).toBe('s3');
  });

  it('picks the left neighbour for the last tab', () => {
    const { tabs } = withTabs(3);
    expect(nextActiveAfterClose(tabs, 2)).toBe('s2');
  });

  it('returns null when nothing remains', () => {
    expect(nextActiveAfterClose(withTabs(1).tabs, 0)).toBeNull();
    expect(nextActiveAfterClose([], 0)).toBeNull();
  });
});

describe('closeOtherTabs / closeAllTabs', () => {
  it('keeps only the named tab and activates it', () => {
    const state = closeOtherTabs(withTabs(4), 's3');
    expect(state.tabs.map(t => t.id)).toEqual(['s3']);
    expect(state.activeTabId).toBe('s3');
  });

  it('ignores an unknown id', () => {
    const state = withTabs(2);
    expect(closeOtherTabs(state, 'nope')).toBe(state);
  });

  it('closes everything', () => {
    expect(closeAllTabs()).toEqual(emptyState());
  });
});

describe('activateTab / activateTabAt / cycleTab', () => {
  it('activates by id', () => {
    expect(activateTab(withTabs(3), 's2').activeTabId).toBe('s2');
  });

  it('ignores an unknown id so a stale hotkey cannot blank the view', () => {
    const state = withTabs(3);
    expect(activateTab(state, 'nope')).toBe(state);
  });

  it('activates by 1-based position', () => {
    expect(activateTabAt(withTabs(3), 1).activeTabId).toBe('s1');
    expect(activateTabAt(withTabs(3), 3).activeTabId).toBe('s3');
  });

  it('ignores a position past the end', () => {
    const state = withTabs(2);
    expect(activateTabAt(state, 9)).toBe(state);
    expect(activateTabAt(state, 0)).toBe(state);
  });

  it('cycles forward and wraps', () => {
    let state = activateTab(withTabs(3), 's3');
    state = cycleTab(state, 1);
    expect(state.activeTabId).toBe('s1');
  });

  it('cycles backward and wraps', () => {
    let state = activateTab(withTabs(3), 's1');
    state = cycleTab(state, -1);
    expect(state.activeTabId).toBe('s3');
  });

  it('treats a zero delta as one step', () => {
    const state = activateTab(withTabs(3), 's1');
    expect(cycleTab(state, 0).activeTabId).toBe('s2');
  });

  it('does nothing with no tabs', () => {
    const state = emptyState();
    expect(cycleTab(state, 1)).toBe(state);
  });
});

describe('moveTab', () => {
  it('reorders forward', () => {
    const state = moveTab(withTabs(4), 0, 2);
    expect(state.tabs.map(t => t.id)).toEqual(['s2', 's3', 's1', 's4']);
  });

  it('reorders backward', () => {
    const state = moveTab(withTabs(4), 3, 1);
    expect(state.tabs.map(t => t.id)).toEqual(['s1', 's4', 's2', 's3']);
  });

  it('keeps the active tab active across a reorder', () => {
    let state = activateTab(withTabs(4), 's1');
    state = moveTab(state, 0, 3);
    expect(state.activeTabId).toBe('s1');
    expect(state.tabs.map(t => t.id)).toEqual(['s2', 's3', 's4', 's1']);
  });

  it('clamps a drop past the end instead of throwing', () => {
    const state = moveTab(withTabs(3), 0, 99);
    expect(state.tabs.map(t => t.id)).toEqual(['s2', 's3', 's1']);
  });

  it('clamps a negative drop target', () => {
    const state = moveTab(withTabs(3), 2, -5);
    expect(state.tabs.map(t => t.id)).toEqual(['s3', 's1', 's2']);
  });

  it('is a no-op for an out-of-range source or an unchanged position', () => {
    const state = withTabs(3);
    expect(moveTab(state, 9, 0)).toBe(state);
    expect(moveTab(state, -1, 0)).toBe(state);
    expect(moveTab(state, 1, 1)).toBe(state);
    expect(moveTab(emptyState(), 0, 0)).toEqual(emptyState());
  });
});

describe('setTabSnapshot / renameTab / activeTab', () => {
  it('stores an opaque snapshot without touching order or activation', () => {
    const before = activateTab(withTabs(3), 's2');
    const after = setTabSnapshot(before, 's1', { viewport: 'axial', measurements: 4 });

    expect(after.tabs[0].snapshot).toEqual({ viewport: 'axial', measurements: 4 });
    expect(after.activeTabId).toBe('s2');
    expect(after.tabs.map(t => t.id)).toEqual(before.tabs.map(t => t.id));
  });

  it('ignores a snapshot for an unknown tab', () => {
    const state = withTabs(2);
    expect(setTabSnapshot(state, 'nope', {})).toBe(state);
  });

  it('renames a tab', () => {
    expect(renameTab(withTabs(2), 's1', ' Silva ').tabs[0].label).toBe('Silva');
  });

  it('refuses a blank rename', () => {
    const state = withTabs(2);
    expect(renameTab(state, 's1', '   ')).toBe(state);
    expect(renameTab(state, 's1', '')).toBe(state);
  });

  it('reports the active tab, or null', () => {
    expect(activeTab(withTabs(2))?.id).toBe('s2');
    expect(activeTab(emptyState())).toBeNull();
  });
});

describe('persistence', () => {
  it('round-trips a session', () => {
    const before = setTabSnapshot(activateTab(withTabs(3), 's2'), 's2', { zoom: 2 });
    const after = deserializeTabs(serializeTabs(before));
    expect(after).toEqual(before);
  });

  it('stamps the schema version', () => {
    expect(JSON.parse(serializeTabs(withTabs(1))).version).toBe(TABS_SCHEMA_VERSION);
  });

  it('returns an empty session for junk', () => {
    // localStorage survives upgrades and is shared with every app on the origin,
    // so a viewer that will not start is far worse than one that forgot the tabs.
    for (const junk of ['', 'not json', '{', '[]', 'null', '3', undefined, null, 42, {}]) {
      expect(deserializeTabs(junk as never)).toEqual(emptyState());
    }
  });

  it('refuses a different schema version', () => {
    const payload = JSON.stringify({ version: 99, tabs: [{ id: 'a', StudyInstanceUID: 'a' }] });
    expect(deserializeTabs(payload)).toEqual(emptyState());
  });

  it('drops malformed entries individually instead of losing the session', () => {
    const payload = JSON.stringify({
      version: TABS_SCHEMA_VERSION,
      tabs: [
        { id: 's1', StudyInstanceUID: 's1', label: 'Silva' },
        { id: '', StudyInstanceUID: 'no-id' },
        { id: 's2' },
        null,
        'nonsense',
        { id: 's1', StudyInstanceUID: 's1' },
        { id: 's3', StudyInstanceUID: 's3' },
      ],
      activeTabId: 's3',
    });
    const state = deserializeTabs(payload);
    expect(state.tabs.map(t => t.id)).toEqual(['s1', 's3']);
    expect(state.activeTabId).toBe('s3');
  });

  it('falls back to the first tab when the active id no longer exists', () => {
    const payload = JSON.stringify({
      version: TABS_SCHEMA_VERSION,
      tabs: [{ id: 's1', StudyInstanceUID: 's1' }],
      activeTabId: 'gone',
    });
    expect(deserializeTabs(payload).activeTabId).toBe('s1');
  });

  it('honours the tab limit when restoring', () => {
    const payload = JSON.stringify({
      version: TABS_SCHEMA_VERSION,
      tabs: Array.from({ length: TAB_LIMIT + 5 }, (_u, i) => ({
        id: `s${i}`,
        StudyInstanceUID: `s${i}`,
      })),
      activeTabId: 's0',
    });
    expect(deserializeTabs(payload).tabs).toHaveLength(TAB_LIMIT);
  });

  it('labels a restored tab with its uid when the label is missing', () => {
    const payload = JSON.stringify({
      version: TABS_SCHEMA_VERSION,
      tabs: [{ id: 's1', StudyInstanceUID: '1.2.3' }],
      activeTabId: 's1',
    });
    expect(deserializeTabs(payload).tabs[0].label).toBe('1.2.3');
  });
});
