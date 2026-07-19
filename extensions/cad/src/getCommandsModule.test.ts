jest.mock('@cornerstonejs/core', () => ({
  metaData: { get: jest.fn() },
  utilities: { scroll: jest.fn() },
}));

jest.mock('i18next', () => ({
  __esModule: true,
  default: { t: jest.fn() },
}));

jest.mock('./findingsOverlay', () => ({
  attachCadFindingsOverlay: jest.fn(),
  cadFindingsViewportIds: jest.fn(() => []),
  detachCadFindingsOverlay: jest.fn(),
  getHighlightedFinding: jest.fn(),
  hasCadFindingsOverlay: jest.fn(),
  setHighlightedFinding: jest.fn(),
}));

import { findVisibleStackViewportId, waitForStackViewport } from './getCommandsModule';
import { metaData } from '@cornerstonejs/core';

describe('findVisibleStackViewportId', () => {
  const gridViewports = new Map([
    ['mpr', { displaySetInstanceUIDs: ['target-ds'] }],
    ['stack', { displaySetInstanceUIDs: ['target-ds'] }],
  ]);

  it('skips an orthographic viewport and reuses the visible stack', () => {
    const cornerstoneViewportService = {
      getCornerstoneViewport: jest.fn((id: string) => ({
        type: id === 'mpr' ? 'orthographic' : 'stack',
      })),
    };

    expect(findVisibleStackViewportId(gridViewports, cornerstoneViewportService, 'target-ds')).toBe(
      'stack'
    );
  });

  it('uses the active-viewport fallback when only MPR shows the display set', () => {
    const cornerstoneViewportService = {
      getCornerstoneViewport: jest.fn(() => ({ type: 'orthographic' })),
    };

    expect(
      findVisibleStackViewportId(
        new Map([['mpr', { displaySetInstanceUIDs: ['target-ds'] }]]),
        cornerstoneViewportService,
        'target-ds'
      )
    ).toBeUndefined();
  });
});

describe('waitForStackViewport', () => {
  const getInstance = metaData.get as jest.Mock;

  beforeEach(() => {
    getInstance.mockReset();
    getInstance.mockImplementation((_type: string, imageId: string) => ({
      SOPInstanceUID: imageId === 'target-image' ? 'target-sop' : 'old-sop',
    }));
  });

  it('does not accept stale imageIds from the previous display set', async () => {
    let imageIds = ['old-image'];
    const viewport = {
      type: 'stack',
      getImageIds: jest.fn(() => imageIds),
    };
    let containsTarget = false;
    const cornerstoneViewportService = {
      getCornerstoneViewport: jest.fn(() => viewport),
      getViewportInfo: jest.fn(() => ({
        hasDisplaySet: () => containsTarget,
      })),
    };

    setTimeout(() => {
      containsTarget = true;
    }, 2);
    setTimeout(() => {
      imageIds = ['target-image'];
    }, 10);

    await expect(
      waitForStackViewport(
        cornerstoneViewportService,
        'viewport-1',
        'target-ds',
        'target-sop',
        100,
        1
      )
    ).resolves.toBe(viewport);
    expect(cornerstoneViewportService.getCornerstoneViewport.mock.calls.length).toBeGreaterThan(1);
  });

  it('times out instead of returning the stale viewport', async () => {
    const viewport = {
      type: 'stack',
      getImageIds: jest.fn(() => ['old-image']),
    };
    const cornerstoneViewportService = {
      getCornerstoneViewport: jest.fn(() => viewport),
      getViewportInfo: jest.fn(() => ({
        hasDisplaySet: () => true,
      })),
    };

    await expect(
      waitForStackViewport(
        cornerstoneViewportService,
        'viewport-1',
        'target-ds',
        'target-sop',
        5,
        1
      )
    ).resolves.toBeUndefined();
  });

  it('requires a stack viewport with imageIds', async () => {
    const cornerstoneViewportService = {
      getCornerstoneViewport: jest.fn(() => ({
        type: 'orthographic',
        getImageIds: () => ['target-image'],
      })),
      getViewportInfo: jest.fn(() => ({
        hasDisplaySet: () => true,
      })),
    };

    await expect(
      waitForStackViewport(
        cornerstoneViewportService,
        'viewport-1',
        'target-ds',
        'target-sop',
        5,
        1
      )
    ).resolves.toBeUndefined();
  });
});
