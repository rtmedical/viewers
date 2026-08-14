import { describeBindings, isFromTextEntry, resolveTabAction } from './tabsHotkeys';

const alt = (key: string, extra = {}) => ({ key, altKey: true, ...extra });
const cmd = (key: string, extra = {}) => ({ key, metaKey: true, ...extra });
const ctrl = (key: string, extra = {}) => ({ key, ctrlKey: true, ...extra });

describe('isFromTextEntry', () => {
  it.each(['INPUT', 'TEXTAREA', 'SELECT', 'input', 'textarea'])('detects %s', tagName => {
    expect(isFromTextEntry({ target: { tagName } })).toBe(true);
  });

  it('detects a contenteditable', () => {
    expect(isFromTextEntry({ target: { tagName: 'DIV', isContentEditable: true } })).toBe(true);
  });

  it('is false for an ordinary element or no target', () => {
    expect(isFromTextEntry({ target: { tagName: 'DIV' } })).toBe(false);
    expect(isFromTextEntry({})).toBe(false);
    expect(isFromTextEntry({ target: null })).toBe(false);
  });
});

describe('resolveTabAction — app bindings (Alt, the default)', () => {
  it('opens with Alt+T', () => {
    expect(resolveTabAction(alt('t'))).toEqual({ type: 'new' });
    expect(resolveTabAction(alt('T'))).toEqual({ type: 'new' });
  });

  it('closes with Alt+W', () => {
    expect(resolveTabAction(alt('w'))).toEqual({ type: 'close' });
  });

  it('selects by position with Alt+1…9', () => {
    expect(resolveTabAction(alt('1'))).toEqual({ type: 'select', position: 1 });
    expect(resolveTabAction(alt('9'))).toEqual({ type: 'select', position: 9 });
  });

  it('does not treat Alt+0 as a position', () => {
    expect(resolveTabAction(alt('0'))).toBeNull();
  });

  it('cycles with Alt+Tab and Alt+Shift+Tab', () => {
    expect(resolveTabAction(alt('Tab'))).toEqual({ type: 'cycle', delta: 1 });
    expect(resolveTabAction(alt('Tab', { shiftKey: true }))).toEqual({ type: 'cycle', delta: -1 });
  });

  it('cycles with the arrow keys', () => {
    expect(resolveTabAction(alt('ArrowRight'))).toEqual({ type: 'cycle', delta: 1 });
    expect(resolveTabAction(alt('ArrowLeft'))).toEqual({ type: 'cycle', delta: -1 });
  });

  it('ignores the key without the modifier', () => {
    expect(resolveTabAction({ key: 't' })).toBeNull();
    expect(resolveTabAction({ key: '1' })).toBeNull();
  });

  it('does not fire when Ctrl or Cmd is also held', () => {
    // Otherwise ⌘⌥T would trigger both binding sets.
    expect(resolveTabAction(alt('t', { ctrlKey: true }))).toBeNull();
    expect(resolveTabAction(alt('t', { metaKey: true }))).toBeNull();
  });

  it('never fires from a text field', () => {
    // Alt+W inside the report editor must type, not close the study.
    expect(resolveTabAction(alt('w', { target: { tagName: 'TEXTAREA' } }))).toBeNull();
    expect(
      resolveTabAction(alt('1', { target: { tagName: 'DIV', isContentEditable: true } }))
    ).toBeNull();
  });

  it('returns null for an unrelated key so the caller does not swallow it', () => {
    expect(resolveTabAction(alt('q'))).toBeNull();
    expect(resolveTabAction(alt(''))).toBeNull();
    expect(resolveTabAction(undefined as never)).toBeNull();
  });
});

describe('resolveTabAction — desktop bindings (Cmd/Ctrl)', () => {
  it('uses Cmd on macOS', () => {
    expect(resolveTabAction(cmd('t'), { bindings: 'desktop', isMac: true })).toEqual({
      type: 'new',
    });
    expect(resolveTabAction(ctrl('t'), { bindings: 'desktop', isMac: true })).toBeNull();
  });

  it('uses Ctrl elsewhere', () => {
    expect(resolveTabAction(ctrl('w'), { bindings: 'desktop' })).toEqual({ type: 'close' });
    expect(resolveTabAction(cmd('w'), { bindings: 'desktop' })).toBeNull();
  });

  it('selects and cycles', () => {
    expect(resolveTabAction(ctrl('3'), { bindings: 'desktop' })).toEqual({
      type: 'select',
      position: 3,
    });
    expect(resolveTabAction(ctrl('Tab', { shiftKey: true }), { bindings: 'desktop' })).toEqual({
      type: 'cycle',
      delta: -1,
    });
  });

  it('does not fire when Alt is also held', () => {
    expect(resolveTabAction(ctrl('t', { altKey: true }), { bindings: 'desktop' })).toBeNull();
  });

  it('does not respond to the Alt bindings', () => {
    expect(resolveTabAction(alt('t'), { bindings: 'desktop' })).toBeNull();
  });
});

describe('describeBindings', () => {
  it('describes the Alt set by default', () => {
    const lines = describeBindings();
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('Alt+T');
  });

  it('describes the desktop set per platform', () => {
    expect(describeBindings('desktop', true)[0]).toContain('⌘+T');
    expect(describeBindings('desktop', false)[0]).toContain('Ctrl+T');
  });
});
