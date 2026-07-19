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
  sopClassHandlers as basicSopClassHandlers,
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
  ],
};

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
