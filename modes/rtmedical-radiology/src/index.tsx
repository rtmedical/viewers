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
  modeFactory,
} from '@ohif/mode-basic';

/** Panel ids contributed by RT Medical extensions. */
export const rtmedical = {
  keyImages: '@ohif/extension-rtmedical-key-images.panelModule.keyImages',
};

export const extensionDependencies = {
  ...basicDependencies,
  '@ohif/extension-rtmedical-theme': '^3.0.0',
  '@ohif/extension-rtmedical-key-images': '^3.0.0',
};

/** Diagnostic layout: study browser on the left, Key Images + measurements on the right. */
export const radiologyLayout = {
  ...basicLayout,
  props: {
    ...basicLayout.props,
    rightPanels: [rtmedical.keyImages, cornerstone.measurements],
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
  MoreTools: ['Reset', 'rotate-right', 'flipHorizontal', 'invert', 'Magnify', 'Cine'],
};

export const modeInstance = {
  ...basicModeInstance,
  id,
  routeName: 'rtmedical-radiology',
  displayName: 'Radiologia',
  hide: false,
  routes: [radiologyRoute],
  toolbarSections: radiologyToolbarSections,
  extensions: extensionDependencies,
};

const mode = {
  id,
  modeFactory,
  modeInstance,
  extensionDependencies,
};

export default mode;
