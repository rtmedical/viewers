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
import { addTool, ScaleOverlayTool, OrientationMarkerTool } from '@cornerstonejs/tools';
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
  bev: '@ohif/extension-rt-bev.panelModule.bev',
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
  // BEV: MLC/jaw aperture overlay on the RTIMAGE (DRR) stack viewport.
  '@ohif/extension-rt-bev': '^3.0.0',
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
      rtmedical.bev,
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
  { commandName: 'nextImage', label: 'Next slice (Page Down)', keys: ['pagedown'], isEditable: true },
  { commandName: 'previousImage', label: 'Previous slice (Page Up)', keys: ['pageup'], isEditable: true },
  { commandName: 'firstImage', label: 'First slice', keys: ['home'], isEditable: true },
  { commandName: 'lastImage', label: 'Last slice', keys: ['end'], isEditable: true },
  { commandName: 'showRtStructInMpr', label: 'Structures in MPR', keys: ['shift+m'], isEditable: true },
  { commandName: 'showRtStructIn3D', label: 'Structures in 3D', keys: ['shift+3'], isEditable: true },
];

/** autoseg reference-line palette (constants.ts): axial blue, sagittal yellow, coronal green. */
const AUTOSEG_REF_LINE_COLORS: Record<string, string> = {
  axial: '#4589ff',
  sagittal: '#f1c21b',
  coronal: '#24a148',
};

/**
 * Autoseg MPR styling on the `mpr` tool group (zero fork): recolour the Crosshairs
 * reference lines to the autoseg palette + make them draggable/rotatable (oblique
 * reslice), and add a physical scale bar (ScaleOverlay). Best-effort; re-run is safe.
 */
function applyAutosegMprStyling(mpr: any, cornerstoneViewportService: any): void {
  try {
    mpr.setToolConfiguration?.(
      'Crosshairs',
      {
        getReferenceLineColor: (viewportId: string) => {
          const orientation =
            cornerstoneViewportService?.getViewportInfo?.(viewportId)?.viewportOptions?.orientation;
          return AUTOSEG_REF_LINE_COLORS[orientation] || AUTOSEG_REF_LINE_COLORS.axial;
        },
        getReferenceLineControllable: () => true,
        getReferenceLineDraggableRotatable: () => true,
      },
      false // merge, keep viewportIndicators/autoPan
    );
  } catch (e) {
    /* config unavailable — non-fatal */
  }
  try {
    if (!mpr.hasTool?.('ScaleOverlay')) {
      try {
        addTool(ScaleOverlayTool);
      } catch (e) {
        /* already registered globally */
      }
      mpr.addTool?.('ScaleOverlay');
    }
    mpr.setToolEnabled?.('ScaleOverlay');
  } catch (e) {
    /* scale overlay unavailable — non-fatal */
  }
  try {
    cornerstoneViewportService?.getRenderingEngine?.()?.render?.();
  } catch (e) {
    /* ignore */
  }
}

/**
 * Autoseg-style 3D orientation cube ("boneco") in the `volume3d` viewport
 * (zero fork). Adds the stock Cornerstone3D OrientationMarkerTool to the 3D-only
 * `volume3d` tool group as a small bottom-right anatomical cube. The prior
 * attempt rendered a cube that filled the pane because the tool defaults to
 * minPixelSize 100 / maxPixelSize 300; the fix is small explicit pixel clamps
 * (viewportSize 0.15, min 50, max 120). Cube faces follow the DICOM LPS
 * convention with the autoseg palette (L/R blue, P/A green, H/F purple).
 * Best-effort + idempotent (guarded by the caller); safe to re-run.
 */
function applyVolume3dOrientationMarker(vol3d: any): boolean {
  if (!vol3d?.addTool) {
    return false;
  }
  const name = OrientationMarkerTool.toolName;
  try {
    if (!vol3d.hasTool?.(name)) {
      try {
        addTool(OrientationMarkerTool);
      } catch (e) {
        /* already registered globally */
      }
      vol3d.addTool(name, {
        orientationWidget: {
          enabled: true,
          viewportCorner: 'BOTTOM_RIGHT',
          viewportSize: 0.15,
          minPixelSize: 50,
          maxPixelSize: 120, // the giant-cube fix (tool default is 300)
        },
        overlayMarkerType: OrientationMarkerTool.OVERLAY_MARKER_TYPES.ANNOTATED_CUBE,
        overlayConfiguration: {
          [OrientationMarkerTool.OVERLAY_MARKER_TYPES.ANNOTATED_CUBE]: {
            faceProperties: {
              xPlus: { text: 'L', faceColor: '#4589ff', faceRotation: 90 },
              xMinus: { text: 'R', faceColor: '#4589ff', faceRotation: 270 },
              yPlus: { text: 'P', faceColor: '#24a148', faceRotation: 180 },
              yMinus: { text: 'A', faceColor: '#24a148' },
              zPlus: { text: 'H', faceColor: '#8a3ffc' },
              zMinus: { text: 'F', faceColor: '#8a3ffc' },
            },
            defaultStyle: {
              fontStyle: 'bold',
              fontFamily: 'Arial',
              fontColor: 'white',
              fontSizeScale: (res: number) => res / 2,
              edgeThickness: 0.1,
              edgeColor: '#161616',
              resolution: 200,
            },
          },
        },
      });
    }
    vol3d.setToolEnabled?.(name);
    return true;
  } catch (e) {
    /* tool group / 3D viewport not ready — caller will retry */
    return false;
  }
}

/** Map a viewport's camera view-plane normal to an anatomical plane label. */
function planeLabel(cornerstoneViewportService: any, viewportId: string): string {
  try {
    const vp = cornerstoneViewportService?.getCornerstoneViewport?.(viewportId);
    const n = vp?.getCamera?.()?.viewPlaneNormal;
    if (!n) {
      return '';
    }
    const ax = Math.abs(n[0]);
    const ay = Math.abs(n[1]);
    const az = Math.abs(n[2]);
    if (az >= ax && az >= ay) {
      return 'AXIAL';
    }
    if (ax >= ay) {
      return 'SAGITTAL';
    }
    return 'CORONAL';
  } catch (e) {
    return '';
  }
}

/**
 * Autoseg-style corner-overlay descriptors for the `viewportOverlay.*`
 * customization ids. Content functions read the resolved reference instance /
 * VOI / scale that OHIF passes at render time (see CustomizableViewportOverlay).
 */
function buildViewportOverlay(cornerstoneViewportService: any) {
  const text = (fn: (p: any) => any) => fn;
  return {
    'viewportOverlay.topLeft': {
      $set: [
        {
          id: 'PatientName',
          inheritsFrom: 'ohif.overlayItem',
          condition: ({ referenceInstance }: any) => !!referenceInstance?.PatientName,
          contentF: text(({ referenceInstance, formatters }: any) =>
            formatters?.formatPN ? formatters.formatPN(referenceInstance.PatientName) : String(referenceInstance.PatientName)
          ),
        },
        {
          id: 'PatientID',
          inheritsFrom: 'ohif.overlayItem',
          condition: ({ referenceInstance }: any) => !!referenceInstance?.PatientID,
          contentF: text(({ referenceInstance }: any) => referenceInstance.PatientID),
        },
      ],
    },
    'viewportOverlay.topRight': {
      $set: [
        {
          id: 'SeriesDescription',
          inheritsFrom: 'ohif.overlayItem',
          condition: ({ referenceInstance }: any) => !!referenceInstance?.SeriesDescription,
          contentF: text(({ referenceInstance }: any) => referenceInstance.SeriesDescription),
        },
        {
          id: 'ModalityImageIndex',
          inheritsFrom: 'ohif.overlayItem',
          contentF: text(({ referenceInstance, instanceNumber, instances }: any) => {
            const modality = referenceInstance?.Modality ?? '';
            const count = Array.isArray(instances) ? instances.length : undefined;
            const idx = instanceNumber != null ? `Im: ${instanceNumber}${count ? `/${count}` : ''}` : '';
            return [modality, idx].filter(Boolean).join('  ');
          }),
        },
      ],
    },
    'viewportOverlay.bottomLeft': {
      $set: [
        { id: 'WindowLevel', inheritsFrom: 'ohif.overlayItem.windowLevel' },
        // Drop OHIF's "zoom tool active" condition so zoom is always shown.
        { id: 'ZoomLevel', inheritsFrom: 'ohif.overlayItem.zoomLevel' },
      ],
    },
    'viewportOverlay.bottomRight': {
      $set: [
        {
          id: 'PlaneOrientation',
          inheritsFrom: 'ohif.overlayItem',
          contentF: text(({ viewportId }: any) => planeLabel(cornerstoneViewportService, viewportId)),
        },
      ],
    },
  };
}

/** Extends @ohif/mode-basic's onModeEnter with RT auto-reveal (RTV-126). */
function onModeEnter(props) {
  basicOnModeEnter.call(this, props);

  const { servicesManager } = props;
  const { displaySetService, panelService, toolGroupService, customizationService, cornerstoneViewportService } =
    servicesManager.services;

  // Autoseg-style viewport corner overlays (info in the viewport): patient +
  // series + modality/image-index + window-level + zoom + plane orientation.
  // Overridden through the stock `viewportOverlay.*` customization ids — zero
  // fork. Strings are English (i18n follow-up).
  try {
    customizationService?.setCustomizations?.(buildViewportOverlay(cornerstoneViewportService));
  } catch (e) {
    /* overlay customization unavailable — non-fatal */
  }

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

  // Autoseg-style MPR: turn Crosshairs ON once the viewports are ready, so the
  // reference lines are visible on load and dragging a line reslices the linked
  // planes (OHIF ships Crosshairs `disabled` in the `mpr` group). Reuses the
  // stock toolbar-toggle command (correct bindings/teardown) — zero fork.
  const { commandsManager } = props;
  let mprStyled = false;
  let marker3dApplied = false;
  // The user wants Crosshairs ALWAYS active — re-enable it whenever it is found
  // disabled (e.g. after a layout/protocol change), not just once on load. The
  // autoseg styling (ref-line colors + draggable + scale bar) is applied once.
  const ensureCrosshairs = () => {
    if (!commandsManager) {
      return;
    }
    try {
      const mpr = toolGroupService?.getToolGroup?.('mpr');
      if (!mpr?.hasTool?.('Crosshairs')) {
        return;
      }
      const mode = mpr.getToolOptions?.('Crosshairs')?.mode;
      if (mode == null || mode === 'Disabled') {
        commandsManager.runCommand('toggleActiveDisabledToolbar', {
          itemId: 'Crosshairs',
          toolGroupIds: ['mpr'],
        });
      }
      if (!mprStyled) {
        applyAutosegMprStyling(mpr, cornerstoneViewportService);
        mprStyled = true;
      }
    } catch (e) {
      /* tool group not ready yet — will retry on the next event */
    }
    // Autoseg-style 3D orientation cube on the volume3d pane, once it's ready.
    if (!marker3dApplied) {
      try {
        const vol3d = toolGroupService?.getToolGroup?.('volume3d');
        if (vol3d) {
          marker3dApplied = applyVolume3dOrientationMarker(vol3d);
        }
      } catch (e) {
        /* volume3d group not ready yet — retry on the next event */
      }
    }
  };
  if (cornerstoneViewportService?.subscribe && cornerstoneViewportService.EVENTS?.VIEWPORT_DATA_CHANGED) {
    this._rtCrosshairsSub = cornerstoneViewportService.subscribe(
      cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
      ensureCrosshairs
    );
  }

  // RTV-210 — touch/tablet gestures (iPad rounds): one-finger slice scroll,
  // pinch zoom + two-finger pan, double-tap reset, long-press context menu,
  // three-finger swipe = next/prev worklist study. The command lives in
  // rtmedical-theme (zero fork) and returns its teardown; keep it for
  // onModeExit, which does not receive commandsManager. The tool groups all
  // exist here — basicOnModeEnter ran initToolGroups above.
  try {
    this._rtTouchGesturesTeardown = commandsManager?.runCommand?.('applyTouchGestures', {
      toolGroupIds: ['default', 'mpr', 'SRToolGroup', 'volume3d'],
    });
  } catch (e) {
    /* touch gestures unavailable — non-fatal */
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

/** Tears down the RTV-126/RTV-210 subscriptions, then runs the base onModeExit. */
function onModeExit(props) {
  (this._rtAutoloadSubscriptions || []).forEach(sub => sub?.unsubscribe?.());
  this._rtAutoloadSubscriptions = [];
  this._rtCrosshairsSub?.unsubscribe?.();
  this._rtCrosshairsSub = undefined;
  // RTV-210: remove the touch gesture listeners (bindings die with the tool
  // groups, which basicOnModeExit destroys).
  try {
    this._rtTouchGesturesTeardown?.();
  } catch (e) {
    /* ignore */
  }
  this._rtTouchGesturesTeardown = undefined;
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
    // Wave 4 (Phase 5): RTDOSE color wash overlay on the MPR viewports.
    'rtDoseWash',
    // BEV: MLC/jaw aperture over the RTIMAGE (DRR) stack viewport (rt-bev).
    'rtBev',
    // Eclipse-style vector isodose lines over the MPR viewports.
    'rtIsodoseLines',
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
      label: 'Profile',
      tooltip: 'Density profile (line)',
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
      label: 'Structures MPR',
      tooltip: 'Render RT structures in MPR (labelmap)',
      commands: 'showRtStructInMpr',
    },
  },
  {
    // Wave 4 (Phase 4): render RTSTRUCT as a 3D Surface in the Model View.
    id: 'rtStruct3D',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-3d-rotate',
      label: 'Structures 3D',
      tooltip: 'Render RT structures as a 3D surface (Model View)',
      commands: 'showRtStructIn3D',
    },
  },
  {
    // Wave 4 (Phase 5): RTDOSE color wash overlay (stock addDisplaySetAsLayer).
    id: 'rtDoseWash',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-fusion-color',
      label: 'Dose Wash',
      tooltip: 'Overlay dose (RTDOSE) as color wash on the MPR',
      commands: 'showDoseWash',
    },
  },
  {
    // BEV (rt-bev): toggle the MLC/jaw aperture overlay on the RTIMAGE (DRR).
    id: 'rtBev',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-rectangle',
      label: 'BEV',
      tooltip: "Beam's Eye View (MLC) on the RTIMAGE",
      commands: 'toggleBev',
    },
  },
  {
    // Eclipse-style vector isodose lines (marching squares over the RTDOSE grid).
    id: 'rtIsodoseLines',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-freehand-line',
      label: 'Isodose Lines',
      tooltip: 'Toggle isodose lines (RTDOSE) on the MPR',
      commands: 'toggleIsodoseLines',
    },
  },
  {
    id: 'rtFusionPanel',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-fusion-color',
      label: 'Fusion',
      tooltip: 'Open Fusion panel',
      commands: [{ commandName: 'activateRtPanel', commandOptions: { panelId: rtmedical.fusionTimeline } }],
    },
  },
  {
    id: 'rtLaudoPanel',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tab-studies',
      label: 'Report',
      tooltip: 'Open Report panel',
      commands: [{ commandName: 'activateRtPanel', commandOptions: { panelId: rtmedical.laudo } }],
    },
  },
  {
    id: 'rtPrintPanel',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-capture',
      label: 'Print',
      tooltip: 'Open Print panel',
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
