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
import { ToolbarService, defaults } from '@ohif/core';
import { id } from './id';
import {
  cornerstone,
  basicLayout,
  basicRoute,
  extensionDependencies as basicDependencies,
  modeInstance as basicModeInstance,
  onModeEnter as basicOnModeEnter,
  onModeExit as basicOnModeExit,
  sopClassHandlers as basicSopClassHandlers,
  toolbarButtons as basicToolbarButtons,
  modeFactory,
} from '@ohif/mode-basic';

const { TOOLBAR_SECTIONS } = ToolbarService;

/** Panel ids contributed by RT Medical extensions (RTV-125). */
export const rtmedical = {
  keyImages: '@ohif/extension-rtmedical-key-images.panelModule.keyImages',
  laudo: 'rtmedical-theme.panelModule.laudo',
  rtTree: 'rtmedical-theme.panelModule.rtTree',
  roiWorkspace: '@ohif/extension-rt-struct.panelModule.roiWorkspace',
  plan: '@ohif/extension-rt-plan.panelModule.rtPlan',
  dvh: '@ohif/extension-rt-dvh.panelModule.dvh',
  isodose: '@ohif/extension-rt-isodose.panelModule.isodose',
  fusionTimeline: '@ohif/extension-rt-fusion-timeline.panelModule.fusionTimeline',
  rtPrint: '@ohif/extension-rt-print.panelModule.rtPrint',
  lineProfile: '@ohif/extension-measurements.panelModule.lineProfile',
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
  '@ohif/extension-rt-record': '^3.0.0',
  // RTV-32: density line-profile tool + panel.
  '@ohif/extension-measurements': '^3.0.0',
  // RTV-146 (Wave 3a): RTSTRUCT-in-MPR command (contour→labelmap).
  '@ohif/extension-rt-struct': '^3.0.0',
  // RTV Wave 4: TPS-style Eclipse layout (custom ViewerLayout + Info Window).
  '@ohif/extension-rt-tps': '^3.0.0',
};

/**
 * SOP Class handlers used to CREATE display sets in this mode. Mode.tsx calls
 * displaySetService.init(extensionManager, mode.sopClassHandlers), so a handler
 * that isn't listed here never runs — the RTPLAN/RT-record objects would fall to
 * the "unsupported" handler and their parsed models (ds.rtPlan, ds.rtRecord)
 * would never be attached, leaving the Ficha/Record panels empty. RTSTRUCT/RTDOSE
 * are already handled by the cornerstone-dicom-rt handler inherited from basic.
 */
export const sopClassHandlers = [
  ...basicSopClassHandlers,
  '@ohif/extension-rt-plan.sopClassHandlerModule.rtplan',
  '@ohif/extension-rt-record.sopClassHandlerModule.rtRecord',
];

/**
 * Planning layout: study browser left; right stack ordered for an RT planning
 * workflow (RTV-125): structures (RT Tree + contour segmentation) → dose
 * analysis (DVH + Isodoses) → registration (Fusion Timeline) → documentation
 * (Key Images, measurements, RT Print, Laudo/RT Report). The 2×2 grid ("4-up")
 * comes from the hanging protocol (RTV-127: axial/sagittal/coronal/3D MPR).
 */
export const radiotherapyLayout = {
  ...basicLayout,
  // RTV Wave 4: TPS-style Eclipse layout (custom layoutTemplateModule) — header +
  // left course tree + center MPR + Info Window bottom bar.
  id: '@ohif/extension-rt-tps.layoutTemplateModule.tps',
  props: {
    ...basicLayout.props,
    // Left = Eclipse Context Window: study browser + RT course tree (Scope) +
    // grouped structures workspace (Focus, autoseg-style — Wave 4/Phase 3).
    leftPanels: [...basicLayout.props.leftPanels, rtmedical.rtTree, rtmedical.roiWorkspace],
    leftPanelClosed: false,
    rightPanels: [
      // rtTree moved to the LEFT (Eclipse Context Window). Ficha/DVH/Isodoses
      // now live in the bottom Info Window; the right stack keeps segmentation
      // + documentation panels.
      cornerstone.segmentation,
      rtmedical.dvh,
      rtmedical.isodose,
      rtmedical.fusionTimeline,
      rtmedical.keyImages,
      cornerstone.measurements,
      rtmedical.lineProfile,
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

/**
 * Eclipse-style hotkeys (Wave 4 / Phase 6), appended to the OHIF defaults.
 * PageUp/PageDown page slices (the Varian slice-nav standard), Home/End jump to
 * the first/last slice, and Shift+M / Shift+3 toggle the RT structure renders
 * (bound to the rt-struct commands from Waves 3a/4). Ctrl+W (Eclipse auto-W/L) is
 * intentionally NOT bound — it closes the browser tab.
 */
const eclipseHotkeys = [
  { commandName: 'nextImage', label: 'Próximo corte (Page Down)', keys: ['pagedown'], isEditable: true },
  { commandName: 'previousImage', label: 'Corte anterior (Page Up)', keys: ['pageup'], isEditable: true },
  { commandName: 'firstImage', label: 'Primeiro corte', keys: ['home'], isEditable: true },
  { commandName: 'lastImage', label: 'Último corte', keys: ['end'], isEditable: true },
  { commandName: 'showRtStructInMpr', label: 'Estruturas em MPR', keys: ['shift+m'], isEditable: true },
  { commandName: 'showRtStructIn3D', label: 'Estruturas em 3D', keys: ['shift+3'], isEditable: true },
];

/** Extends @ohif/mode-basic's onModeEnter with RT auto-reveal (RTV-126). */
function onModeEnter(props) {
  basicOnModeEnter.call(this, props);

  const { servicesManager } = props;
  const { displaySetService, panelService, toolGroupService, customizationService } =
    servicesManager.services;

  // Phase 6: register the Eclipse hotkeys before Mode.tsx reads
  // 'ohif.hotkeyBindings' (it does so right after onModeEnter). Append to the
  // OHIF defaults so the standard bindings are preserved. Guard against
  // duplicate command bindings if entered more than once.
  try {
    const base = (defaults?.hotkeyBindings ?? []).filter(
      (b: any) => !eclipseHotkeys.some(h => h.commandName === b.commandName && h.keys?.[0] === b.keys?.[0])
    );
    customizationService?.setCustomizations?.({
      'ohif.hotkeyBindings': { $set: [...base, ...eclipseHotkeys] },
    });
  } catch (e) {
    /* customization/hotkeys unavailable — non-fatal */
  }

  // RTV-32: add the LineProfile tool (registered globally by the measurements
  // extension's preRegistration) to the default tool group so the toolbar
  // button can activate it. Passive so drawn profiles keep rendering.
  try {
    const tg = toolGroupService?.getToolGroup?.('default');
    if (tg && !tg.hasTool?.('LineProfile')) {
      tg.addTool('LineProfile');
      tg.setToolPassive?.('LineProfile');
    }
  } catch (e) {
    /* tool group not ready / tool unavailable — non-fatal */
  }

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
    // RTV-124: quick-access buttons that reveal the RT panels.
    'rtFusionPanel',
    'rtLaudoPanel',
    'rtPrintPanel',
    // RTV-146 (Wave 3a): render RTSTRUCT in MPR (contour→labelmap).
    'rtStructMpr',
    // Wave 4 (Phase 4): render RTSTRUCT as 3D Surface in the Model View.
    'rtStruct3D',
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
    // RTV-32: density line-profile tool.
    'LineProfile',
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
    'CalibrationLine',
    'Cine',
    'Capture',
    'TagBrowser',
  ],
};

/**
 * RTV-124 panel-action buttons: FUSÃO / LAUDO / IMPRESSÃO reveal the matching RT
 * side panel via the rtmedical-theme `activateRtPanel` command (which wraps
 * panelService.activatePanel — the same call the RTV-126 auto-reveal uses). Uses
 * the stock `ohif.toolButton` uiType, so no getToolbarModule is needed.
 */
/** Same shape as mode-basic's setToolActiveToolbar (activates the tool named by the button id). */
const setToolActiveToolbar = {
  commandName: 'setToolActiveToolbar',
  commandOptions: { toolGroupIds: ['default', 'mpr', 'SRToolGroup', 'volume3d'] },
};

const rtPanelButtons = [
  {
    // RTV-32: density line-profile drawing tool (added to the 'default' tool
    // group in onModeEnter; the LineProfile panel renders the sampled profile).
    id: 'LineProfile',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-length',
      label: 'Perfil',
      tooltip: 'Perfil de densidade (linha)',
      commands: setToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    // RTV-146 (Wave 3a): render RTSTRUCT contours in MPR (adds a labelmap rep).
    id: 'rtStructMpr',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tab-segmentation',
      label: 'Estruturas MPR',
      tooltip: 'Renderizar estruturas RT em MPR (labelmap)',
      commands: 'showRtStructInMpr',
    },
  },
  {
    // Wave 4 (Phase 4): render RTSTRUCT as a 3D Surface in the Model View.
    id: 'rtStruct3D',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-3d-rotate',
      label: 'Estruturas 3D',
      tooltip: 'Renderizar estruturas RT como superfície 3D (Model View)',
      commands: 'showRtStructIn3D',
    },
  },
  {
    id: 'rtFusionPanel',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-fusion-color',
      label: 'Fusão',
      tooltip: 'Abrir painel de Fusão',
      commands: [{ commandName: 'activateRtPanel', commandOptions: { panelId: rtmedical.fusionTimeline } }],
    },
  },
  {
    id: 'rtLaudoPanel',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tab-studies',
      label: 'Laudo',
      tooltip: 'Abrir painel de Laudo',
      commands: [{ commandName: 'activateRtPanel', commandOptions: { panelId: rtmedical.laudo } }],
    },
  },
  {
    id: 'rtPrintPanel',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-capture',
      label: 'Impressão',
      tooltip: 'Abrir painel de Impressão',
      commands: [{ commandName: 'activateRtPanel', commandOptions: { panelId: rtmedical.rtPrint } }],
    },
  },
];

export const radiotherapyToolbarButtons = [...basicToolbarButtons, ...rtPanelButtons];

export const modeInstance = {
  ...basicModeInstance,
  id,
  routeName: 'rtmedical-radiotherapy',
  displayName: 'Radioterapia',
  hide: false,
  routes: [radiotherapyRoute],
  sopClassHandlers,
  toolbarButtons: radiotherapyToolbarButtons,
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
