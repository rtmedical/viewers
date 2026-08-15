/**
 * Multi-selection model for the worklist — pure core (RTV-191).
 *
 * A supervisor distributing 80 exams between five radiologists selects rows, not
 * studies-one-at-a-time. Three things about that make the model less obvious than
 * "an array of checked rows".
 *
 * ## Selection is by id, never by row index
 *
 * The list is virtual-scrolled and re-sortable. A row index means nothing across a
 * re-sort, a page turn or a background refresh — index 4 is a different patient after
 * the list reorders. Storing ids is what makes selection survive scrolling, which is an
 * explicit acceptance criterion, and it is also the only way a batch action can be sure
 * it is acting on the studies the user actually clicked.
 *
 * ## The anchor moves on a plain click, never on a shift-click
 *
 * Shift+click selects the range from the *anchor* to the clicked row. If the anchor
 * moved to the clicked row each time, a second shift+click further down would start a
 * new range from the first shift-click instead of extending the original one — so
 * extending a selection would silently drop its head. The anchor is set by
 * {@link selectOne} and {@link toggleOne}, and {@link extendTo} deliberately leaves it
 * alone. Every table that gets this wrong feels subtly broken and nobody can say why.
 *
 * ## "Select all" cannot be a list of ids
 *
 * Ctrl+A over a filtered worklist means "all 3,200 matching studies", but the client
 * only ever fetched the current page. Enumerating them client-side is impossible, and
 * sending the 100 ids it happens to hold as if they were all of them is worse than
 * impossible — it is wrong and silent.
 *
 * So the state has two modes:
 *
 * - `explicit` — a concrete set of ids the user picked.
 * - `matching` — "everything the current query matches, minus these exclusions".
 *
 * {@link resolveTargets} returns whichever the server needs, and a `matching` selection
 * resolves to the *query*, not to ids. The batch endpoint has to accept that shape; see
 * the README note. Pretending otherwise would produce a bulk assign that quietly covers
 * only the visible page.
 *
 * A filter change {@link onQueryChanged | resets a `matching` selection} and keeps an
 * `explicit` one: "all matching" now denotes a different set of studies, and
 * reinterpreting it against the new filter would apply the action to studies the user
 * never saw. Explicit ids stay valid because they are concrete.
 *
 * Framework-free, no React, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type SelectionMode = 'explicit' | 'matching';

export interface SelectionState {
  mode: SelectionMode;
  /** In `explicit` mode: the chosen ids. In `matching` mode: unused. */
  ids: string[];
  /** In `matching` mode: ids the user unchecked out of "all". Unused in `explicit`. */
  excluded: string[];
  /** Last row picked by a plain click — the fixed end of a shift+click range. */
  anchorId?: string;
}

export const emptySelection = (): SelectionState => ({
  mode: 'explicit',
  ids: [],
  excluded: [],
});

const clean = (list: unknown): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of (list as unknown[]) ?? []) {
    const id = String(value ?? '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
};

/** Normalises anything that claims to be a selection. */
export function sanitiseSelection(state: unknown): SelectionState {
  const raw = (state ?? {}) as Partial<SelectionState>;
  const mode: SelectionMode = raw.mode === 'matching' ? 'matching' : 'explicit';
  const ids = clean(raw.ids);
  const excluded = clean(raw.excluded);
  const anchorId = String(raw.anchorId ?? '').trim() || undefined;
  return { mode, ids, excluded, anchorId };
}

export function isSelected(state: SelectionState, id: string): boolean {
  const key = String(id ?? '').trim();
  if (!key) {
    return false;
  }
  const current = sanitiseSelection(state);
  return current.mode === 'matching'
    ? !current.excluded.includes(key)
    : current.ids.includes(key);
}

/**
 * How many studies are selected.
 *
 * In `matching` mode this needs `totalMatching` — the count the server reported for the
 * current query — because the client cannot count what it has not fetched. Without it
 * the honest answer is "unknown", returned as `null` rather than as the page size,
 * which would be a plausible-looking lie in the toolbar.
 */
export function selectionCount(state: SelectionState, totalMatching?: number): number | null {
  const current = sanitiseSelection(state);
  if (current.mode === 'explicit') {
    return current.ids.length;
  }
  const total = Number(totalMatching);
  if (!Number.isFinite(total) || total < 0) {
    return null;
  }
  return Math.max(0, Math.floor(total) - current.excluded.length);
}

export function isEmptySelection(state: SelectionState): boolean {
  const current = sanitiseSelection(state);
  return current.mode === 'explicit' && current.ids.length === 0;
}

/** Plain click: the row becomes the only selection, and the anchor. */
export function selectOne(state: SelectionState, id: string): SelectionState {
  const key = String(id ?? '').trim();
  if (!key) {
    return sanitiseSelection(state);
  }
  return { mode: 'explicit', ids: [key], excluded: [], anchorId: key };
}

/**
 * Ctrl/Cmd+click or checkbox: flips one row, keeping the rest.
 *
 * Moves the anchor to the toggled row even when unchecking — the anchor tracks "where
 * the pointer last was", which is what the next shift+click should measure from.
 */
export function toggleOne(state: SelectionState, id: string): SelectionState {
  const key = String(id ?? '').trim();
  if (!key) {
    return sanitiseSelection(state);
  }
  const current = sanitiseSelection(state);

  if (current.mode === 'matching') {
    // Unchecking inside "all matching" is an exclusion, not a switch back to explicit:
    // the user still means "everything except this".
    const excluded = current.excluded.includes(key)
      ? current.excluded.filter(x => x !== key)
      : [...current.excluded, key];
    return { ...current, excluded, anchorId: key };
  }

  const ids = current.ids.includes(key)
    ? current.ids.filter(x => x !== key)
    : [...current.ids, key];
  return { mode: 'explicit', ids, excluded: [], anchorId: key };
}

/**
 * Shift+click: selects the inclusive range between the anchor and `id`.
 *
 * `orderedIds` is the list *as currently displayed* — sorted and filtered — because the
 * range the user drew is the visual one. With no anchor yet, or an anchor that is no
 * longer on screen, this degrades to a plain click rather than guessing a range.
 *
 * The range is added to the existing selection rather than replacing it, so
 * click / shift+click / ctrl+click / shift+click builds up the way every file manager
 * behaves. The anchor is left where it was — see the module note.
 */
export function extendTo(
  state: SelectionState,
  id: string,
  orderedIds: string[]
): SelectionState {
  const key = String(id ?? '').trim();
  const order = clean(orderedIds);
  const current = sanitiseSelection(state);
  if (!key || !order.includes(key)) {
    return current;
  }

  const anchorIndex = current.anchorId ? order.indexOf(current.anchorId) : -1;
  if (anchorIndex < 0) {
    return selectOne(current, key);
  }

  const targetIndex = order.indexOf(key);
  const from = Math.min(anchorIndex, targetIndex);
  const to = Math.max(anchorIndex, targetIndex);
  const range = order.slice(from, to + 1);

  if (current.mode === 'matching') {
    // Re-include the whole range; "all except X" plus a range over X means X is back.
    return { ...current, excluded: current.excluded.filter(x => !range.includes(x)) };
  }

  const ids = [...current.ids];
  for (const rangeId of range) {
    if (!ids.includes(rangeId)) {
      ids.push(rangeId);
    }
  }
  return { mode: 'explicit', ids, excluded: [], anchorId: current.anchorId };
}

/** Header checkbox / Ctrl+A over the loaded page: selects exactly what is on screen. */
export function selectPage(state: SelectionState, orderedIds: string[]): SelectionState {
  const order = clean(orderedIds);
  const current = sanitiseSelection(state);
  return { mode: 'explicit', ids: order, excluded: [], anchorId: current.anchorId };
}

/**
 * "Select all N results" — the banner offered after selecting a full page.
 *
 * Switches to `matching` mode: from here the selection denotes the query, and
 * {@link resolveTargets} will hand the server the query rather than a truncated id list.
 */
export function selectAllMatching(state: SelectionState): SelectionState {
  const current = sanitiseSelection(state);
  return { mode: 'matching', ids: [], excluded: [], anchorId: current.anchorId };
}

export function clearSelection(): SelectionState {
  return emptySelection();
}

/**
 * The filter or sort changed.
 *
 * A `matching` selection is dropped: it meant "all studies matching the old query", and
 * silently re-pointing it at the new one would apply a bulk action to studies the user
 * never saw. An `explicit` selection is kept — those ids still name the same studies,
 * even if some are no longer visible, and the toolbar keeps reporting the count.
 */
export function onQueryChanged(state: SelectionState): SelectionState {
  const current = sanitiseSelection(state);
  return current.mode === 'matching' ? emptySelection() : current;
}

export type HeaderCheckboxState = 'none' | 'some' | 'all';

/** Tri-state for the header checkbox: unchecked, indeterminate, checked. */
export function headerCheckboxState(
  state: SelectionState,
  pageIds: string[]
): HeaderCheckboxState {
  const order = clean(pageIds);
  const current = sanitiseSelection(state);
  if (!order.length) {
    return 'none';
  }
  const selected = order.filter(id => isSelected(current, id)).length;
  if (selected === 0) {
    return 'none';
  }
  return selected === order.length ? 'all' : 'some';
}

/** What the header checkbox should do when clicked, given its current state. */
export function toggleHeader(state: SelectionState, pageIds: string[]): SelectionState {
  return headerCheckboxState(state, pageIds) === 'all'
    ? clearSelection()
    : selectPage(state, pageIds);
}

export type BatchTargets =
  | { mode: 'ids'; ids: string[] }
  | { mode: 'query'; query: string; excluded: string[] };

/**
 * What to send to a batch endpoint.
 *
 * The two shapes are not interchangeable and the caller must handle both. An endpoint
 * that only accepts `ids` cannot honour a `matching` selection over more studies than
 * the client holds — {@link canResolveAsIds} says so up front, so the UI can disable the
 * action instead of quietly under-applying it.
 */
export function resolveTargets(state: SelectionState, query: string): BatchTargets {
  const current = sanitiseSelection(state);
  if (current.mode === 'explicit') {
    return { mode: 'ids', ids: current.ids };
  }
  return { mode: 'query', query: String(query ?? ''), excluded: current.excluded };
}

/**
 * Whether the selection can be expressed as a complete id list.
 *
 * True for `explicit` always, and for `matching` only when every matching study is
 * already loaded (`totalMatching <= loadedIds.length`), which happens on a small result
 * set. Anything else needs the query form.
 */
export function canResolveAsIds(
  state: SelectionState,
  loadedIds: string[],
  totalMatching?: number
): boolean {
  const current = sanitiseSelection(state);
  if (current.mode === 'explicit') {
    return true;
  }
  const total = Number(totalMatching);
  return Number.isFinite(total) && clean(loadedIds).length >= total;
}

/** Expands a `matching` selection to ids, when {@link canResolveAsIds} allows it. */
export function expandToIds(
  state: SelectionState,
  loadedIds: string[],
  totalMatching?: number
): string[] | null {
  const current = sanitiseSelection(state);
  if (current.mode === 'explicit') {
    return current.ids;
  }
  if (!canResolveAsIds(current, loadedIds, totalMatching)) {
    return null;
  }
  return clean(loadedIds).filter(id => !current.excluded.includes(id));
}

/** Toolbar label: "23 selecionados". */
export function describeSelection(state: SelectionState, totalMatching?: number): string {
  const count = selectionCount(state, totalMatching);
  if (count === null) {
    return 'Todos os resultados selecionados';
  }
  if (count === 0) {
    return 'Nenhum estudo selecionado';
  }
  return count === 1 ? '1 estudo selecionado' : `${count} estudos selecionados`;
}
