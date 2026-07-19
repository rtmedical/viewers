/**
 * Current/Prior comparison hanging protocol (RTV-22).
 *
 * 1×2 layout placing the current study (studyInstanceUIDsIndex 0) beside the
 * most-recent prior (index 1), following the stock @ohif/extension-default
 * hpCompare convention. Auto-activates when a prior is present
 * (numberOfPriorsReferenced: 1). Priors are chosen by selectPriors() and passed
 * via the viewer navigation (StudyInstanceUIDs=current,prior). Zero-fork (RTV-114).
 */
const seriesWithImages = [
  { weight: 10, attribute: 'numImageFrames', constraint: { greaterThan: { value: 0 } } },
];

// RTV-42: window-level (VOI) sync between the current and prior viewports.
// Scroll sync is left to the native ImageSliceSync toolbar toggle (optional).
const COMPARISON_VOI_SYNC = { type: 'voi', id: 'rtComparisonVoiSync', source: true, target: true } as const;

const studyAtIndex = (value: number) => [
  {
    attribute: 'studyInstanceUIDsIndex',
    from: 'options',
    required: true,
    constraint: { equals: { value } },
  },
];

export const rtComparison2up = {
  id: 'rt-comparison-2up',
  locked: true,
  name: 'RT Comparação Atual/Prior (1x2)',
  protocolMatchingRules: [],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 1,
  displaySetSelectors: {
    currentDisplaySet: {
      studyMatchingRules: studyAtIndex(0),
      seriesMatchingRules: seriesWithImages,
    },
    priorDisplaySet: {
      studyMatchingRules: studyAtIndex(1),
      seriesMatchingRules: seriesWithImages,
    },
  },
  defaultViewport: {
    viewportOptions: { viewportType: 'stack', toolGroupId: 'default', allowUnmatchedView: true },
    displaySets: [{ id: 'currentDisplaySet', matchedDisplaySetsIndex: -1 }],
  },
  stages: [
    {
      id: 'rt-comparison-stage',
      name: 'Atual/Prior',
      viewportStructure: { layoutType: 'grid', properties: { rows: 1, columns: 2 } },
      viewports: [
        {
          viewportOptions: {
            toolGroupId: 'default',
            allowUnmatchedView: true,
            syncGroups: [COMPARISON_VOI_SYNC],
          },
          displaySets: [{ id: 'currentDisplaySet' }],
        },
        {
          viewportOptions: {
            toolGroupId: 'default',
            allowUnmatchedView: true,
            syncGroups: [COMPARISON_VOI_SYNC],
          },
          displaySets: [{ id: 'priorDisplaySet' }],
        },
      ],
    },
  ],
};

export const rtComparisonProtocols = [rtComparison2up];
