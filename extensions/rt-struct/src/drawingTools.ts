/**
 * RTSTRUCT Drawing Tools panel and operational context menu — pure core (RTV-214).
 *
 * Mirrors the Eclipse Drawing Tools panel: a catalogue of contour tools, the currently
 * active tool, the currently active structure, and the right-click menu that switches
 * tools without a trip to the panel.
 *
 * ## The principle the ticket states, enforced here
 *
 * **How you edit is independent of what the structure is.** The tool (Brush, Eraser,
 * Draw Planar Contour) is one axis; the clinical type of the structure — PTV, OAR, GTV,
 * per RTV-213 — is another; the *active* structure is a third. Eclipse keeps all three
 * visible at once because a physicist brushing on "Spleen" needs to know they are
 * brushing, and that they are brushing on Spleen. Collapsing any two of these into one
 * selection is how you get an eraser that quietly wipes the wrong organ.
 *
 * So the tool is selected without reference to the structure, and every edit
 * {@link requiresActiveStructure | that touches geometry} refuses when no structure is
 * active — rather than picking one, and rather than silently doing nothing.
 *
 * ## Listed, disabled, and honest about it
 *
 * Eclipse parity means the panel shows the whole family: Deform, Extract Wall,
 * Segmentation Wizard, and a dozen others. Most are not implemented here.
 *
 * A tool that appears in the panel and does nothing when clicked is worse than one that
 * is missing — the user cannot tell a no-op from a bug, and files the second. Hiding them
 * would lose the Eclipse-shaped map the physicist already knows. So every tool declares
 * {@link ToolSpec.implemented}, unimplemented ones are shown disabled with "ainda não
 * implementado", and {@link mvpTools} is the subset that actually works.
 *
 * ## Destructive tools are not one click from Brush
 *
 * "Clear Structure" empties an organ the physicist may have spent twenty minutes
 * contouring, and it sits in the same panel as the brush. It is marked destructive and
 * requires confirmation, and it is kept out of the quick context menu, which exists
 * precisely so tools can be switched fast and without looking.
 *
 * Framework-free, no cornerstone, no React. Zero-fork per RTV-114.
 */

export type ToolCategory = 'draw' | 'transform' | 'segmentation';

export type ToolId =
  // draw / edit
  | 'select'
  | 'drawPlanarContour'
  | 'drawVolumetricContour'
  | 'drawGeometricShape'
  | 'brush'
  | 'eraser'
  | 'floodFill'
  | 'clearStructure'
  | 'annotation'
  // transform / geometry
  | 'transformStructure'
  | 'deformStructure'
  | 'interpolateStructure'
  | 'marginForStructure'
  | 'cropStructure'
  | 'extractWall'
  | 'booleanOperators'
  | 'postProcessing'
  // segmentation
  | 'imageThresholding'
  | 'searchBody'
  | 'segmentationWizard'
  | 'extendSegmentation'
  | 'segmentHighDensityArtifacts';

export interface ToolSpec {
  id: ToolId;
  label: string;
  category: ToolCategory;
  /** False while the tool is panel-only: shown, disabled, and said so. */
  implemented: boolean;
  /** Needs a structure selected in the tree before it can do anything. */
  requiresStructure: boolean;
  /** Has an adjustable radius (Brush, Eraser). */
  sized?: boolean;
  /** Empties or replaces existing geometry. */
  destructive?: boolean;
  /** Offered in the right-click quick menu. */
  quick?: boolean;
}

/**
 * The full Eclipse-shaped catalogue.
 *
 * Order within a category is the Eclipse order, because a physicist finds these by
 * position as much as by name.
 */
export const TOOL_SPECS: ToolSpec[] = [
  { id: 'select', label: 'Select Structures', category: 'draw', implemented: true, requiresStructure: false, quick: true },
  { id: 'drawPlanarContour', label: 'Draw Planar Contour', category: 'draw', implemented: true, requiresStructure: true, quick: true },
  { id: 'drawVolumetricContour', label: 'Draw Volumetric Contour', category: 'draw', implemented: false, requiresStructure: true, quick: true },
  { id: 'drawGeometricShape', label: 'Draw Geometrical Shape', category: 'draw', implemented: false, requiresStructure: true },
  { id: 'brush', label: 'Brush', category: 'draw', implemented: true, requiresStructure: true, sized: true, quick: true },
  { id: 'eraser', label: 'Eraser', category: 'draw', implemented: true, requiresStructure: true, sized: true, quick: true },
  { id: 'floodFill', label: 'Flood Fill', category: 'draw', implemented: false, requiresStructure: true, quick: true },
  { id: 'clearStructure', label: 'Clear Structure', category: 'draw', implemented: true, requiresStructure: true, destructive: true },
  { id: 'annotation', label: 'Create or Edit Annotation', category: 'draw', implemented: false, requiresStructure: true },

  { id: 'transformStructure', label: 'Transform Structure', category: 'transform', implemented: false, requiresStructure: true, quick: true },
  { id: 'deformStructure', label: 'Deform Structure', category: 'transform', implemented: false, requiresStructure: true, quick: true },
  { id: 'interpolateStructure', label: 'Interpolate Structure', category: 'transform', implemented: false, requiresStructure: true, quick: true },
  { id: 'marginForStructure', label: 'Margin for Structure', category: 'transform', implemented: false, requiresStructure: true },
  { id: 'cropStructure', label: 'Crop Structure', category: 'transform', implemented: false, requiresStructure: true, quick: true },
  { id: 'extractWall', label: 'Extract Wall', category: 'transform', implemented: false, requiresStructure: true },
  { id: 'booleanOperators', label: 'Boolean Operators', category: 'transform', implemented: false, requiresStructure: true, quick: true },
  { id: 'postProcessing', label: 'Post Processing', category: 'transform', implemented: false, requiresStructure: true, quick: true },

  { id: 'imageThresholding', label: 'Image Thresholding', category: 'segmentation', implemented: false, requiresStructure: true },
  { id: 'searchBody', label: 'Search Body', category: 'segmentation', implemented: false, requiresStructure: false },
  { id: 'segmentationWizard', label: 'Segmentation Wizard', category: 'segmentation', implemented: false, requiresStructure: false },
  { id: 'extendSegmentation', label: 'Extend Segmentation', category: 'segmentation', implemented: false, requiresStructure: true },
  { id: 'segmentHighDensityArtifacts', label: 'Segment High Density Artifacts', category: 'segmentation', implemented: false, requiresStructure: false },
];

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  draw: 'Desenho / edição',
  transform: 'Transformação',
  segmentation: 'Segmentação',
};

export function findTool(id: unknown): ToolSpec | undefined {
  return TOOL_SPECS.find(t => t.id === id);
}

/** The tools that actually do something today. */
export function mvpTools(): ToolSpec[] {
  return TOOL_SPECS.filter(t => t.implemented);
}

export function requiresActiveStructure(id: unknown): boolean {
  return !!findTool(id)?.requiresStructure;
}

export const BRUSH_RADIUS_MM_MIN = 0.5;
export const BRUSH_RADIUS_MM_MAX = 50;
export const BRUSH_RADIUS_MM_DEFAULT = 5;

export function clampBrushRadius(mm: unknown): number {
  const n = Number(mm);
  if (!Number.isFinite(n)) {
    return BRUSH_RADIUS_MM_DEFAULT;
  }
  return Math.min(BRUSH_RADIUS_MM_MAX, Math.max(BRUSH_RADIUS_MM_MIN, n));
}

export interface DrawingToolsState {
  activeToolId: ToolId;
  /** ROI number of the structure being edited, as the RTSTRUCT numbers them. */
  activeStructureNumber?: number;
  brushRadiusMm: number;
  /**
   * "Smart" brush: constrained by image gradients rather than painting freely.
   *
   * Kept as a flag on the state rather than as two separate tools, because it is a
   * modifier on the same gesture — Eclipse shows one Brush with a mode, and splitting it
   * would double the panel and the muscle memory.
   */
  smartBrush: boolean;
}

export function defaultDrawingToolsState(): DrawingToolsState {
  return {
    activeToolId: 'select',
    brushRadiusMm: BRUSH_RADIUS_MM_DEFAULT,
    smartBrush: false,
  };
}

/**
 * Switches the active tool.
 *
 * Does **not** touch the active structure — that independence is the ticket's stated
 * principle. An unknown or unimplemented tool is refused, and the previous tool stays
 * active: silently landing on a no-op tool means the next click does nothing and the
 * physicist thinks the edit failed.
 */
export function selectTool(state: DrawingToolsState, id: unknown): DrawingToolsState {
  const spec = findTool(id);
  if (!spec || !spec.implemented) {
    return state;
  }
  return { ...state, activeToolId: spec.id };
}

/** Selects the structure being edited. Does not touch the active tool. */
export function selectStructure(
  state: DrawingToolsState,
  roiNumber: number | undefined
): DrawingToolsState {
  const n = Number(roiNumber);
  return {
    ...state,
    activeStructureNumber: Number.isFinite(n) ? n : undefined,
  };
}

export function setBrushRadius(state: DrawingToolsState, mm: unknown): DrawingToolsState {
  return { ...state, brushRadiusMm: clampBrushRadius(mm) };
}

export function setSmartBrush(state: DrawingToolsState, smart: boolean): DrawingToolsState {
  return { ...state, smartBrush: !!smart };
}

export type EditRefusal = 'noStructure' | 'notImplemented' | 'unknownTool';

export interface EditGate {
  allowed: boolean;
  reason?: EditRefusal;
  message?: string;
  /** True when the caller must confirm before applying. */
  confirm?: boolean;
}

/**
 * Whether the active tool may act right now.
 *
 * The three refusals are distinct because they need different UI: no structure is a
 * prompt, not-implemented is a disabled control, and unknown is a bug.
 */
export function canEdit(state: DrawingToolsState): EditGate {
  const spec = findTool(state?.activeToolId);
  if (!spec) {
    return { allowed: false, reason: 'unknownTool', message: 'Ferramenta desconhecida.' };
  }
  if (!spec.implemented) {
    return {
      allowed: false,
      reason: 'notImplemented',
      message: `${spec.label} ainda não implementada.`,
    };
  }
  if (spec.requiresStructure && !Number.isFinite(Number(state?.activeStructureNumber))) {
    return {
      allowed: false,
      reason: 'noStructure',
      message: 'Selecione uma estrutura na árvore antes de editar.',
    };
  }
  return { allowed: true, confirm: spec.destructive || undefined };
}

export interface PanelItem extends ToolSpec {
  active: boolean;
  enabled: boolean;
  disabledReason?: string;
}

export interface PanelGroup {
  category: ToolCategory;
  label: string;
  tools: PanelItem[];
}

/**
 * The panel, grouped as Eclipse groups it.
 *
 * Every tool is present; unimplemented ones and ones needing a structure come back
 * disabled with a reason, following the same rule as the worklist actions (RTV-190): a
 * greyed control with no explanation is the worst possible state.
 */
export function buildPanel(state: DrawingToolsState): PanelGroup[] {
  const hasStructure = Number.isFinite(Number(state?.activeStructureNumber));
  const categories: ToolCategory[] = ['draw', 'transform', 'segmentation'];

  return categories.map(category => ({
    category,
    label: CATEGORY_LABELS[category],
    tools: TOOL_SPECS.filter(t => t.category === category).map(spec => {
      let disabledReason: string | undefined;
      if (!spec.implemented) {
        disabledReason = 'Ainda não implementada.';
      } else if (spec.requiresStructure && !hasStructure) {
        disabledReason = 'Selecione uma estrutura.';
      }
      return {
        ...spec,
        active: state?.activeToolId === spec.id,
        enabled: !disabledReason,
        disabledReason,
      };
    }),
  }));
}

/**
 * The right-click quick menu.
 *
 * Only tools marked `quick`, and never a destructive one: the whole point of this menu is
 * switching fast without looking, which is exactly the wrong way to reach "Clear
 * Structure". Unimplemented tools are dropped rather than shown disabled — a quick menu
 * padded with dead entries is slower than a short one, and the panel is where the full map
 * lives.
 */
export function quickMenu(state: DrawingToolsState): PanelItem[] {
  const hasStructure = Number.isFinite(Number(state?.activeStructureNumber));
  return TOOL_SPECS.filter(t => t.quick && t.implemented && !t.destructive).map(spec => ({
    ...spec,
    active: state?.activeToolId === spec.id,
    enabled: !spec.requiresStructure || hasStructure,
    disabledReason:
      spec.requiresStructure && !hasStructure ? 'Selecione uma estrutura.' : undefined,
  }));
}

export interface StatusStructure {
  roiNumber: number;
  roiName: string;
  /** RTV-213 clinical type, e.g. PTV / ORGAN. Independent of the tool. */
  rtRoiInterpretedType?: string;
}

/**
 * The always-visible status line: active tool and active structure.
 *
 * Both, always, and never one standing in for the other — a physicist brushing on
 * "Spleen" needs to know they are brushing *and* that it is Spleen.
 */
export function describeStatus(
  state: DrawingToolsState,
  structure?: StatusStructure
): string {
  const tool = findTool(state?.activeToolId);
  const toolLabel = tool ? tool.label : '—';
  const sized = tool?.sized ? ` ${state.brushRadiusMm.toFixed(1)} mm` : '';
  const smart = tool?.sized && state?.smartBrush ? ' (smart)' : '';
  const target = structure?.roiName
    ? `${structure.roiName}${structure.rtRoiInterpretedType ? ` [${structure.rtRoiInterpretedType}]` : ''}`
    : 'nenhuma estrutura';
  return `${toolLabel}${sized}${smart} · ${target}`;
}
