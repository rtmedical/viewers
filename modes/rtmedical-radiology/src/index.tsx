/**
 * @rt/mode-radiology (RTV-116) — RT Medical general diagnostic radiology workflow.
 *
 * RTV-114 extension-first / zero-fork: this mode only *composes* the upstream
 * `@ohif/mode-basic` (via immutability-helper spreads) and adds RT Medical
 * extensions through `extensionDependencies` + panel ids. It never modifies
 * @ohif/core | app | ui.
 *
 * Scope for the base ticket (RTV-116):
 *   - registered + selectable, displayName "Radiologia"
 *   - default 1x1 viewport layout with side panels
 *   - rightPanels include the Key Images panel (RTV-148) + measurements
 *   - extensionDependencies declared
 * The RT-specific toolbar (RTV-117), the full radiology panel set (RTV-118),
 * hanging protocols (RTV-119) and inline laudo (RTV-121) extend this base.
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

/** Panel ids contributed by RT Medical extensions. */
export const rtmedical = {
  keyImages: '@ohif/extension-rtmedical-key-images.panelModule.keyImages',
  laudo: 'rtmedical-theme.panelModule.laudo',
  // RTV-48: AHA 17-segment bullseye (cardiology).
  bullseye: '@ohif/extension-cardiology.panelModule.bullseye',
  // RTV-23: graphical hanging-protocol editor.
  hpEditor: 'rtmedical-theme.panelModule.hpEditor',
  // RTV-79/78: CAD SR findings panel + finding-marker overlay.
  cad: '@ohif/extension-cad.panelModule.cad',
};

export const extensionDependencies = {
  ...basicDependencies,
  '@ohif/extension-rtmedical-theme': '^3.0.0',
  '@ohif/extension-rtmedical-key-images': '^3.0.0',
  '@ohif/extension-cardiology': '^3.0.0',
  // RTV-79/78: Mammography/Chest CAD SR support.
  '@ohif/extension-cad': '^3.0.0',
  // RTV-203: viewport/layout screenshot → DICOM Secondary Capture → STOW-RS.
  '@ohif/extension-rt-capture': '^3.0.0',
  // RTV-211: GSDF/TG18 display QA — fullscreen /display-calibration route
  // (no toolbar button; access by URL).
  '@ohif/extension-rt-display-cal': '^3.0.0',
  // RTV-200: save/load W/L + annotations as DICOM Presentation States (GSPS).
  '@ohif/extension-rt-gsps': '^3.0.0',
};

/**
 * SOP Class handlers used to CREATE display sets in this mode. Mode.tsx calls
 * displaySetService.init(extensionManager, mode.sopClassHandlers), so a handler
 * that isn't listed here never runs — the Mammography/Chest CAD SR objects
 * would fall to the "unsupported" handler and their parsed findings
 * (ds.cadSr) would never be attached, leaving the CAD panel/overlay empty.
 */
export const sopClassHandlers = [
  ...basicSopClassHandlers,
  '@ohif/extension-cad.sopClassHandlerModule.cadSr',
  // RTV-200: stored GSPS objects → display sets carrying the parsed state.
  '@ohif/extension-rt-gsps.sopClassHandlerModule.gsps',
];

/** Diagnostic layout: study browser on the left, Key Images + measurements on the right. */
export const radiologyLayout = {
  ...basicLayout,
  props: {
    ...basicLayout.props,
    rightPanels: [
      rtmedical.keyImages,
      cornerstone.measurements,
      rtmedical.cad,
      rtmedical.bullseye,
      rtmedical.hpEditor,
      rtmedical.laudo,
    ],
    rightPanelClosed: false,
  },
};

export const radiologyRoute = {
  ...basicRoute,
  path: 'rtmedical-radiology',
  layoutInstance: radiologyLayout,
};

const { TOOLBAR_SECTIONS } = ToolbarService;

/**
 * Clean diagnostic toolbar (RTV-117): general radiology tools only — no RT
 * tooling (dose/beam/MLC/grid/contour). Applied by the inherited onModeEnter,
 * which registers `this.toolbarButtons` and calls `toolbarService.updateSection`
 * per entry. App-level CustomizationService can override these sections further.
 * All button ids below are provided by @ohif/mode-basic's toolbarButtons.
 */
export const radiologyToolbarSections = {
  ...basicModeInstance.toolbarSections,
  [TOOLBAR_SECTIONS.primary]: ['MeasurementTools', 'Zoom', 'Pan', 'WindowLevel', 'MoreTools'],
  MeasurementTools: ['Length', 'Angle', 'EllipticalROI', 'RectangleROI', 'PlanarFreehandROI'],
  // RTV-43: expose viewport sync toggles (scroll sync + reference lines).
  MoreTools: [
    'Reset',
    'rotate-right',
    'flipHorizontal',
    'invert',
    'Magnify',
    'Cine',
    'CalibrationLine',
    'ImageSliceSync',
    'ReferenceLines',
    // RTV-203: screenshot → DICOM Secondary Capture → PACS (STOW-RS).
    'rtCaptureSc',
    'rtCaptureLayoutSc',
    // RTV-200: save W/L + annotations as a DICOM Presentation State (GSPS).
    'rtGspsSave',
    'rtGspsApply',
    // RTV-95: cine → MP4/WebM video download of the active viewport.
    'rtCineExport',
    // RTV-15/19: slab projections (MIP/MinIP/AvgIP) + slab thickness ±.
    'rtMip',
    'rtMinIp',
    'rtAvgIp',
    'rtSlabInc',
    'rtSlabDec',
    'rtSlabOff',
  ],
};

/** RTV-203: Secondary Capture buttons (also bound to Alt+C in onModeEnter). */
const scToolbarButtons = [
  {
    id: 'rtCaptureSc',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-capture',
      label: 'Capture to PACS',
      tooltip: 'Save the active viewport to the PACS as DICOM Secondary Capture (Alt+C)',
      commands: 'captureViewportSc',
    },
  },
  {
    id: 'rtCaptureLayoutSc',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-stack-image-sync',
      label: 'Capture Layout',
      tooltip: 'Save the current layout (all viewports) to the PACS as one Secondary Capture',
      commands: 'captureLayoutSc',
    },
  },
  {
    // RTV-200: current W/L + annotations → DICOM GSPS → PACS (STOW-RS).
    id: 'rtGspsSave',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-capture',
      label: 'Save GSPS',
      tooltip:
        'Save the current window/level and annotations to the PACS as a DICOM Presentation State (GSPS)',
      commands: 'saveGsps',
    },
  },
  {
    // RTV-200: apply the newest stored GSPS of the loaded study (W/L; graphic
    // rehydration is GSPS Phase 2).
    id: 'rtGspsApply',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-window-level',
      label: 'Apply GSPS',
      tooltip: 'Apply the newest saved presentation state (window/level)',
      commands: 'applyGsps',
    },
  },
  {
    // RTV-95: cine → video — record the active viewport's frame sweep to
    // an MP4 (or WebM fallback) download.
    id: 'rtCineExport',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-cine',
      label: 'Export Cine',
      tooltip: 'Export the active viewport cine as an MP4/WebM video download',
      commands: 'exportCineVideo',
    },
  },
];

/**
 * RTV-15 (MIP/MinIP/AvgIP) + RTV-19 (2D slab): slab-projection buttons. The
 * mode buttons TOGGLE (re-clicking the active projection returns to normal
 * composite rendering); Slab +/− steps the thickness by 5 mm (0.5–100 mm).
 * The commands are registered by rtmedical-theme's getCommandsModule, act on
 * the ACTIVE viewport, and toast when it is not an MPR/volume viewport.
 */
const mipSlabToolbarButtons = [
  {
    id: 'rtMip',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-stack-scroll',
      label: 'MIP',
      tooltip: 'Maximum intensity projection over a slab (MPR viewports; click again to turn off)',
      commands: { commandName: 'setSlabProjection', commandOptions: { mode: 'mip' } },
      evaluate: {
        name: 'evaluate.displaySetIsReconstructable',
        disabledText: 'Slab projection requires a reconstructable (volume) series',
      },
    },
  },
  {
    id: 'rtMinIp',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-invert',
      label: 'MinIP',
      tooltip: 'Minimum intensity projection over a slab (MPR viewports; click again to turn off)',
      commands: { commandName: 'setSlabProjection', commandOptions: { mode: 'minip' } },
      evaluate: {
        name: 'evaluate.displaySetIsReconstructable',
        disabledText: 'Slab projection requires a reconstructable (volume) series',
      },
    },
  },
  {
    id: 'rtAvgIp',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-stack-image-sync',
      label: 'AvgIP',
      tooltip: 'Average intensity projection over a slab (MPR viewports; click again to turn off)',
      commands: { commandName: 'setSlabProjection', commandOptions: { mode: 'avg' } },
      evaluate: {
        name: 'evaluate.displaySetIsReconstructable',
        disabledText: 'Slab projection requires a reconstructable (volume) series',
      },
    },
  },
  {
    id: 'rtSlabInc',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'Plus',
      label: 'Slab +',
      tooltip: 'Increase slab thickness by 5 mm (max 100 mm)',
      commands: { commandName: 'adjustSlabThickness', commandOptions: { deltaMm: 5 } },
      evaluate: {
        name: 'evaluate.displaySetIsReconstructable',
        disabledText: 'Slab thickness requires a reconstructable (volume) series',
      },
    },
  },
  {
    id: 'rtSlabDec',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'Minus',
      label: 'Slab -',
      tooltip: 'Decrease slab thickness by 5 mm (min 0.5 mm)',
      commands: { commandName: 'adjustSlabThickness', commandOptions: { deltaMm: -5 } },
      evaluate: {
        name: 'evaluate.displaySetIsReconstructable',
        disabledText: 'Slab thickness requires a reconstructable (volume) series',
      },
    },
  },
  {
    // RTV-19: full reset — composite blend + hair-thin default slab (the
    // mode buttons only toggle their own projection).
    id: 'rtSlabOff',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'Close',
      label: 'Slab off',
      tooltip: 'Reset slab projection and thickness on the active viewport',
      commands: 'clearSlabProjection',
      evaluate: {
        name: 'evaluate.displaySetIsReconstructable',
        disabledText: 'Requires a reconstructable series',
      },
    },
  },
];

/**
 * RTV-210 — extends @ohif/mode-basic's onModeEnter with the touch/tablet
 * gesture layer (iPad rounds): one-finger slice scroll, pinch zoom +
 * two-finger pan, double-tap reset, long-press context menu, three-finger
 * swipe = next/prev worklist study. The 'applyTouchGestures' command is
 * registered by rtmedical-theme (zero fork) and returns its teardown, which
 * onModeExit uses — onModeExit does not receive commandsManager.
 */
function onModeEnter(props) {
  basicOnModeEnter.call(this, props);
  // RTV-212: centered spinner + shell skeleton while the study loads. The
  // component is registered by rtmedical-theme under its own namespace and
  // promoted to the stock id at MODE scope, so other modes keep the default.
  try {
    const { customizationService } = props.servicesManager.services;
    const rtLoading = customizationService?.getCustomization?.('rtmedical.loadingIndicatorProgress');
    if (rtLoading) {
      customizationService.setCustomizations({
        'ui.loadingIndicatorProgress': { $set: rtLoading },
      });
    }
  } catch (e) {
    /* loading customization unavailable — non-fatal */
  }
  try {
    this._rtTouchGesturesTeardown = props.commandsManager?.runCommand?.('applyTouchGestures', {
      toolGroupIds: ['default', 'mpr', 'SRToolGroup', 'volume3d'],
    });
  } catch (e) {
    /* touch gestures unavailable — non-fatal */
  }
  // RTV-203: Alt+C captures the active viewport to the PACS as DICOM SC.
  try {
    const { customizationService } = props.servicesManager.services;
    const scHotkey = {
      commandName: 'captureViewportSc',
      label: 'Capture to PACS (SC)',
      keys: ['alt+c'],
      isEditable: true,
    };
    const base = (defaults?.hotkeyBindings ?? []).filter(
      (b: { commandName?: string; keys?: string[] }) =>
        !(b.commandName === scHotkey.commandName && b.keys?.[0] === scHotkey.keys[0])
    );
    customizationService?.setCustomizations?.({
      'ohif.hotkeyBindings': { $set: [...base, scHotkey] },
    });
  } catch (e) {
    /* hotkey customization unavailable — non-fatal */
  }
}

/** Tears down the RTV-210 touch listeners, then runs the base onModeExit. */
function onModeExit(props) {
  try {
    this._rtTouchGesturesTeardown?.();
  } catch (e) {
    /* ignore */
  }
  this._rtTouchGesturesTeardown = undefined;
  basicOnModeExit.call(this, props);
}

export const modeInstance = {
  ...basicModeInstance,
  id,
  routeName: 'rtmedical-radiology',
  displayName: 'Radiologia',
  hide: false,
  routes: [radiologyRoute],
  toolbarSections: radiologyToolbarSections,
  // RTV-203: basic buttons + the Secondary Capture pair (registered by the
  // inherited basicOnModeEnter via toolbarService.register).
  // RTV-15/19: + the slab projection (MIP/MinIP/AvgIP) and Slab +/− buttons.
  toolbarButtons: [...basicToolbarButtons, ...scToolbarButtons, ...mipSlabToolbarButtons],
  // Overrides basic's implicit list so the CAD SR handler runs (see the
  // sopClassHandlers export above).
  sopClassHandlers,
  onModeEnter,
  onModeExit,
  // RTV-119: radiology HPs registered by rtmedical-theme; engine matches by
  // modality and falls back to this universal 1x1 default.
  hangingProtocol: 'rt-radiology-default',
  extensions: extensionDependencies,
};

const mode = {
  id,
  modeFactory,
  modeInstance,
  extensionDependencies,
};

export default mode;
