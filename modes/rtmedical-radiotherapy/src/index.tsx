/**
 * @rt/mode-radiotherapy (RTV-123) — RT Medical radiotherapy planning & QA base.
 *
 * RTV-114 extension-first / zero-fork: composes @ohif/mode-basic (which already
 * carries the RTSTRUCT/RTDOSE/RTPLAN sopClassHandlers + dicom-rt viewport) and
 * adds RT Medical panels. RT-specific tooling lands in follow-ups:
 *   - RTV-124 RT toolbar (FERRAMENTAS/LAYOUT/3D/FUSÃO/ANOTAÇÕES/LAUDO/IMPRESSÃO)
 *   - RTV-125 RT panels (RT Tree, DVH, Isodoses, Fusion Timeline, RT Print, RT
 *     Report) — DONE: the panels below are contributed by the sibling @rt
 *     extensions (rt-dvh, rt-isodose, rt-fusion-timeline, rt-print) plus the
 *     rtmedical-theme RT Tree/Laudo panels, wired into the right-panel stack.
 *   - RTV-126 auto-load RT data on mode enter
 *   - RTV-127 proper 4-up MPR hanging protocol (axial/sagittal/coronal/3D) — DONE
 *   - RTV-128 RT hotkeys, RTV-129 PYLINAC QA sidecar
 */
import { id } from './id';
import {
  cornerstone,
  basicLayout,
  basicRoute,
  extensionDependencies as basicDependencies,
  modeInstance as basicModeInstance,
  modeFactory,
} from '@ohif/mode-basic';

/** Panel ids contributed by RT Medical extensions (RTV-125). */
export const rtmedical = {
  keyImages: '@ohif/extension-rtmedical-key-images.panelModule.keyImages',
  laudo: 'rtmedical-theme.panelModule.laudo',
  rtTree: 'rtmedical-theme.panelModule.rtTree',
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

export const modeInstance = {
  ...basicModeInstance,
  id,
  routeName: 'rtmedical-radiotherapy',
  displayName: 'Radioterapia',
  hide: false,
  routes: [radiotherapyRoute],
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
