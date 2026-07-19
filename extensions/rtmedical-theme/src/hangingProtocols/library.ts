/**
 * RT Medical hanging-protocol library (RTV-25).
 *
 * A factory-built set of ≥30 auto-matching protocols covering CT, MR, MG, US,
 * PET/CT, CR/DX, NM and XA, plus a few named clinical layouts. Each protocol is
 * produced by `gridProtocol`, so every entry is structurally valid by
 * construction (mirrors the stock @ohif/extension-default grid protocols) and
 * carries modality matching rules so the HangingProtocolService auto-selects on
 * study open. Zero-fork (RTV-114): pure protocol data, no core changes.
 *
 * NOTE: clinical appropriateness of each layout is pending radiologist sign-off;
 * sequence-specific selectors (e.g. MR brain T1/T2/FLAIR/DWI by SeriesDescription)
 * extend this same module.
 */

const seriesWithImages = [
  { weight: 10, attribute: 'numImageFrames', constraint: { greaterThan: { value: 0 } } },
];

interface GridSpec {
  id: string;
  name: string;
  /** Modalities to match (ModalitiesInStudy contains any); omit for a universal layout. */
  modalities?: string[];
  rows: number;
  cols: number;
  weight?: number;
}

/** Builds a structurally-valid N-up grid protocol matching the given modalities. */
export function gridProtocol({ id, name, modalities, rows, cols, weight = 15 }: GridSpec) {
  const total = rows * cols;
  return {
    id,
    locked: true,
    name,
    protocolMatchingRules: modalities
      ? [
          {
            id: `${id}-modality`,
            weight,
            attribute: 'ModalitiesInStudy',
            constraint: { containsAnyOf: modalities },
          },
        ]
      : [],
    toolGroupIds: ['default'],
    numberOfPriorsReferenced: 0,
    displaySetSelectors: {
      ds: { allowUnmatchedView: true, seriesMatchingRules: seriesWithImages },
    },
    defaultViewport: {
      viewportOptions: { viewportType: 'stack', toolGroupId: 'default', allowUnmatchedView: true },
      displaySets: [{ id: 'ds', matchedDisplaySetsIndex: -1 }],
    },
    stages: [
      {
        id: `${id}-stage`,
        name,
        // `columns` is the key core consumes (HangingProtocolService._updateViewports /
        // app ViewportGrid); `cols` is kept for existing consumers of this shape.
        viewportStructure: { layoutType: 'grid', properties: { rows, cols, columns: cols } },
        viewports: Array.from({ length: total }, (_unused, k) => ({
          viewportOptions: { toolGroupId: 'default', allowUnmatchedView: true },
          displaySets: [{ id: 'ds', matchedDisplaySetsIndex: k }],
        })),
      },
    ],
  };
}

const SPECS: GridSpec[] = [
  // ---- CT ----
  { id: 'rt-ct-1up', name: 'CT (1x1)', modalities: ['CT'], rows: 1, cols: 1 },
  { id: 'rt-ct-compare-1x2', name: 'CT Comparação (1x2)', modalities: ['CT'], rows: 1, cols: 2 },
  { id: 'rt-ct-chest-1x3', name: 'CT Tórax (1x3)', modalities: ['CT'], rows: 1, cols: 3 },
  { id: 'rt-ct-2x2', name: 'CT (2x2)', modalities: ['CT'], rows: 2, cols: 2 },
  { id: 'rt-ct-neuro-1up', name: 'CT Crânio AVC (1x1)', modalities: ['CT'], rows: 1, cols: 1, weight: 16 },
  // ---- MR ----
  { id: 'rt-mr-1up', name: 'MR (1x1)', modalities: ['MR'], rows: 1, cols: 1 },
  { id: 'rt-mr-compare-1x2', name: 'MR Comparação (1x2)', modalities: ['MR'], rows: 1, cols: 2 },
  { id: 'rt-mr-brain-2x2', name: 'MR Crânio (2x2 T1/T2/FLAIR/DWI)', modalities: ['MR'], rows: 2, cols: 2 },
  { id: 'rt-mr-multiseq-1x4', name: 'MR Multi-sequência (1x4)', modalities: ['MR'], rows: 1, cols: 4 },
  { id: 'rt-mr-perfusion-2x2', name: 'MR Crânio Perfusão (2x2)', modalities: ['MR'], rows: 2, cols: 2 },
  // ---- MG ----
  { id: 'rt-mg-1up', name: 'Mamografia (1x1)', modalities: ['MG'], rows: 1, cols: 1 },
  { id: 'rt-mg-ccmlo-2x2', name: 'Mamografia CC/MLO (2x2)', modalities: ['MG'], rows: 2, cols: 2 },
  { id: 'rt-mg-compare-1x4', name: 'Mamografia Bilateral (1x4)', modalities: ['MG'], rows: 1, cols: 4 },
  // ---- US ----
  { id: 'rt-us-1up', name: 'US (1x1)', modalities: ['US'], rows: 1, cols: 1 },
  { id: 'rt-us-doppler-1x2', name: 'US Doppler (1x2)', modalities: ['US'], rows: 1, cols: 2 },
  // ---- PET / PET-CT ----
  { id: 'rt-pt-1up', name: 'PET (1x1)', modalities: ['PT'], rows: 1, cols: 1 },
  { id: 'rt-petct-1x2', name: 'PET/CT (1x2)', modalities: ['PT', 'CT'], rows: 1, cols: 2 },
  { id: 'rt-petct-totalbody-2x2', name: 'PET/CT Total Body (2x2)', modalities: ['PT', 'CT'], rows: 2, cols: 2 },
  // ---- CR / DX (radiography) ----
  { id: 'rt-cr-1up', name: 'Raio-X (1x1)', modalities: ['CR', 'DX'], rows: 1, cols: 1 },
  { id: 'rt-cr-compare-1x2', name: 'Raio-X Comparação (1x2)', modalities: ['CR', 'DX'], rows: 1, cols: 2 },
  { id: 'rt-cr-pa-lat-1x2', name: 'Raio-X PA/Perfil (1x2)', modalities: ['CR', 'DX'], rows: 1, cols: 2 },
  // ---- NM ----
  { id: 'rt-nm-1up', name: 'Medicina Nuclear (1x1)', modalities: ['NM'], rows: 1, cols: 1 },
  { id: 'rt-nm-2x2', name: 'Medicina Nuclear (2x2)', modalities: ['NM'], rows: 2, cols: 2 },
  // ---- XA (angiography) ----
  { id: 'rt-xa-1up', name: 'Angiografia (1x1)', modalities: ['XA'], rows: 1, cols: 1 },
  { id: 'rt-xa-2x2', name: 'Angiografia (2x2)', modalities: ['XA'], rows: 2, cols: 2 },
  // ---- Generic / multi-modality layouts ----
  { id: 'rt-generic-1up', name: 'Genérico (1x1)', rows: 1, cols: 1, weight: 1 },
  { id: 'rt-generic-1x2', name: 'Genérico Comparação (1x2)', rows: 1, cols: 2, weight: 1 },
  { id: 'rt-generic-2x1', name: 'Genérico Empilhado (2x1)', rows: 2, cols: 1, weight: 1 },
  { id: 'rt-generic-2x2', name: 'Genérico (2x2)', rows: 2, cols: 2, weight: 1 },
  { id: 'rt-generic-3x3', name: 'Genérico (3x3)', rows: 3, cols: 3, weight: 1 },
];

export const rtHangingProtocolLibrary = SPECS.map(gridProtocol);
