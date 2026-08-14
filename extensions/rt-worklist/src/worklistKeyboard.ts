/**
 * Worklist keyboard navigation — pure core (RTV-192).
 *
 * ## Why treegrid, not a list
 *
 * The RT worklist (RTV-161) is hierarchical: patient → study → series. So the
 * keyboard model is the **WAI-ARIA treegrid** pattern, not "arrow up/down over
 * rows". `ArrowRight` expands a collapsed row and steps into an expanded one;
 * `ArrowLeft` collapses an expanded row and steps out to the parent otherwise.
 * That is what a radiologist who navigates by keyboard already has in their
 * fingers from every other tree, and it is the difference between a list you can
 * scroll and a tree you can actually work.
 *
 * Operates on a **flattened list of the currently visible rows** — collapsing a
 * patient removes its studies from that list, so navigation never lands on a row
 * the reader cannot see. Building that list is the component's job; every decision
 * about where focus goes is here, framework-free and unit-tested.
 *
 * Zero-fork per RTV-114.
 */

export type WorklistRowKind = 'patient' | 'study';

/** A visible row, flattened. */
export interface WorklistRowRef {
  id: string;
  kind: WorklistRowKind;
  /** 0 for a patient row, 1 for a study row. */
  depth: number;
  expandable: boolean;
  expanded: boolean;
  /** Parent row id, for `ArrowLeft` stepping out. */
  parentId?: string;
}

export type WorklistKeyAction =
  | { type: 'focus'; rowId: string }
  | { type: 'toggle'; rowId: string; expanded: boolean }
  | { type: 'activate'; rowId: string }
  | { type: 'clear' };

export interface WorklistKeyContext {
  /** Visible rows, in display order. */
  rows: WorklistRowRef[];
  /** Currently focused row id, or null. */
  focusedId: string | null;
  /** Rows to jump for PageUp/PageDown. Defaults to 10. */
  pageSize?: number;
}

/** The subset of KeyboardEvent this module reads. */
export interface KeyEventLike {
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

const DEFAULT_PAGE_SIZE = 10;

/**
 * True when the keystroke came from a text field.
 *
 * The worklist header is full of filter inputs, so without this guard pressing
 * ArrowDown inside "Patient name" would move the row focus instead of the caret.
 */
export function isFromTextEntry(event: KeyEventLike): boolean {
  const target = event?.target;
  if (!target) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = String(target.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

const indexOf = (rows: WorklistRowRef[], rowId: string | null) =>
  rowId == null ? -1 : rows.findIndex(r => r.id === rowId);

/** Clamps an index into the row list. */
function rowAt(rows: WorklistRowRef[], index: number): WorklistRowRef | undefined {
  if (!rows.length) {
    return undefined;
  }
  return rows[Math.min(rows.length - 1, Math.max(0, index))];
}

/**
 * Resolves a keystroke into a navigation intent, or `null`.
 *
 * `null` means "not ours" so the caller only calls `preventDefault` for keys it
 * actually handled — otherwise the worklist would swallow Tab and trap the reader.
 */
export function resolveWorklistKey(
  event: KeyEventLike,
  context: WorklistKeyContext
): WorklistKeyAction | null {
  if (!event || isFromTextEntry(event)) {
    return null;
  }
  // Modified keystrokes belong to the browser or another binding set.
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }

  const rows = context?.rows ?? [];
  if (!rows.length) {
    return null;
  }

  const key = String(event.key ?? '');
  const pageSize = Math.max(1, Math.floor(context?.pageSize ?? DEFAULT_PAGE_SIZE));
  const current = indexOf(rows, context?.focusedId ?? null);
  const focused = current === -1 ? undefined : rows[current];

  /** Focus a row by index, or nothing when the list is empty. */
  const focusAt = (index: number): WorklistKeyAction | null => {
    const row = rowAt(rows, index);
    return row ? { type: 'focus', rowId: row.id } : null;
  };

  switch (key) {
    case 'ArrowDown':
      // With nothing focused, the first press lands on the first row.
      return focusAt(current === -1 ? 0 : current + 1);

    case 'ArrowUp':
      return focusAt(current === -1 ? rows.length - 1 : current - 1);

    case 'Home':
      return focusAt(0);

    case 'End':
      return focusAt(rows.length - 1);

    case 'PageDown':
      return focusAt(current === -1 ? 0 : current + pageSize);

    case 'PageUp':
      return focusAt(current === -1 ? 0 : current - pageSize);

    case 'ArrowRight': {
      if (!focused) {
        return focusAt(0);
      }
      if (focused.expandable && !focused.expanded) {
        return { type: 'toggle', rowId: focused.id, expanded: true };
      }
      if (focused.expandable && focused.expanded) {
        // Step into the first child, which is the next row by construction.
        const child = rows[current + 1];
        return child && child.parentId === focused.id ? { type: 'focus', rowId: child.id } : null;
      }
      return null;
    }

    case 'ArrowLeft': {
      if (!focused) {
        return focusAt(0);
      }
      if (focused.expandable && focused.expanded) {
        return { type: 'toggle', rowId: focused.id, expanded: false };
      }
      if (focused.parentId) {
        return { type: 'focus', rowId: focused.parentId };
      }
      return null;
    }

    case 'Enter':
    case ' ':
      if (!focused) {
        return null;
      }
      // Space/Enter on an expandable row toggles; on a leaf it opens the study.
      return focused.expandable
        ? { type: 'toggle', rowId: focused.id, expanded: !focused.expanded }
        : { type: 'activate', rowId: focused.id };

    case 'Escape':
      return { type: 'clear' };

    default:
      return null;
  }
}

/**
 * Flattens patient groups into the visible row list.
 *
 * A collapsed patient contributes only its own row, so the flattened list is
 * exactly what the reader can see and arrow keys can never land on a hidden row.
 */
export function flattenWorklistRows(
  groups: Array<{
    id: string;
    expanded: boolean;
    studies: Array<{ id: string; expandable?: boolean; expanded?: boolean }>;
  }>
): WorklistRowRef[] {
  const rows: WorklistRowRef[] = [];
  for (const group of groups ?? []) {
    if (!group?.id) {
      continue;
    }
    rows.push({
      id: group.id,
      kind: 'patient',
      depth: 0,
      // A patient with no studies is not expandable — an empty disclosure
      // triangle that does nothing is worse than none.
      expandable: (group.studies?.length ?? 0) > 0,
      expanded: !!group.expanded,
    });
    if (!group.expanded) {
      continue;
    }
    for (const study of group.studies ?? []) {
      if (!study?.id) {
        continue;
      }
      rows.push({
        id: study.id,
        kind: 'study',
        depth: 1,
        expandable: !!study.expandable,
        expanded: !!study.expanded,
        parentId: group.id,
      });
    }
  }
  return rows;
}

/** Keyboard help lines, for a tooltip or a shortcuts panel. */
export function describeWorklistKeys(): string[] {
  return [
    '↑ / ↓ — move between rows',
    '→ — expand, or step into the first study',
    '← — collapse, or step out to the patient',
    'Home / End — first / last row',
    'Page Up / Page Down — jump a page',
    'Enter — open the study (or toggle a group)',
    'Esc — clear the selection',
  ];
}
