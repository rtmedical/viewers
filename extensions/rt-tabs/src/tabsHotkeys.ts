/**
 * Study-tab hotkeys — pure core (RTV-41).
 *
 * ## Why the default bindings are not ⌘T / ⌘W
 *
 * The ticket asks for "Hotkeys ⌘T/W/1-9". In a **browser** those are not ours to
 * take: `Ctrl/⌘+T` opens a browser tab, `Ctrl/⌘+W` closes the browser tab, and
 * Chrome reserves `Ctrl+1…8` for switching browser tabs. A page cannot reliably
 * `preventDefault` them — the browser handles them before the page sees them — so
 * shipping them as the default would produce a hotkey that works on the developer's
 * machine and loses the reader's session on someone else's.
 *
 * So there are two binding sets:
 *
 * - **`app` (default)** — `Alt`-based, fully interceptable in every browser.
 * - **`desktop`** — the literal ⌘T/⌘W/⌘1-9 from the ticket. Correct once the app
 *   owns the window, i.e. inside the Tauri shell (the RTVW epic, gated on RTV-8).
 *   Selectable so the desktop build can opt in without touching this logic.
 *
 * Framework-free: takes a plain event-shaped object, returns an intent. No DOM, no
 * React, no listener registration — so every binding is unit-testable and the
 * component stays trivial. Zero-fork per RTV-114.
 */

export type TabActionType = 'new' | 'close' | 'select' | 'cycle';

export type TabAction =
  | { type: 'new' }
  | { type: 'close' }
  | { type: 'select'; position: number }
  | { type: 'cycle'; delta: number };

/** The subset of KeyboardEvent this module reads. */
export interface KeyEventLike {
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  /** Set when the event came from a text field — see {@link isFromTextEntry}. */
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

export type BindingSet = 'app' | 'desktop';

export interface ResolveOptions {
  /** Which binding set to apply. Defaults to `app`. */
  bindings?: BindingSet;
  /** `true` on macOS, so the desktop set reads ⌘ instead of Ctrl. */
  isMac?: boolean;
}

/**
 * True when the keystroke came from somewhere the reader is typing.
 *
 * Without this, `Alt+W` inside the report editor or a filter box would close the
 * study instead of typing. Tab hotkeys must never fire from a text entry.
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

/** The platform-appropriate "command" modifier for the desktop set. */
function hasDesktopModifier(event: KeyEventLike, isMac: boolean): boolean {
  return isMac ? !!event.metaKey : !!event.ctrlKey;
}

/**
 * Resolves a keystroke into a tab intent, or `null` when it is not a tab hotkey.
 *
 * Returning `null` (rather than a no-op action) is what lets the caller decide
 * whether to `preventDefault` — only a recognised binding should swallow a key.
 */
export function resolveTabAction(
  event: KeyEventLike,
  options: ResolveOptions = {}
): TabAction | null {
  if (!event || isFromTextEntry(event)) {
    return null;
  }

  const key = String(event.key ?? '');
  if (!key) {
    return null;
  }
  const lower = key.toLowerCase();
  const bindings = options.bindings ?? 'app';

  const modifierHeld =
    bindings === 'desktop' ? hasDesktopModifier(event, !!options.isMac) : !!event.altKey;
  if (!modifierHeld) {
    return null;
  }

  // The desktop set must not fire on Alt, and the app set must not fire on
  // Ctrl/⌘ — otherwise ⌘⌥T would trigger twice.
  if (bindings === 'desktop' && event.altKey) {
    return null;
  }
  if (bindings === 'app' && (event.ctrlKey || event.metaKey)) {
    return null;
  }

  if (lower === 't') {
    return { type: 'new' };
  }
  if (lower === 'w') {
    return { type: 'close' };
  }

  // 1-9 select by position. 9 is NOT "the ninth tab" in browsers (it is "the
  // last"), but with a tab limit of 8 the distinction never arises here, so
  // positional is both simpler and unambiguous.
  if (/^[1-9]$/.test(key)) {
    return { type: 'select', position: Number(key) };
  }

  if (lower === 'tab') {
    return { type: 'cycle', delta: event.shiftKey ? -1 : 1 };
  }
  if (key === 'ArrowRight') {
    return { type: 'cycle', delta: 1 };
  }
  if (key === 'ArrowLeft') {
    return { type: 'cycle', delta: -1 };
  }

  return null;
}

/** Human-readable binding list, for a help panel or tooltip. */
export function describeBindings(bindings: BindingSet = 'app', isMac = false): string[] {
  const mod = bindings === 'desktop' ? (isMac ? '⌘' : 'Ctrl') : 'Alt';
  return [
    `${mod}+T — open a study tab`,
    `${mod}+W — close the active tab`,
    `${mod}+1…9 — go to tab by position`,
    `${mod}+Tab / ${mod}+Shift+Tab — next / previous tab`,
    `${mod}+→ / ${mod}+← — next / previous tab`,
  ];
}
