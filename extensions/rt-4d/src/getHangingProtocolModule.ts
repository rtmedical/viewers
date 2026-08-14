/**
 * 4D hanging protocol (RTV-93).
 *
 * No protocol in the repo matches on *being 4D*: the upstream `default4D` matches
 * `ModalitiesInStudy` PT/CT (and its mode is gated behind a hardcoded
 * `study.mrn === 'M1'`), so a respiratory-gated 4D-CT gets an ordinary CT layout.
 * This protocol matches the `isDynamicVolume` attribute that
 * `extensions/default/src/getSopClassHandlerModule.js` already puts on the display
 * set, so it applies to any dynamic volume regardless of modality.
 *
 * Layout: a single large viewport. A 4D series is read by scrubbing phases in one
 * viewport, not by tiling them — the phase slider and cine are the navigation, and
 * an N-up grid of the same anatomy at N phases wastes the screen. The temporal
 * projection commands are what produce a second thing worth looking at.
 *
 * Pure protocol data; registered through the module. Zero-fork per RTV-114.
 */

export const DYNAMIC_4D_PROTOCOL_ID = 'rt-4d-dynamic';

export const dynamic4dProtocol = {
  id: DYNAMIC_4D_PROTOCOL_ID,
  locked: true,
  name: '4D / gated (single viewport)',
  /**
   * Weight sits above the generic modality grids in the RTV-25 library (15) so a
   * dynamic study prefers this, but stays below a study-specific clinical
   * protocol that a physicist has deliberately built.
   */
  protocolMatchingRules: [
    {
      id: `${DYNAMIC_4D_PROTOCOL_ID}-dynamic`,
      weight: 25,
      attribute: 'isDynamicVolume',
      constraint: { equals: { value: true } },
    },
  ],
  toolGroupIds: ['default'],
  numberOfPriorsReferenced: 0,
  displaySetSelectors: {
    dynamic: {
      allowUnmatchedView: true,
      seriesMatchingRules: [
        {
          id: `${DYNAMIC_4D_PROTOCOL_ID}-series-dynamic`,
          weight: 20,
          attribute: 'isDynamicVolume',
          constraint: { equals: { value: true } },
          required: true,
        },
        {
          id: `${DYNAMIC_4D_PROTOCOL_ID}-series-frames`,
          weight: 1,
          attribute: 'numImageFrames',
          constraint: { greaterThan: { value: 0 } },
          required: true,
        },
      ],
    },
  },
  defaultViewport: {
    viewportOptions: { viewportType: 'volume', toolGroupId: 'default', allowUnmatchedView: true },
    displaySets: [{ id: 'dynamic', matchedDisplaySetsIndex: -1 }],
  },
  stages: [
    {
      id: `${DYNAMIC_4D_PROTOCOL_ID}-stage`,
      name: '4D',
      viewportStructure: { layoutType: 'grid', properties: { rows: 1, cols: 1, columns: 1 } },
      viewports: [
        {
          viewportOptions: {
            viewportId: 'rt4d-main',
            // A volume viewport, because phase scrubbing swaps the whole volume's
            // dimension group rather than scrolling a stack of frames.
            viewportType: 'volume',
            toolGroupId: 'default',
            allowUnmatchedView: true,
          },
          displaySets: [{ id: 'dynamic' }],
        },
      ],
    },
  ],
};

export const dynamic4dProtocols = [dynamic4dProtocol];

/**
 * Registers the 4D protocols with the HangingProtocolService. Each entry's `name`
 * is the protocol id, matching `extensions/rtmedical-theme/src/getHangingProtocolModule.ts`.
 */
function getHangingProtocolModule() {
  return dynamic4dProtocols.map(protocol => ({ name: protocol.id, protocol }));
}

export default getHangingProtocolModule;
