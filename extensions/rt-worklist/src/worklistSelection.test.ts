import {
  canResolveAsIds,
  clearSelection,
  describeSelection,
  emptySelection,
  expandToIds,
  extendTo,
  headerCheckboxState,
  isEmptySelection,
  isSelected,
  onQueryChanged,
  resolveTargets,
  sanitiseSelection,
  selectAllMatching,
  selectionCount,
  selectOne,
  selectPage,
  toggleHeader,
  toggleOne,
} from './worklistSelection';

const PAGE = ['a', 'b', 'c', 'd', 'e'];

describe('worklistSelection — basics', () => {
  it('starts empty and explicit', () => {
    const s = emptySelection();
    expect(s.mode).toBe('explicit');
    expect(isEmptySelection(s)).toBe(true);
    expect(selectionCount(s)).toBe(0);
  });

  it('a plain click selects exactly one row and sets the anchor', () => {
    const s = selectOne(emptySelection(), 'c');
    expect(s.ids).toEqual(['c']);
    expect(s.anchorId).toBe('c');
  });

  it('a plain click replaces whatever was selected', () => {
    let s = toggleOne(emptySelection(), 'a');
    s = toggleOne(s, 'b');
    s = selectOne(s, 'e');
    expect(s.ids).toEqual(['e']);
  });

  it('toggle adds and removes', () => {
    let s = toggleOne(emptySelection(), 'a');
    s = toggleOne(s, 'b');
    expect(s.ids).toEqual(['a', 'b']);
    s = toggleOne(s, 'a');
    expect(s.ids).toEqual(['b']);
  });

  it('ignores blank ids', () => {
    expect(toggleOne(emptySelection(), '  ').ids).toEqual([]);
    expect(selectOne(emptySelection(), '').ids).toEqual([]);
  });

  it('sanitises junk into a usable state', () => {
    const s = sanitiseSelection({ mode: 'nonsense', ids: ['a', 'a', '', 'b'], excluded: null });
    expect(s.mode).toBe('explicit');
    expect(s.ids).toEqual(['a', 'b']);
    expect(s.excluded).toEqual([]);
  });
});

describe('worklistSelection — shift+click ranges', () => {
  it('selects the inclusive range from the anchor', () => {
    let s = selectOne(emptySelection(), 'b');
    s = extendTo(s, 'd', PAGE);
    expect(s.ids).toEqual(['b', 'c', 'd']);
  });

  it('works backwards', () => {
    let s = selectOne(emptySelection(), 'd');
    s = extendTo(s, 'b', PAGE);
    expect(s.ids.sort()).toEqual(['b', 'c', 'd']);
  });

  // The bug this whole module is shaped around: if extendTo moved the anchor, the
  // second shift+click would start from 'c' and drop 'a' and 'b' from the range.
  it('leaves the anchor alone, so a second shift+click EXTENDS instead of restarting', () => {
    let s = selectOne(emptySelection(), 'a');
    s = extendTo(s, 'c', PAGE);
    expect(s.anchorId).toBe('a');
    s = extendTo(s, 'e', PAGE);
    expect(s.ids).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('adds the range to an existing selection rather than replacing it', () => {
    let s = toggleOne(emptySelection(), 'a');
    s = toggleOne(s, 'c');
    s = extendTo(s, 'e', PAGE);
    expect(s.ids.sort()).toEqual(['a', 'c', 'd', 'e']);
  });

  it('degrades to a plain click when there is no anchor', () => {
    const s = extendTo(emptySelection(), 'c', PAGE);
    expect(s.ids).toEqual(['c']);
    expect(s.anchorId).toBe('c');
  });

  it('degrades to a plain click when the anchor scrolled out of the current order', () => {
    const s = extendTo({ ...selectOne(emptySelection(), 'zz') }, 'c', PAGE);
    expect(s.ids).toEqual(['c']);
  });

  it('ignores a target that is not in the displayed order', () => {
    const before = selectOne(emptySelection(), 'b');
    expect(extendTo(before, 'nope', PAGE)).toEqual(before);
  });

  // The range is the VISUAL one: it follows the displayed order, not insertion order.
  it('follows the displayed order after a re-sort', () => {
    const resorted = ['e', 'd', 'c', 'b', 'a'];
    let s = selectOne(emptySelection(), 'e');
    s = extendTo(s, 'c', resorted);
    expect(s.ids).toEqual(['e', 'd', 'c']);
  });
});

describe('worklistSelection — header checkbox', () => {
  it('is none, some or all', () => {
    expect(headerCheckboxState(emptySelection(), PAGE)).toBe('none');
    expect(headerCheckboxState(toggleOne(emptySelection(), 'a'), PAGE)).toBe('some');
    expect(headerCheckboxState(selectPage(emptySelection(), PAGE), PAGE)).toBe('all');
  });

  it('is none for an empty page even with rows selected elsewhere', () => {
    expect(headerCheckboxState(toggleOne(emptySelection(), 'a'), [])).toBe('none');
  });

  it('toggling selects the page, then clears it', () => {
    let s = toggleHeader(emptySelection(), PAGE);
    expect(s.ids).toEqual(PAGE);
    s = toggleHeader(s, PAGE);
    expect(isEmptySelection(s)).toBe(true);
  });

  it('a partial page becomes a full page rather than clearing', () => {
    const s = toggleHeader(toggleOne(emptySelection(), 'c'), PAGE);
    expect(s.ids).toEqual(PAGE);
  });
});

describe('worklistSelection — "all matching" mode', () => {
  it('selects everything without enumerating ids', () => {
    const s = selectAllMatching(selectPage(emptySelection(), PAGE));
    expect(s.mode).toBe('matching');
    expect(s.ids).toEqual([]);
    expect(isSelected(s, 'anything-at-all')).toBe(true);
  });

  it('counts from the server total, not from the loaded page', () => {
    const s = selectAllMatching(emptySelection());
    expect(selectionCount(s, 3200)).toBe(3200);
  });

  // Reporting the page size here would be a plausible-looking lie in the toolbar.
  it('reports an unknown count rather than guessing when no total is given', () => {
    expect(selectionCount(selectAllMatching(emptySelection()))).toBeNull();
    expect(describeSelection(selectAllMatching(emptySelection()))).toMatch(/Todos os resultados/);
  });

  it('unchecking a row becomes an exclusion, staying in matching mode', () => {
    const s = toggleOne(selectAllMatching(emptySelection()), 'c');
    expect(s.mode).toBe('matching');
    expect(isSelected(s, 'c')).toBe(false);
    expect(isSelected(s, 'b')).toBe(true);
    expect(selectionCount(s, 3200)).toBe(3199);
  });

  it('re-checking an excluded row removes the exclusion', () => {
    let s = toggleOne(selectAllMatching(emptySelection()), 'c');
    s = toggleOne(s, 'c');
    expect(s.excluded).toEqual([]);
  });

  it('a shift+click range re-includes excluded rows inside it, and only those', () => {
    let s = sanitiseSelection({ mode: 'matching', excluded: ['b', 'd'], anchorId: 'a' });
    s = extendTo(s, 'c', PAGE);
    expect(s.mode).toBe('matching');
    expect(s.excluded).toEqual(['d']);
  });
});

describe('worklistSelection — resolving to a server request', () => {
  it('explicit selections resolve to ids', () => {
    const s = selectPage(emptySelection(), PAGE);
    expect(resolveTargets(s, 'modality=CT')).toEqual({ mode: 'ids', ids: PAGE });
  });

  // The core claim of the module note: 100 loaded ids are not 3,200 matching studies.
  it('a matching selection resolves to the QUERY, not to the loaded ids', () => {
    const s = toggleOne(selectAllMatching(emptySelection()), 'c');
    expect(resolveTargets(s, 'modality=CT')).toEqual({
      mode: 'query',
      query: 'modality=CT',
      excluded: ['c'],
    });
  });

  it('refuses to expand a matching selection the client cannot enumerate', () => {
    const s = selectAllMatching(emptySelection());
    expect(canResolveAsIds(s, PAGE, 3200)).toBe(false);
    expect(expandToIds(s, PAGE, 3200)).toBeNull();
  });

  it('expands a matching selection when everything is loaded', () => {
    const s = toggleOne(selectAllMatching(emptySelection()), 'c');
    expect(canResolveAsIds(s, PAGE, 5)).toBe(true);
    expect(expandToIds(s, PAGE, 5)).toEqual(['a', 'b', 'd', 'e']);
  });

  it('an explicit selection always expands', () => {
    const s = selectPage(emptySelection(), PAGE);
    expect(canResolveAsIds(s, [], undefined)).toBe(true);
    expect(expandToIds(s, [], undefined)).toEqual(PAGE);
  });
});

describe('worklistSelection — query changes', () => {
  // "All matching" now denotes a different set of studies; carrying it over would bulk
  // assign studies the supervisor never saw.
  it('drops a matching selection when the filter changes', () => {
    const s = onQueryChanged(selectAllMatching(emptySelection()));
    expect(s.mode).toBe('explicit');
    expect(isEmptySelection(s)).toBe(true);
  });

  it('keeps an explicit selection, because those ids still name the same studies', () => {
    const before = selectPage(emptySelection(), PAGE);
    expect(onQueryChanged(before).ids).toEqual(PAGE);
  });

  // The acceptance criterion "selection survives scroll" is really this: nothing here
  // stores a row index, so re-ordering and paging cannot disturb it.
  it('survives a re-sort of the underlying list', () => {
    const s = selectPage(emptySelection(), PAGE);
    const resorted = ['e', 'a', 'd', 'b', 'c'];
    expect(resorted.every(id => isSelected(s, id))).toBe(true);
    expect(headerCheckboxState(s, resorted)).toBe('all');
  });
});

describe('worklistSelection — labels', () => {
  it('is singular for one and plural otherwise', () => {
    expect(describeSelection(emptySelection())).toMatch(/Nenhum/);
    expect(describeSelection(selectOne(emptySelection(), 'a'))).toBe('1 estudo selecionado');
    expect(describeSelection(selectPage(emptySelection(), PAGE))).toBe('5 estudos selecionados');
  });

  it('clearSelection empties everything', () => {
    expect(isEmptySelection(clearSelection())).toBe(true);
  });
});
