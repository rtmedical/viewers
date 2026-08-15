import {
  clampColumnWidth,
  COLUMN_MAX_WIDTH,
  COLUMN_MIN_WIDTH,
  COLUMN_POOL,
  createLocalProfileStore,
  DEFAULT_PROFILES,
  defaultProfile,
  findColumn,
  moveColumn,
  PERSONAL_PROFILE_ID,
  profileFromIds,
  REQUIRED_COLUMN_IDS,
  resolveProfile,
  sanitizeProfile,
  setColumnVisible,
  setColumnWidth,
  visibleColumns,
} from './worklistColumns';

const ids = (profile: { columns: Array<{ id: string }> }) => profile.columns.map(c => c.id);
const visibleIds = (profile: Parameters<typeof visibleColumns>[0]) =>
  visibleColumns(profile).map(c => c.id);

describe('the column pool', () => {
  it('has unique ids and a source for every column', () => {
    const all = COLUMN_POOL.map(c => c.id);
    expect(new Set(all).size).toBe(all.length);
    for (const column of COLUMN_POOL) {
      expect(['dicom', 'ris', 'computed']).toContain(column.source);
      expect(column.label).toBeTruthy();
      expect(column.width).toBeGreaterThanOrEqual(COLUMN_MIN_WIDTH);
    }
  });

  it('marks patient and date as required', () => {
    // A row with neither is a row the reader cannot act on.
    expect(REQUIRED_COLUMN_IDS).toEqual(expect.arrayContaining(['patientName', 'studyDate']));
  });

  it('covers the three roles the ticket names', () => {
    for (const role of ['radiologist', 'rtPhysicist', 'technologist', 'admin']) {
      expect(DEFAULT_PROFILES[role].length).toBeGreaterThan(0);
      for (const id of DEFAULT_PROFILES[role]) {
        expect(findColumn(id)).toBeDefined();
      }
    }
  });
});

describe('profileFromIds / defaultProfile', () => {
  it('shows the listed columns in order', () => {
    const profile = profileFromIds('x', ['modality', 'patientName']);
    // studyDate is required, so it is appended visible even though it was not asked
    // for -- the same invariant sanitizeProfile enforces.
    expect(visibleIds(profile)).toEqual(['modality', 'patientName', 'studyDate']);
  });

  it('keeps the rest hidden rather than dropping them', () => {
    // The column editor can then offer them without a second "available" list.
    const profile = profileFromIds('x', ['patientName']);
    expect(ids(profile)).toHaveLength(COLUMN_POOL.length);
    expect(visibleIds(profile)).toEqual(['patientName', 'studyDate']);
  });

  it('ignores unknown and duplicate ids', () => {
    const profile = profileFromIds('x', ['patientName', 'patientName', 'nope']);
    expect(visibleIds(profile)).toEqual(['patientName', 'studyDate']);
  });

  it('gives the RT physicist plan, machine, fraction and dose', () => {
    expect(visibleIds(defaultProfile('rtPhysicist'))).toEqual(
      expect.arrayContaining(['rtPlan', 'rtMachine', 'rtFraction', 'rtDose'])
    );
  });

  it('falls back to the radiologist profile', () => {
    expect(visibleIds(defaultProfile('nope'))).toEqual(visibleIds(defaultProfile('radiologist')));
    expect(visibleIds(defaultProfile())).toEqual(visibleIds(defaultProfile('radiologist')));
  });
});

describe('sanitizeProfile', () => {
  it('drops columns this build no longer has', () => {
    const profile = sanitizeProfile({ id: 'g', columns: [{ id: 'ghost', visible: true, width: 100 }] });
    expect(ids(profile)).not.toContain('ghost');
  });

  it('forces the required columns visible', () => {
    // A table of anonymous stripes is not a worklist.
    const profile = sanitizeProfile({
      id: 'g',
      columns: [{ id: 'patientName', visible: false, width: 100 }],
    });
    expect(profile.columns.find(c => c.id === 'patientName')?.visible).toBe(true);
  });

  it('clamps stored widths', () => {
    const profile = sanitizeProfile({
      id: 'g',
      columns: [{ id: 'mrn', visible: true, width: 9999 }],
    });
    expect(profile.columns.find(c => c.id === 'mrn')?.width).toBe(COLUMN_MAX_WIDTH);
  });

  it('completes a partial profile with everything else hidden', () => {
    const profile = sanitizeProfile({ id: 'g', columns: [{ id: 'mrn', visible: true, width: 120 }] });
    expect(ids(profile)).toHaveLength(COLUMN_POOL.length);
    expect(visibleIds(profile)).toEqual(expect.arrayContaining(['mrn', ...REQUIRED_COLUMN_IDS]));
  });

  it('handles junk', () => {
    expect(sanitizeProfile(null).columns).toHaveLength(COLUMN_POOL.length);
    expect(sanitizeProfile({ columns: 'nope' } as never).id).toBe(PERSONAL_PROFILE_ID);
  });
});

describe('resolveProfile', () => {
  const group = profileFromIds('radiologist', ['patientName', 'studyDate', 'modality', 'sla']);

  it('returns the group profile when there is no override', () => {
    expect(visibleIds(resolveProfile(group, null))).toEqual(visibleIds(group));
  });

  it('lets the personal order win for the columns it mentions', () => {
    const personal = profileFromIds(PERSONAL_PROFILE_ID, ['modality', 'patientName']);
    const resolved = resolveProfile(group, personal);
    expect(visibleIds(resolved).slice(0, 2)).toEqual(['modality', 'patientName']);
  });

  it('keeps a group column the personal profile never touched', () => {
    // A column added to the group profile must reach everyone, not stay hidden
    // because someone saved a personal layout last year.
    const personal: typeof group = {
      id: PERSONAL_PROFILE_ID,
      columns: [{ id: 'modality', visible: true, width: 100 }],
    };
    expect(visibleIds(resolveProfile(group, personal))).toEqual(
      expect.arrayContaining(['sla', 'studyDate'])
    );
  });

  it('lets the personal profile hide a group column it did touch', () => {
    const personal = sanitizeProfile(
      { id: PERSONAL_PROFILE_ID, columns: [{ id: 'sla', visible: false, width: 110 }] },
      PERSONAL_PROFILE_ID
    );
    // sanitizeProfile lists every column, so `sla` counts as touched.
    expect(visibleIds(resolveProfile(group, personal))).not.toContain('sla');
  });

  it('never lets an override hide a required column', () => {
    const personal = sanitizeProfile(
      { id: PERSONAL_PROFILE_ID, columns: [{ id: 'patientName', visible: false, width: 100 }] },
      PERSONAL_PROFILE_ID
    );
    expect(visibleIds(resolveProfile(group, personal))).toContain('patientName');
  });

  it('takes the personal width', () => {
    const personal = sanitizeProfile(
      { id: PERSONAL_PROFILE_ID, columns: [{ id: 'modality', visible: true, width: 300 }] },
      PERSONAL_PROFILE_ID
    );
    const resolved = resolveProfile(group, personal);
    expect(resolved.columns.find(c => c.id === 'modality')?.width).toBe(300);
  });
});

describe('editing', () => {
  const profile = () => profileFromIds('x', ['patientName', 'studyDate', 'modality']);

  it('reorders', () => {
    expect(visibleIds(moveColumn(profile(), 0, 2)).slice(0, 3)).toEqual([
      'studyDate',
      'modality',
      'patientName',
    ]);
  });

  it('clamps a drop past the ends', () => {
    expect(() => moveColumn(profile(), 0, 9999)).not.toThrow();
    expect(moveColumn(profile(), 99, 0)).toEqual(profile());
    expect(moveColumn(profile(), 1, 1)).toEqual(profile());
  });

  it('hides and shows', () => {
    const hidden = setColumnVisible(profile(), 'modality', false);
    expect(visibleIds(hidden)).not.toContain('modality');
    expect(visibleIds(setColumnVisible(hidden, 'modality', true))).toContain('modality');
  });

  it('refuses to hide a required column', () => {
    expect(visibleIds(setColumnVisible(profile(), 'patientName', false))).toContain('patientName');
  });

  it('ignores an unknown column', () => {
    const base = profile();
    expect(setColumnVisible(base, 'ghost', false)).toBe(base);
    expect(setColumnWidth(base, 'ghost', 200)).toBe(base);
  });

  it('sets and clamps a width', () => {
    const wide = setColumnWidth(profile(), 'modality', 5);
    expect(wide.columns.find(c => c.id === 'modality')?.width).toBe(COLUMN_MIN_WIDTH);
    expect(clampColumnWidth('nope', 111)).toBe(111);
  });
});

describe('createLocalProfileStore', () => {
  const fakeStorage = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    } as unknown as Storage;
  };

  it('round-trips a profile', () => {
    const storage = fakeStorage();
    const store = createLocalProfileStore(storage);
    store.save(profileFromIds('radiologist', ['patientName', 'modality']));
    // Round-trips unchanged, required columns included.
    expect(visibleIds(createLocalProfileStore(storage).load('radiologist')!)).toEqual([
      'patientName',
      'modality',
      'studyDate',
    ]);
  });

  it('is null for an unknown id', () => {
    expect(createLocalProfileStore(fakeStorage()).load('nope')).toBeNull();
  });

  it('sanitises on load', () => {
    const storage = fakeStorage();
    storage.setItem(
      'rt.worklistProfile.v1.g',
      JSON.stringify({ id: 'g', columns: [{ id: 'ghost', visible: true, width: 1 }] })
    );
    expect(ids(createLocalProfileStore(storage).load('g')!)).not.toContain('ghost');
  });

  it('survives storage throwing', () => {
    const hostile = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    } as unknown as Storage;
    const store = createLocalProfileStore(hostile);
    expect(store.load('g')).toBeNull();
    expect(() => store.save(profileFromIds('g', ['patientName']))).not.toThrow();
  });
});
