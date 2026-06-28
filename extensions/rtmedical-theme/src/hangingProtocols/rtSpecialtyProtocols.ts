/**
 * Specialty hanging protocols (RTV-55 neuro stroke, RTV-77 mammo comparison).
 * Sequence/view-matched layouts that select specific series by DICOM attributes.
 * Zero-fork (RTV-114): pure protocol data registered via getHangingProtocolModule.
 */
const VOI_SYNC = { type: 'voi', id: 'rtSpecialtyVoiSync', source: true, target: true } as const;

const sequenceSelector = (descriptionContains: string) => [
  { weight: 10, attribute: 'numImageFrames', constraint: { greaterThan: { value: 0 } } },
  { weight: 5, attribute: 'SeriesDescription', constraint: { contains: descriptionContains } },
];

const sequenceViewport = (id: string) => ({
  viewportOptions: { toolGroupId: 'default', allowUnmatchedView: true, syncGroups: [VOI_SYNC] },
  displaySets: [{ id }],
});

/**
 * RTV-55 — Neuro stroke (AVC): MR brain T1 / T2 / DWI / ADC in a 2×2 grid.
 */
export const rtNeuroStroke2x2 = {
  id: 'rt-neuro-stroke-2x2',
  locked: true,
  name: 'Neuro AVC (T1/T2/DWI/ADC 2x2)',
  protocolMatchingRules: [
    { id: 'mr', weight: 15, attribute: 'ModalitiesInStudy', constraint: { contains: 'MR' } },
    {
      id: 'brain',
      weight: 10,
      attribute: 'StudyDescription',
      constraint: { containsAnyOf: ['BRAIN', 'CRANIO', 'CRÂNIO', 'NEURO', 'AVC', 'STROKE', 'HEAD', 'ENCEFALO'] },
    },
  ],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: {
    t1: { allowUnmatchedView: true, seriesMatchingRules: sequenceSelector('T1') },
    t2: { allowUnmatchedView: true, seriesMatchingRules: sequenceSelector('T2') },
    dwi: { allowUnmatchedView: true, seriesMatchingRules: sequenceSelector('DWI') },
    adc: { allowUnmatchedView: true, seriesMatchingRules: sequenceSelector('ADC') },
  },
  defaultViewport: {
    viewportOptions: { viewportType: 'stack', toolGroupId: 'default', allowUnmatchedView: true },
    displaySets: [{ id: 't1', matchedDisplaySetsIndex: -1 }],
  },
  stages: [
    {
      id: 'rt-neuro-stroke-stage',
      name: 'AVC 2x2',
      viewportStructure: { layoutType: 'grid', properties: { rows: 2, columns: 2 } },
      viewports: [
        sequenceViewport('t1'),
        sequenceViewport('t2'),
        sequenceViewport('dwi'),
        sequenceViewport('adc'),
      ],
    },
  ],
};

/**
 * RTV-77 — Mammography prior/current comparison, 8-up (2 rows × 4 cols):
 *   row 1 (CC):  prior-R · current-R · current-L · prior-L
 *   row 2 (MLO): prior-R · current-R · current-L · prior-L
 * Each viewport selects by current/prior (studyInstanceUIDsIndex), ImageLaterality
 * (R/L) and ViewPosition (CC/MLO). MG match; needs one prior. W/L synced across all.
 */
const mammoKey = (study: 'c' | 'p', lat: 'R' | 'L', view: 'CC' | 'MLO') => `${study}-${lat}-${view}`;

const mammoSelector = (studyIndex: number, lat: string, view: string) => ({
  studyMatchingRules: [
    { attribute: 'studyInstanceUIDsIndex', from: 'options', required: true, constraint: { equals: { value: studyIndex } } },
  ],
  seriesMatchingRules: [
    { weight: 10, attribute: 'numImageFrames', constraint: { greaterThan: { value: 0 } } },
    { weight: 5, attribute: 'ViewPosition', constraint: { contains: view } },
    { weight: 5, attribute: 'ImageLaterality', constraint: { contains: lat } },
  ],
});

const mammoViewport = (id: string) => ({
  viewportOptions: { toolGroupId: 'default', allowUnmatchedView: true, syncGroups: [VOI_SYNC] },
  displaySets: [{ id }],
});

// Build the 8 display-set selectors keyed by study/laterality/view.
const mammoSelectors: Record<string, unknown> = {};
(['c', 'p'] as const).forEach(study =>
  (['R', 'L'] as const).forEach(lat =>
    (['CC', 'MLO'] as const).forEach(view => {
      mammoSelectors[mammoKey(study, lat, view)] = mammoSelector(study === 'c' ? 0 : 1, lat, view);
    })
  )
);

// Column order per row: prior-R, current-R, current-L, prior-L.
const mammoRow = (view: 'CC' | 'MLO') =>
  [
    mammoKey('p', 'R', view),
    mammoKey('c', 'R', view),
    mammoKey('c', 'L', view),
    mammoKey('p', 'L', view),
  ].map(mammoViewport);

export const rtMammoCompare8up = {
  id: 'rt-mammo-compare-8up',
  locked: true,
  name: 'Mamografia Comparação (8-up CC/MLO)',
  protocolMatchingRules: [
    { id: 'mg', weight: 20, attribute: 'ModalitiesInStudy', constraint: { contains: 'MG' } },
  ],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 1,
  displaySetSelectors: mammoSelectors,
  defaultViewport: {
    viewportOptions: { viewportType: 'stack', toolGroupId: 'default', allowUnmatchedView: true },
    displaySets: [{ id: mammoKey('c', 'R', 'CC'), matchedDisplaySetsIndex: -1 }],
  },
  stages: [
    {
      id: 'rt-mammo-8up-stage',
      name: '8-up CC/MLO',
      viewportStructure: { layoutType: 'grid', properties: { rows: 2, columns: 4 } },
      viewports: [...mammoRow('CC'), ...mammoRow('MLO')],
    },
  ],
};

export const rtSpecialtyProtocols = [rtNeuroStroke2x2, rtMammoCompare8up];
