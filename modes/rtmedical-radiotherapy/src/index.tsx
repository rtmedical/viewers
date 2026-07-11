/**
 * @rt/mode-radiotherapy (RTV-123) — RT Medical radiotherapy planning & QA base.
 *
 * RTV-114 extension-first / zero-fork: composes @ohif/mode-basic (which already
 * carries the RTSTRUCT/RTDOSE/RTPLAN sopClassHandlers + dicom-rt viewport) and
 * adds RT Medical panels. RT-specific tooling lands in follow-ups:
 *   - RTV-124 RT toolbar (FERRAMENTAS/LAYOUT/3D/ANOTAÇÕES + window/pan/zoom) —
 *     DONE via radiotherapyToolbarSections. The panel-action buttons
 *     (FUSÃO/LAUDO/IMPRESSÃO) need custom toolbar buttons + commands and are a
 *     follow-up; those panels are already reachable via their right-panel tabs.
 *   - RTV-125 RT panels (RT Tree, DVH, Isodoses, Fusion Timeline, RT Print, RT
 *     Report) — DONE: the panels below are contributed by the sibling @rt
 *     extensions (rt-dvh, rt-isodose, rt-fusion-timeline, rt-print) plus the
 *     rtmedical-theme RT Tree/Laudo panels, wired into the right-panel stack.
 *   - RTV-126 auto-load RT data (FICHA/DVH/CONTORNO) on mode enter — DONE:
 *     onModeEnter reveals the matching RT panel as soon as an RTPLAN/RTDOSE/
 *     RTSTRUCT display set is present (the panels self-parse on render).
 *   - RTV-127 proper 4-up MPR hanging protocol (axial/sagittal/coronal/3D) — DONE
 *   - RTV-128 RT hotkeys, RTV-129 PYLINAC QA sidecar
 */
import { ToolbarService } from '@ohif/core';
import { id } from './id';
import {
  cornerstone,
  basicLayout,
  basicRoute,
  extensionDependencies as basicDependencies,
  modeInstance as basicModeInstance,
  onModeEnter as basicOnModeEnter,
  onModeExit as basicOnModeExit,
  modeFactory,
} from '@ohif/mode-basic';

const { TOOLBAR_SECTIONS } = ToolbarService;

/** Panel ids contributed by RT Medical extensions (RTV-125). */
export const rtmedical = {
  keyImages: '@ohif/extension-rtmedical-key-images.panelModule.keyImages',
  laudo: 'rtmedical-theme.panelModule.laudo',
  rtTree: 'rtmedical-theme.panelModule.rtTree',
  plan: '@ohif/extension-rt-plan.panelModule.rtPlan',
  dvh: '@ohif/extension-rt-dvh.panelModule.dvh',
  isodose: '@ohif/extension-rt-isodose.panelModule.isodose',
  fusionTimeline: '@ohif/extension-rt-fusion-timeline.panelModule.fusionTimeline',
  rtPrint: '@ohif/extension-rt-print.panelModule.rtPrint',
};

export const extensionDependencies = {
  ...basicDependencies,
  '@ohif/extension-rtmedical-theme': '^3.0.0',
  '@ohif/extension-rtmedical-key-images': '^3.0.0',
  // RTV-125: RT analysis panels contributed by the sibling @rt extensions.
  '@ohif/extension-rt-plan': '^3.0.0',
  '@ohif/extension-rt-dvh': '^3.0.0',
  '@ohif/extension-rt-isodose': '^3.0.0',
  '@ohif/extension-rt-fusion-timeline': '^3.0.0',
  '@ohif/extension-rt-print': '^3.0.0',
};

/**
 * Planning layout: study browser left; right stack ordered for an RT planning
 * workflow (RTV-125): structures (RT Tree + contour segmentation) → dose
 * analysis (DVH + Isodoses) → registration (Fusion Timeline) → documentation
 * (Key Images, measurements, RT Print, Laudo/RT Report). The 2×2 grid ("4-up")
 * comes from the hanging protocol (RTV-127: axial/sagittal/coronal/3D MPR).
 */
export const radiotherapyLayout = {
  ...basicLayout,
  props: {
    ...basicLayout.props,
    rightPanels: [
      rtmedical.plan,
      rtmedical.rtTree,
      cornerstone.segmentation,
      rtmedical.dvh,
      rtmedical.isodose,
      rtmedical.fusionTimeline,
      rtmedical.keyImages,
      cornerstone.measurements,
      rtmedical.rtPrint,
      rtmedical.laudo,
    ],
    rightPanelClosed: false,
  },
};

export const radiotherapyRoute = {
  ...basicRoute,
  path: 'rtmedical-radiotherapy',
  layoutInstance: radiotherapyLayout,
};

/**
 * RTV-126 — RT data auto-load. When the modality on the left is present, reveal
 * the RT panel that parses it so the plan/dose/contour data show without a
 * manual click. Priority is plan → dose → contour: the highest-priority
 * modality present wins the active tab. The panels self-parse their display
 * sets on render, so activating the panel *is* the "load".
 */
const RT_AUTOLOAD = [
  { modality: 'RTPLAN', panelId: rtmedical.plan }, // FICHA
  { modality: 'RTDOSE', panelId: rtmedical.dvh }, // DVH
  { modality: 'RTSTRUCT', panelId: rtmedical.rtTree }, // CONTORNO
];

function activateRtPanel(panelService, displaySets = []) {
  const modalities = new Set((displaySets || []).map(ds => ds?.Modality).filter(Boolean));
  const rule = RT_AUTOLOAD.find(r => modalities.has(r.modality));
  if (rule) {
    panelService.activatePanel(rule.panelId, true);
  }
}

/** Extends @ohif/mode-basic's onModeEnter with RT auto-reveal (RTV-126). */
function onModeEnter(props) {
  basicOnModeEnter.call(this, props);

  const { servicesManager } = props;
  const { displaySetService, panelService } = servicesManager.services;

  // Reveal RT data already present when the mode is entered...
  activateRtPanel(panelService, displaySetService.getActiveDisplaySets());

  // ...and whenever new RT display sets arrive.
  this._rtAutoloadSubscriptions = [
    displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      ({ displaySetsAdded }) => activateRtPanel(panelService, displaySetsAdded)
    ),
  ];
}

/** Tears down the RTV-126 subscription, then runs the base onModeExit. */
function onModeExit(props) {
  (this._rtAutoloadSubscriptions || []).forEach(sub => sub?.unsubscribe?.());
  this._rtAutoloadSubscriptions = [];
  basicOnModeExit.call(this, props);
}

/**
 * RT planning toolbar (RTV-124). Keeps the full measurement/annotation tool set
 * plus the 3D/MPR tooling the 4-up hanging protocol (RTV-127) needs — Crosshairs
 * and TrackballRotate — which the clean radiology toolbar (RTV-117) omits.
 * Primary row groups: FERRAMENTAS (measurement/annotation), zoom/pan, window,
 * LAYOUT, 3D (Crosshairs), and MoreTools. Only these three sections are
 * overridden; the viewport action-menu sections inherit from @ohif/mode-basic.
 */
export const radiotherapyToolbarSections = {
  ...basicModeInstance.toolbarSections,
  [TOOLBAR_SECTIONS.primary]: [
    'MeasurementTools',
    'Zoom',
    'Pan',
    'WindowLevel',
    'Layout',
    'Crosshairs',
    'MoreTools',
  ],
  // FERRAMENTAS + ANOTAÇÕES: contour-friendly ROI/annotation tools for RT.
  MeasurementTools: [
    'Length',
    'Bidirectional',
    'Angle',
    'CobbAngle',
    'EllipticalROI',
    'RectangleROI',
    'CircleROI',
    'PlanarFreehandROI',
    'ArrowAnnotate',
  ],
  // 3D/MPR + view manipulation for planning review.
  MoreTools: [
    'Reset',
    'rotate-right',
    'flipHorizontal',
    'invert',
    'TrackballRotate',
    'StackScroll',
    'ImageSliceSync',
    'ReferenceLines',
    'Magnify',
    'Probe',
    'Cine',
    'Capture',
    'TagBrowser',
  ],
};

export const modeInstance = {
  ...basicModeInstance,
  id,
  routeName: 'rtmedical-radiotherapy',
  displayName: 'Radioterapia',
  hide: false,
  routes: [radiotherapyRoute],
  toolbarSections: radiotherapyToolbarSections,
  onModeEnter,
  onModeExit,
  // RTV-127: 4-up MPR (axial/sagittal/coronal/3D-bone) from rtmedical-theme.
  hangingProtocol: 'rt-radiotherapy-4up',
  extensions: extensionDependencies,
};

const mode = {
  id,
  modeFactory,
  modeInstance,
  extensionDependencies,
};

export default mode;
