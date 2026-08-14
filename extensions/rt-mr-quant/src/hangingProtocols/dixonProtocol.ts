/**
 * DIXON 2x2 hanging protocol (RTV-83).
 *
 * Hangs the four Dixon reconstructions in one grid, water/fat on top and
 * in/out-phase below, with slice position and window/level synchronised so
 * scrolling one viewport scrolls all four — that synchronised scroll is the
 * whole point of the layout, because the reader is comparing the same slice
 * across reconstructions.
 *
 * Pure protocol data, mirroring the shape produced by
 * `extensions/rtmedical-theme/src/hangingProtocols/library.ts` (`gridProtocol`),
 * which is itself modelled on the stock `@ohif/extension-default` grid
 * protocols. Zero-fork per RTV-114: no core changes, the protocol is registered
 * through `getHangingProtocolModule`.
 *
 * Matching is done by SeriesDescription/ImageType via `seriesMatchingRules`,
 * using the same token vocabulary as {@link ../dixon}. The service evaluates
 * these declaratively, so the rules restate the vocabulary as `containsAnyOf`
 * constraints rather than calling `classifyDixonSeries` — a protocol has to be
 * serialisable data, not a function.
 */

import { DixonComponent, DIXON_HANGING_ORDER, DIXON_LABELS } from '../dixon';

export const DIXON_PROTOCOL_ID = 'rt-mr-dixon-2x2';

/**
 * Token sets per component, as the HangingProtocolService can evaluate them.
 *
 * These are intentionally the *unambiguous* spellings only. The ambiguous
 * abbreviations (`W`, `F`, `IP`, `OP`) are excluded here: a declarative
 * `containsAnyOf` cannot also require a DIXON technique marker, and without
 * that guard a bare `W` would match every T1-weighted series (see
 * `classifyDixonSeries` for the reasoning). Studies that only label their
 * components with abbreviations will not auto-hang; `detectDixonSet` still
 * identifies them for the panel and for a manual layout.
 */
const COMPONENT_TOKENS: Record<DixonComponent, string[]> = {
  water: ['WATER', 'WATER_ONLY', 'WATERONLY'],
  fat: ['FAT', 'FAT_ONLY', 'FATONLY'],
  inPhase: ['IN_PHASE', 'INPHASE', 'IN PHASE'],
  outPhase: ['OUT_PHASE', 'OUTPHASE', 'OUT OF PHASE', 'OPPOSED', 'OPPOSED_PHASE'],
};

/**
 * Fat-only must not match a fat-*saturated* series. The declarative rules cannot
 * express the veto that `classifyDixonSeries` applies, so the fat selector
 * carries a negative weight on the suppression tokens instead: a `T2 FS` series
 * scores below the threshold and loses to a genuine `FAT` series.
 */
const FAT_SUPPRESSION_TOKENS = ['FATSAT', 'FAT_SAT', 'FS', 'SPAIR', 'SPIR', 'STIR'];

/** A HangingProtocolService matching rule, as the service evaluates them. */
export interface MatchingRule {
  id: string;
  weight: number;
  attribute: string;
  constraint: { containsAnyOf?: string[]; greaterThan?: { value: number } };
  required?: boolean;
}

function selectorFor(component: DixonComponent): {
  seriesMatchingRules: MatchingRule[];
  allowUnmatchedView: boolean;
} {
  const rules: MatchingRule[] = [
    {
      id: `${DIXON_PROTOCOL_ID}-${component}-description`,
      weight: 10,
      attribute: 'SeriesDescription',
      constraint: { containsAnyOf: COMPONENT_TOKENS[component] },
      required: false,
    },
    {
      id: `${DIXON_PROTOCOL_ID}-${component}-imagetype`,
      weight: 10,
      attribute: 'ImageType',
      constraint: { containsAnyOf: COMPONENT_TOKENS[component] },
      required: false,
    },
    // Only series that actually carry frames are hangable.
    {
      id: `${DIXON_PROTOCOL_ID}-${component}-frames`,
      weight: 1,
      attribute: 'numImageFrames',
      constraint: { greaterThan: { value: 0 } },
      required: true,
    },
  ];

  if (component === 'fat') {
    rules.push({
      id: `${DIXON_PROTOCOL_ID}-fat-not-suppressed`,
      weight: -20,
      attribute: 'SeriesDescription',
      constraint: { containsAnyOf: FAT_SUPPRESSION_TOKENS },
      required: false,
    });
  }

  return { seriesMatchingRules: rules, allowUnmatchedView: true };
}

/**
 * Sync groups applied to every viewport in the layout.
 * `stack` keeps the slice index aligned; `voi` keeps window/level aligned.
 */
const DIXON_SYNC_GROUPS = [
  { type: 'stack', id: 'dixonStack', source: true, target: true },
  { type: 'voi', id: 'dixonVoi', source: true, target: true },
];

function viewportFor(component: DixonComponent) {
  return {
    viewportOptions: {
      viewportId: `dixon-${component}`,
      viewportType: 'stack',
      toolGroupId: 'default',
      allowUnmatchedView: true,
      syncGroups: DIXON_SYNC_GROUPS,
    },
    displaySets: [
      {
        id: component,
        // Shown in the viewport label so the reader can tell the four apart.
        options: { voiInverted: false },
      },
    ],
  };
}

export const dixonProtocol = {
  id: DIXON_PROTOCOL_ID,
  locked: true,
  name: 'MR Dixon (water / fat / in / out)',
  /**
   * Matches MR studies. The protocol still needs series-level matches to fill
   * the grid, so a plain MR study without Dixon series simply scores low and
   * loses to the generic MR layouts in the RTV-25 library.
   */
  protocolMatchingRules: [
    {
      id: `${DIXON_PROTOCOL_ID}-modality`,
      weight: 20,
      attribute: 'ModalitiesInStudy',
      constraint: { containsAnyOf: ['MR'] },
    },
  ],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: DIXON_HANGING_ORDER.reduce(
    (acc, component) => {
      acc[component] = selectorFor(component);
      return acc;
    },
    {} as Record<string, ReturnType<typeof selectorFor>>
  ),
  defaultViewport: {
    viewportOptions: { viewportType: 'stack', toolGroupId: 'default', allowUnmatchedView: true },
    displaySets: [{ id: 'water', matchedDisplaySetsIndex: -1 }],
  },
  stages: [
    {
      id: `${DIXON_PROTOCOL_ID}-stage`,
      name: 'Dixon 2x2',
      // `columns` is the key core consumes (HangingProtocolService._updateViewports);
      // `cols` is kept for parity with the RTV-25 library protocols.
      viewportStructure: { layoutType: 'grid', properties: { rows: 2, cols: 2, columns: 2 } },
      viewports: DIXON_HANGING_ORDER.map(viewportFor),
    },
  ],
};

/** Labels in layout order — for the panel and for viewport overlays. */
export const dixonViewportLabels = DIXON_HANGING_ORDER.map(c => DIXON_LABELS[c]);

export const dixonProtocols = [dixonProtocol];

export default dixonProtocols;
