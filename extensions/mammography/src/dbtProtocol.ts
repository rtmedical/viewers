/**
 * DBT four-up hanging protocol (RTV-76).
 *
 * CC on top, MLO below, right breast on the viewer's left, with `stack` and `voi`
 * sync groups on every tile so the slice slider and window/level move all four
 * together. Scrolling one tile to slice 30 and comparing against slice 1 in another
 * is exactly the mistake the sync prevents.
 *
 * Pure protocol data, same shape as the RTV-25 library in `rtmedical-theme` and the
 * Dixon protocol in `rt-mr-quant`. Registered through `getHangingProtocolModule`.
 */

import { DBT_HANGING_ORDER, DBT_TILE_LABELS, DbtTile } from './dbt';

export const DBT_PROTOCOL_ID = 'rt-mammo-dbt-4up';

interface MatchingRule {
  id: string;
  weight: number;
  attribute: string;
  constraint: Record<string, unknown>;
  required?: boolean;
}

/** Tokens that identify each tile in ViewPosition / SeriesDescription. */
const TILE_TOKENS: Record<DbtTile, { laterality: string[]; view: string[] }> = {
  RCC: { laterality: ['R'], view: ['CC'] },
  LCC: { laterality: ['L'], view: ['CC'] },
  RMLO: { laterality: ['R'], view: ['MLO'] },
  LMLO: { laterality: ['L'], view: ['MLO'] },
};

function selectorFor(tile: DbtTile) {
  const { laterality, view } = TILE_TOKENS[tile];
  const rules: MatchingRule[] = [
    {
      id: `${DBT_PROTOCOL_ID}-${tile}-laterality`,
      weight: 10,
      attribute: 'ImageLaterality',
      constraint: { containsAnyOf: laterality },
      required: false,
    },
    {
      id: `${DBT_PROTOCOL_ID}-${tile}-view`,
      weight: 10,
      attribute: 'ViewPosition',
      constraint: { containsAnyOf: view },
      required: false,
    },
    {
      // Only the tomosynthesis stack belongs here. A study carries the 2D mammogram
      // too, and hanging it in a slot whose slider does nothing is worse than empty.
      id: `${DBT_PROTOCOL_ID}-${tile}-multiframe`,
      weight: 20,
      attribute: 'numImageFrames',
      constraint: { greaterThan: { value: 1 } },
      required: true,
    },
  ];
  return { seriesMatchingRules: rules, allowUnmatchedView: true };
}

/** Slice and window/level move together across all four tiles. */
const DBT_SYNC_GROUPS = [
  { type: 'stack', id: 'dbtStack', source: true, target: true },
  { type: 'voi', id: 'dbtVoi', source: true, target: true },
];

export const dbtProtocol = {
  id: DBT_PROTOCOL_ID,
  locked: true,
  name: 'Mammography DBT (4-up)',
  protocolMatchingRules: [
    {
      id: `${DBT_PROTOCOL_ID}-modality`,
      weight: 25,
      attribute: 'ModalitiesInStudy',
      constraint: { containsAnyOf: ['MG'] },
    },
  ],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: DBT_HANGING_ORDER.reduce(
    (acc, tile) => {
      acc[tile] = selectorFor(tile);
      return acc;
    },
    {} as Record<string, ReturnType<typeof selectorFor>>
  ),
  defaultViewport: {
    viewportOptions: { viewportType: 'stack', toolGroupId: 'default', allowUnmatchedView: true },
    displaySets: [{ id: 'RCC', matchedDisplaySetsIndex: -1 }],
  },
  stages: [
    {
      id: `${DBT_PROTOCOL_ID}-stage`,
      name: 'DBT 4-up',
      viewportStructure: { layoutType: 'grid', properties: { rows: 2, cols: 2, columns: 2 } },
      viewports: DBT_HANGING_ORDER.map(tile => ({
        viewportOptions: {
          viewportId: `dbt-${tile}`,
          viewportType: 'stack',
          toolGroupId: 'default',
          allowUnmatchedView: true,
          syncGroups: DBT_SYNC_GROUPS,
        },
        displaySets: [{ id: tile }],
      })),
    },
  ],
};

/** Tile labels in layout order, for viewport overlays. */
export const dbtViewportLabels = DBT_HANGING_ORDER.map(t => DBT_TILE_LABELS[t]);

export const dbtProtocols = [dbtProtocol];

export default dbtProtocols;
