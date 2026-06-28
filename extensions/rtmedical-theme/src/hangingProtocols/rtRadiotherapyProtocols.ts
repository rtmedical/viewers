/**
 * Radiotherapy hanging protocols (RTV-127).
 *
 * rt-radiotherapy-4up: 2×2 MPR — axial / 3D (VR bone) / coronal / sagittal —
 * for reconstructable CT/MR planning series. Mirrors the stock
 * @ohif/extension-cornerstone fourUp protocol (the `mpr` + `volume3d` tool
 * groups it references are created by @ohif/mode-basic's initToolGroups, which
 * @rt/mode-radiotherapy inherits), with self-contained sync groups so the
 * protocol carries no cross-extension imports (zero-fork, RTV-114).
 */

const HYDRATE_SEG_SYNC_GROUP = {
  type: 'hydrateseg',
  id: 'sameFORId',
  source: true,
  target: true,
  options: { matchingRules: ['sameFOR'] },
} as const;

const VOI_SYNC_GROUP = {
  type: 'voi',
  id: 'rtMprVoiSync',
  source: true,
  target: true,
} as const;

const reconstructableCtMr = [
  {
    weight: 1,
    attribute: 'isReconstructable',
    constraint: { equals: { value: true } },
    required: true,
  },
];

export const rtRadiotherapy4up = {
  id: 'rt-radiotherapy-4up',
  locked: true,
  name: 'RT Radioterapia (4-up MPR)',
  icon: 'layout-advanced-3d-four-up',
  isPreset: true,
  availableTo: {},
  editableBy: {},
  imageLoadStrategy: 'interleaveCenter',
  protocolMatchingRules: [
    {
      id: 'planning-ct-mr',
      weight: 20,
      attribute: 'ModalitiesInStudy',
      constraint: { containsAnyOf: ['CT', 'MR'] },
    },
  ],
  toolGroupIds: ['mpr', 'volume3d'],
  displaySetSelectors: {
    activeDisplaySet: {
      seriesMatchingRules: reconstructableCtMr,
    },
  },
  stages: [
    {
      id: 'rt-4up',
      name: '4up',
      viewportStructure: {
        layoutType: 'grid',
        properties: { rows: 2, columns: 2 },
      },
      viewports: [
        {
          viewportOptions: {
            toolGroupId: 'mpr',
            viewportType: 'volume',
            orientation: 'axial',
            initialImageOptions: { preset: 'middle' },
            syncGroups: [VOI_SYNC_GROUP, HYDRATE_SEG_SYNC_GROUP],
          },
          displaySets: [{ id: 'activeDisplaySet' }],
        },
        {
          viewportOptions: {
            toolGroupId: 'volume3d',
            viewportType: 'volume3d',
            orientation: 'coronal',
            customViewportProps: { hideOverlays: true },
            syncGroups: [HYDRATE_SEG_SYNC_GROUP],
          },
          displaySets: [
            {
              id: 'activeDisplaySet',
              options: {
                displayPreset: {
                  CT: 'CT-Bone',
                  MR: 'MR-Default',
                  default: 'CT-Bone',
                },
              },
            },
          ],
        },
        {
          viewportOptions: {
            toolGroupId: 'mpr',
            viewportType: 'volume',
            orientation: 'coronal',
            initialImageOptions: { preset: 'middle' },
            syncGroups: [VOI_SYNC_GROUP, HYDRATE_SEG_SYNC_GROUP],
          },
          displaySets: [{ id: 'activeDisplaySet' }],
        },
        {
          viewportOptions: {
            toolGroupId: 'mpr',
            viewportType: 'volume',
            orientation: 'sagittal',
            initialImageOptions: { preset: 'middle' },
            syncGroups: [VOI_SYNC_GROUP, HYDRATE_SEG_SYNC_GROUP],
          },
          displaySets: [{ id: 'activeDisplaySet' }],
        },
      ],
    },
  ],
};

export const rtRadiotherapyProtocols = [rtRadiotherapy4up];
