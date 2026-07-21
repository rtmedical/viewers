import {
  DEFAULT_TIMELINE_PREFS,
  TIMELINE_PREFS_KEY,
  loadTimelinePrefs,
  saveTimelinePrefs,
} from './timelinePrefs';

describe('timelinePrefs (localStorage persistence, RTV-174/175)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns the documented defaults when nothing is stored', () => {
    expect(loadTimelinePrefs()).toEqual(DEFAULT_TIMELINE_PREFS);
    expect(DEFAULT_TIMELINE_PREFS.hideEmptyWeeks).toBe(true); // RTV-175 default ON
    expect(DEFAULT_TIMELINE_PREFS.workWeekOnly).toBe(false);
  });

  it('round-trips through localStorage under the documented key', () => {
    const prefs = {
      ...DEFAULT_TIMELINE_PREFS,
      workWeekOnly: true,
      showVerification: false,
      zoom: 'month' as const,
    };
    saveTimelinePrefs(prefs);
    expect(window.localStorage.getItem(TIMELINE_PREFS_KEY)).toBeTruthy();
    expect(loadTimelinePrefs()).toEqual(prefs);
  });

  it('merges partial payloads over the defaults and ignores ill-typed fields', () => {
    window.localStorage.setItem(
      TIMELINE_PREFS_KEY,
      JSON.stringify({ hideEmptyWeeks: false, showApproved: 'yes', zoom: 'day', junk: 1 })
    );
    const prefs = loadTimelinePrefs();
    expect(prefs.hideEmptyWeeks).toBe(false);
    expect(prefs.showApproved).toBe(true); // ill-typed → default
    expect(prefs.zoom).toBe('week'); // invalid enum → default
  });

  it('survives corrupt JSON and throwing storage (try/catch pattern)', () => {
    window.localStorage.setItem(TIMELINE_PREFS_KEY, '{not json');
    expect(loadTimelinePrefs()).toEqual(DEFAULT_TIMELINE_PREFS);

    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadTimelinePrefs(throwing)).toEqual(DEFAULT_TIMELINE_PREFS);
    expect(() => saveTimelinePrefs(DEFAULT_TIMELINE_PREFS, throwing)).not.toThrow();
  });

  it('degrades to defaults when storage is unavailable', () => {
    expect(loadTimelinePrefs(undefined)).toEqual(DEFAULT_TIMELINE_PREFS);
    expect(() => saveTimelinePrefs(DEFAULT_TIMELINE_PREFS, undefined)).not.toThrow();
  });
});
