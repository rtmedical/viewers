/**
 * Specialty hanging protocols (RTV-55 neuro stroke; RTV-77 mammo follows).
 * Sequence-matched layouts that select specific series by SeriesDescription.
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
 * Auto-matches MR studies (with a soft StudyDescription brain hint); each
 * viewport selects its sequence by SeriesDescription. W/L synced across panes;
 * slice sync available via the native ImageSliceSync toggle.
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

export const rtSpecialtyProtocols = [rtNeuroStroke2x2];
