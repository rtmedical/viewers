import {
  describeWorklistKeys,
  flattenWorklistRows,
  isFromTextEntry,
  resolveWorklistKey,
  WorklistRowRef,
} from './worklistKeyboard';

/** Two patients: p1 expanded with two studies, p2 collapsed with one. */
const GROUPS = [
  { id: 'p1', expanded: true, studies: [{ id: 's1' }, { id: 's2' }] },
  { id: 'p2', expanded: false, studies: [{ id: 's3' }] },
];

const rows = () => flattenWorklistRows(GROUPS);
const ctx = (focusedId: string | null, override: Partial<{ rows: WorklistRowRef[]; pageSize: number }> = {}) => ({
  rows: rows(),
  focusedId,
  ...override,
});

describe('flattenWorklistRows', () => {
  it('lists only what the reader can see', () => {
    // p2 is collapsed, so s3 must not be in the list — arrow keys can then never
    // land on a hidden row.
    expect(rows().map(r => r.id)).toEqual(['p1', 's1', 's2', 'p2']);
  });

  it('marks depth, kind and parent', () => {
    const [patient, study] = rows();
    expect(patient).toMatchObject({ kind: 'patient', depth: 0, expanded: true, expandable: true });
    expect(study).toMatchObject({ kind: 'study', depth: 1, parentId: 'p1' });
  });

  it('does not make a childless patient expandable', () => {
    // An empty disclosure triangle that does nothing is worse than none.
    const flat = flattenWorklistRows([{ id: 'p9', expanded: true, studies: [] }]);
    expect(flat[0].expandable).toBe(false);
  });

  it('carries study expandability through', () => {
    const flat = flattenWorklistRows([
      { id: 'p1', expanded: true, studies: [{ id: 's1', expandable: true, expanded: true }] },
    ]);
    expect(flat[1]).toMatchObject({ expandable: true, expanded: true });
  });

  it('skips entries with no id, and handles nullish input', () => {
    expect(flattenWorklistRows([{ id: '', expanded: true, studies: [] }])).toEqual([]);
    expect(flattenWorklistRows(undefined as never)).toEqual([]);
  });
});

describe('isFromTextEntry', () => {
  it('detects the worklist filter inputs', () => {
    // Without this, ArrowDown inside "Patient name" would move the row focus.
    expect(isFromTextEntry({ target: { tagName: 'INPUT' } })).toBe(true);
    expect(isFromTextEntry({ target: { tagName: 'DIV', isContentEditable: true } })).toBe(true);
    expect(isFromTextEntry({ target: { tagName: 'TR' } })).toBe(false);
  });
});

describe('resolveWorklistKey — vertical movement', () => {
  it('moves down and up', () => {
    expect(resolveWorklistKey({ key: 'ArrowDown' }, ctx('p1'))).toEqual({
      type: 'focus',
      rowId: 's1',
    });
    expect(resolveWorklistKey({ key: 'ArrowUp' }, ctx('s1'))).toEqual({
      type: 'focus',
      rowId: 'p1',
    });
  });

  it('lands on the first row when nothing is focused', () => {
    expect(resolveWorklistKey({ key: 'ArrowDown' }, ctx(null))).toEqual({
      type: 'focus',
      rowId: 'p1',
    });
  });

  it('lands on the last row for ArrowUp with nothing focused', () => {
    expect(resolveWorklistKey({ key: 'ArrowUp' }, ctx(null))).toEqual({
      type: 'focus',
      rowId: 'p2',
    });
  });

  it('clamps at both ends instead of wrapping', () => {
    // A worklist is a list, not a carousel; wrapping past the end loses the reader.
    expect(resolveWorklistKey({ key: 'ArrowUp' }, ctx('p1'))).toEqual({
      type: 'focus',
      rowId: 'p1',
    });
    expect(resolveWorklistKey({ key: 'ArrowDown' }, ctx('p2'))).toEqual({
      type: 'focus',
      rowId: 'p2',
    });
  });

  it('jumps to first and last', () => {
    expect(resolveWorklistKey({ key: 'Home' }, ctx('s2'))).toEqual({ type: 'focus', rowId: 'p1' });
    expect(resolveWorklistKey({ key: 'End' }, ctx('p1'))).toEqual({ type: 'focus', rowId: 'p2' });
  });

  it('pages by the given page size, clamped', () => {
    expect(resolveWorklistKey({ key: 'PageDown' }, ctx('p1', { pageSize: 2 }))).toEqual({
      type: 'focus',
      rowId: 's2',
    });
    expect(resolveWorklistKey({ key: 'PageDown' }, ctx('p1', { pageSize: 99 }))).toEqual({
      type: 'focus',
      rowId: 'p2',
    });
    expect(resolveWorklistKey({ key: 'PageUp' }, ctx('s2', { pageSize: 99 }))).toEqual({
      type: 'focus',
      rowId: 'p1',
    });
  });

  it('treats a nonsense page size as at least one row', () => {
    expect(resolveWorklistKey({ key: 'PageDown' }, ctx('p1', { pageSize: 0 }))).toEqual({
      type: 'focus',
      rowId: 's1',
    });
  });
});

describe('resolveWorklistKey — treegrid semantics', () => {
  it('expands a collapsed row with ArrowRight', () => {
    expect(resolveWorklistKey({ key: 'ArrowRight' }, ctx('p2'))).toEqual({
      type: 'toggle',
      rowId: 'p2',
      expanded: true,
    });
  });

  it('steps into the first child when already expanded', () => {
    expect(resolveWorklistKey({ key: 'ArrowRight' }, ctx('p1'))).toEqual({
      type: 'focus',
      rowId: 's1',
    });
  });

  it('does nothing on a leaf', () => {
    expect(resolveWorklistKey({ key: 'ArrowRight' }, ctx('s1'))).toBeNull();
  });

  it('collapses an expanded row with ArrowLeft', () => {
    expect(resolveWorklistKey({ key: 'ArrowLeft' }, ctx('p1'))).toEqual({
      type: 'toggle',
      rowId: 'p1',
      expanded: false,
    });
  });

  it('steps out to the parent from a leaf', () => {
    expect(resolveWorklistKey({ key: 'ArrowLeft' }, ctx('s2'))).toEqual({
      type: 'focus',
      rowId: 'p1',
    });
  });

  it('does nothing at the root with nothing to collapse', () => {
    expect(resolveWorklistKey({ key: 'ArrowLeft' }, ctx('p2'))).toBeNull();
  });
});

describe('resolveWorklistKey — activation', () => {
  it('opens a study with Enter', () => {
    expect(resolveWorklistKey({ key: 'Enter' }, ctx('s1'))).toEqual({
      type: 'activate',
      rowId: 's1',
    });
  });

  it('toggles a group with Enter instead of opening it', () => {
    expect(resolveWorklistKey({ key: 'Enter' }, ctx('p1'))).toEqual({
      type: 'toggle',
      rowId: 'p1',
      expanded: false,
    });
  });

  it('treats Space like Enter', () => {
    expect(resolveWorklistKey({ key: ' ' }, ctx('s1'))).toEqual({
      type: 'activate',
      rowId: 's1',
    });
  });

  it('does nothing with nothing focused', () => {
    expect(resolveWorklistKey({ key: 'Enter' }, ctx(null))).toBeNull();
  });

  it('clears with Escape', () => {
    expect(resolveWorklistKey({ key: 'Escape' }, ctx('s1'))).toEqual({ type: 'clear' });
  });
});

describe('resolveWorklistKey — guards', () => {
  it('ignores keystrokes from a filter input', () => {
    expect(
      resolveWorklistKey({ key: 'ArrowDown', target: { tagName: 'INPUT' } }, ctx('p1'))
    ).toBeNull();
  });

  it('ignores modified keystrokes', () => {
    // Ctrl+Home etc. belong to the browser or another binding set.
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
      expect(resolveWorklistKey({ key: 'ArrowDown', [modifier]: true }, ctx('p1'))).toBeNull();
    }
  });

  it('returns null for an unhandled key so the caller does not swallow Tab', () => {
    expect(resolveWorklistKey({ key: 'Tab' }, ctx('p1'))).toBeNull();
    expect(resolveWorklistKey({ key: 'a' }, ctx('p1'))).toBeNull();
  });

  it('returns null when there are no rows', () => {
    expect(resolveWorklistKey({ key: 'ArrowDown' }, { rows: [], focusedId: null })).toBeNull();
  });

  it('recovers when the focused row has disappeared', () => {
    // A refresh can remove the focused study out from under the reader.
    expect(resolveWorklistKey({ key: 'ArrowDown' }, ctx('gone'))).toEqual({
      type: 'focus',
      rowId: 'p1',
    });
  });

  it('handles a missing event', () => {
    expect(resolveWorklistKey(undefined as never, ctx('p1'))).toBeNull();
  });
});

describe('describeWorklistKeys', () => {
  it('documents every binding', () => {
    const lines = describeWorklistKeys();
    expect(lines.length).toBeGreaterThanOrEqual(7);
    expect(lines.join('\n')).toContain('Esc');
  });
});
