import { getCommandsModule, srContextFromDisplaySets, toPnString } from './getCommandsModule';

describe('mammography getCommandsModule', () => {
  const { actions, definitions, defaultContext } = getCommandsModule();

  it('exposes downloadBiradsSr + storeBiradsSrToPacs in DEFAULT', () => {
    expect(defaultContext).toBe('DEFAULT');
    expect(Object.keys(definitions).sort()).toEqual(['downloadBiradsSr', 'storeBiradsSrToPacs']);
  });

  it('returns false for empty inputs (no dcmjs touched)', async () => {
    expect(actions.downloadBiradsSr()).toBe(false);
    await expect(actions.storeBiradsSrToPacs()).resolves.toBe(false);
  });
});

describe('toPnString (pure)', () => {
  it('normalizes strings, { Alphabetic } objects and arrays of them', () => {
    expect(toPnString('Doe^Jane')).toBe('Doe^Jane');
    expect(toPnString({ Alphabetic: 'Doe^Jane' })).toBe('Doe^Jane');
    expect(toPnString([{ Alphabetic: 'Doe^Jane' }])).toBe('Doe^Jane');
    expect(toPnString(undefined)).toBeUndefined();
    expect(toPnString({})).toBeUndefined();
  });
});

describe('srContextFromDisplaySets (pure)', () => {
  const instance = {
    PatientName: { Alphabetic: 'Doe^Jane' },
    PatientID: 'PID-1',
    PatientBirthDate: '19700101',
    PatientSex: 'F',
    StudyInstanceUID: '1.2.3',
    StudyDate: '20260721',
    StudyTime: '101500',
    AccessionNumber: 'ACC-1',
    ReferringPhysicianName: { Alphabetic: 'Ref^Doc' },
    StudyID: 'STU-7',
  };

  it('extracts the full study context (M2) from the first display set with an instance', () => {
    expect(srContextFromDisplaySets([{}, { instances: [instance] }])).toEqual({
      PatientName: 'Doe^Jane',
      PatientID: 'PID-1',
      PatientBirthDate: '19700101',
      PatientSex: 'F',
      StudyInstanceUID: '1.2.3',
      StudyDate: '20260721',
      StudyTime: '101500',
      AccessionNumber: 'ACC-1',
      ReferringPhysicianName: 'Ref^Doc',
      StudyID: 'STU-7',
    });
  });

  it('falls back to the singular `instance` field', () => {
    expect(srContextFromDisplaySets([{ instance }])?.StudyInstanceUID).toBe('1.2.3');
  });

  it('returns null when nothing usable is found', () => {
    expect(srContextFromDisplaySets([])).toBeNull();
    expect(srContextFromDisplaySets([{ instances: [{ PatientID: 'x' }] }])).toBeNull();
    expect(srContextFromDisplaySets(undefined as any)).toBeNull();
  });
});

describe('double-send guard (M1)', () => {
  const makeManagers = (storeImpl: (dataset: any) => Promise<unknown>) => {
    const toasts: any[] = [];
    const servicesManager = {
      services: {
        uiNotificationService: { show: (t: any) => toasts.push(t) },
        viewportGridService: { getActiveViewportId: () => 'vp-1' },
        cornerstoneViewportService: {
          getViewportDisplaySets: () => [
            { instances: [{ StudyInstanceUID: '1.2.3', PatientID: 'PID-1' }] },
          ],
        },
      },
    };
    const extensionManager = {
      getActiveDataSource: () => [{ store: { dicom: storeImpl } }],
    };
    return { servicesManager, extensionManager, toasts };
  };

  const assessment = { laterality: 'Right', density: 'b', findings: [], category: '1' };

  it('refuses a second store while one is in flight, then clears the flag', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const { servicesManager, extensionManager, toasts } = makeManagers(() => gate);
    const { actions } = getCommandsModule({ servicesManager, extensionManager });

    const first = actions.storeBiradsSrToPacs({ assessment });
    await expect(actions.storeBiradsSrToPacs({ assessment })).resolves.toBe(false);
    expect(toasts.some(t => t.message === 'An SR store is already running.')).toBe(true);

    release?.();
    await expect(first).resolves.toBe(true);
    // Flag cleared in finally → a fresh store goes through again.
    await expect(actions.storeBiradsSrToPacs({ assessment })).resolves.toBe(true);
  });

  it('clears the flag when the STOW fails', async () => {
    const { servicesManager, extensionManager, toasts } = makeManagers(() =>
      Promise.reject(new Error('offline'))
    );
    const { actions } = getCommandsModule({ servicesManager, extensionManager });
    await expect(actions.storeBiradsSrToPacs({ assessment })).resolves.toBe(false);
    // Not stuck: the retry reaches the STOW again (fails for the same PACS
    // reason) instead of being refused by a leaked in-progress flag.
    toasts.length = 0;
    await expect(actions.storeBiradsSrToPacs({ assessment })).resolves.toBe(false);
    expect(toasts.some(t => t.message === 'An SR store is already running.')).toBe(false);
    expect(toasts.some(t => /Failed to store/.test(t.message))).toBe(true);
  });
});
