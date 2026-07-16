/**
 * RTV-210 — pure gesture→command mapping for the touch/tablet layer (iPad rounds).
 *
 * Kept dependency-free (no cornerstone/DOM imports) so it is trivially
 * unit-testable; the event wiring lives in ./touchGestures.ts.
 *
 * Cornerstone3D touch-event facts this module maps over (v5.0.2):
 *  - TOUCH_SWIPE detail carries `swipe: 'UP'|'DOWN'|'LEFT'|'RIGHT'` (enum Swipe,
 *    @cornerstonejs/tools/dist/esm/enums/Touch.d.ts:1-7) and the native
 *    TouchEvent (`detail.event`) — the pointer count is read from
 *    `detail.event.touches.length` by the wiring layer.
 *  - TOUCH_TAP detail carries a cumulative `taps: number` per tap sequence and
 *    `currentPointsList: ITouchPoints[]` (one entry per finger) —
 *    @cornerstonejs/tools/dist/esm/types/EventTypes.d.ts:168-172.
 */

/** Swipe directions emitted by Cornerstone3D (enums/Touch.d.ts). */
export type SwipeDirection = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

/** Worklist navigation commands registered by rtmedical-theme (RTV-120). */
export const NEXT_STUDY_COMMAND = 'nextStudyInWorklist';
export const PREV_STUDY_COMMAND = 'prevStudyInWorklist';
/** Stock camera/props reset command (extensions/cornerstone commandsModule). */
export const RESET_VIEWPORT_COMMAND = 'resetViewport';

/** Ticket item 6: THREE-finger swipe navigates between studies. */
export const STUDY_NAV_MIN_POINTERS = 3;

export interface SwipeGesture {
  swipe?: SwipeDirection | string | null;
  /** Fingers on screen when the swipe fired (native TouchEvent.touches.length). */
  pointerCount?: number;
}

export interface TapGesture {
  /** Cumulative tap count of the tap sequence (2 = double-tap). */
  taps?: number;
  /** Fingers used for the tap (currentPointsList.length). */
  pointerCount?: number;
}

/**
 * Three-finger horizontal swipe → worklist study navigation.
 * Swiping LEFT pushes the current study away to the left → NEXT study;
 * swiping RIGHT pulls the previous one back. Vertical three-finger swipes are
 * intentionally unmapped, and one/two-finger swipes (stack-scroll flicks and
 * pinch endings also fire TOUCH_SWIPE) must never navigate.
 */
export function commandForSwipe({ swipe, pointerCount }: SwipeGesture): string | null {
  if ((pointerCount ?? 0) < STUDY_NAV_MIN_POINTERS) {
    return null;
  }
  if (swipe === 'LEFT') {
    return NEXT_STUDY_COMMAND;
  }
  if (swipe === 'RIGHT') {
    return PREV_STUDY_COMMAND;
  }
  return null;
}

/**
 * One-finger double-tap → reset zoom/pan on the tapped viewport.
 * Multi-finger taps and single taps are unmapped (single tap keeps meaning
 * "focus this viewport"; two-finger double-tap is left free for follow-ups).
 */
export function commandForTap({ taps, pointerCount }: TapGesture): string | null {
  if (taps === 2 && (pointerCount ?? 1) === 1) {
    return RESET_VIEWPORT_COMMAND;
  }
  return null;
}
