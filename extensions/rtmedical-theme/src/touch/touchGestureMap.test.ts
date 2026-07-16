/**
 * RTV-210 — unit tests for the pure touch gesture→command map.
 */
import {
  commandForSwipe,
  commandForTap,
  NEXT_STUDY_COMMAND,
  PREV_STUDY_COMMAND,
  RESET_VIEWPORT_COMMAND,
} from './touchGestureMap';

describe('touchGestureMap (RTV-210)', () => {
  describe('commandForSwipe', () => {
    it('maps a three-finger LEFT swipe to the next study', () => {
      expect(commandForSwipe({ swipe: 'LEFT', pointerCount: 3 })).toBe(NEXT_STUDY_COMMAND);
    });

    it('maps a three-finger RIGHT swipe to the previous study', () => {
      expect(commandForSwipe({ swipe: 'RIGHT', pointerCount: 3 })).toBe(PREV_STUDY_COMMAND);
    });

    it('accepts more than three fingers (>=3 pointer threshold)', () => {
      expect(commandForSwipe({ swipe: 'LEFT', pointerCount: 4 })).toBe(NEXT_STUDY_COMMAND);
    });

    it('ignores vertical three-finger swipes', () => {
      expect(commandForSwipe({ swipe: 'UP', pointerCount: 3 })).toBeNull();
      expect(commandForSwipe({ swipe: 'DOWN', pointerCount: 3 })).toBeNull();
    });

    it('never navigates on one/two-finger swipes (scroll flicks, pinch endings)', () => {
      expect(commandForSwipe({ swipe: 'LEFT', pointerCount: 1 })).toBeNull();
      expect(commandForSwipe({ swipe: 'RIGHT', pointerCount: 2 })).toBeNull();
    });

    it('returns null when the pointer count or direction is missing/unknown', () => {
      expect(commandForSwipe({ swipe: 'LEFT' })).toBeNull();
      expect(commandForSwipe({ swipe: null, pointerCount: 3 })).toBeNull();
      expect(commandForSwipe({ swipe: 'DIAGONAL', pointerCount: 3 })).toBeNull();
    });
  });

  describe('commandForTap', () => {
    it('maps a one-finger double-tap to resetViewport', () => {
      expect(commandForTap({ taps: 2, pointerCount: 1 })).toBe(RESET_VIEWPORT_COMMAND);
    });

    it('defaults the pointer count to one finger when absent', () => {
      expect(commandForTap({ taps: 2 })).toBe(RESET_VIEWPORT_COMMAND);
    });

    it('ignores single taps and triple taps', () => {
      expect(commandForTap({ taps: 1, pointerCount: 1 })).toBeNull();
      expect(commandForTap({ taps: 3, pointerCount: 1 })).toBeNull();
      expect(commandForTap({})).toBeNull();
    });

    it('ignores multi-finger double-taps', () => {
      expect(commandForTap({ taps: 2, pointerCount: 2 })).toBeNull();
    });
  });
});
