/**
 * Radiology hanging protocols (RTV-119).
 *
 * Registered by the rtmedical-theme extension and consumed by @rt/mode-radiology
 * (modeInstance.hangingProtocol = 'rt-radiology-default'). The HangingProtocolService
 * matches by study modality and falls back to the universal 1×1 default when no
 * richer layout matches. Shapes mirror the stock @ohif/extension-default protocols
 * (zero-fork, RTV-114). Specialty multi-series protocols (CT chest 4-up, MR brain
 * T1/T2/FLAIR/DWI) extend this set in the specialty epics.
 */

// A series is displayable if it carries image frames (filters out SEG/SR/empty).
const seriesWithImages = [
  {
    weight: 10,
    attribute: 'numImageFrames',
    constraint: { greaterThan: { value: 0 } },
  },
];

/** Universal 1×1 fallback — matches any study with images (covers all modalities). */
export const rtRadiologyDefault = {
  id: 'rt-radiology-default',
  locked: true,
  name: 'RT Radiologia (1x1)',
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: {
    rtDefaultDisplaySetId: {
      allowUnmatchedView: true,
      seriesMatchingRules: seriesWithImages,
    },
  },
  defaultViewport: {
    viewportOptions: {
      viewportType: 'stack',
      toolGroupId: 'default',
      allowUnmatchedView: true,
    },
    displaySets: [{ id: 'rtDefaultDisplaySetId', matchedDisplaySetsIndex: -1 }],
  },
  stages: [
    {
      id: 'rt-1x1',
      name: '1x1',
      viewportStructure: {
        layoutType: 'grid',
        properties: { rows: 1, columns: 1 },
      },
      viewports: [
        {
          viewportOptions: { toolGroupId: 'default', allowUnmatchedView: true },
          displaySets: [{ id: 'rtDefaultDisplaySetId' }],
        },
      ],
    },
  ],
};

/** Cross-sectional 2×2 — auto-matches CT/MR studies; otherwise the default applies. */
export const rtCrossSectional2x2 = {
  id: 'rt-cross-sectional-2x2',
  locked: true,
  name: 'RT Corte Transversal (2x2)',
  protocolMatchingRules: [
    {
      id: 'ct-or-mr',
      weight: 20,
      attribute: 'ModalitiesInStudy',
      constraint: { containsAnyOf: ['CT', 'MR', 'PT'] },
    },
  ],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: {
    rtDisplaySet: {
      allowUnmatchedView: true,
      seriesMatchingRules: seriesWithImages,
    },
  },
  defaultViewport: {
    viewportOptions: {
      viewportType: 'stack',
      toolGroupId: 'default',
      allowUnmatchedView: true,
    },
    displaySets: [{ id: 'rtDisplaySet', matchedDisplaySetsIndex: -1 }],
  },
  stages: [
    {
      id: 'rt-2x2',
      name: '2x2',
      stageActivation: { enabled: { minViewportsMatched: 1 } },
      viewportStructure: {
        layoutType: 'grid',
        properties: { rows: 2, columns: 2 },
      },
      viewports: [0, 1, 2, 3].map(index => ({
        viewportOptions: { toolGroupId: 'default', allowUnmatchedView: true },
        displaySets: [{ id: 'rtDisplaySet', matchedDisplaySetsIndex: index }],
      })),
    },
  ],
};

export const rtRadiologyProtocols = [rtRadiologyDefault, rtCrossSectional2x2];
