import {
  BRUSH_RADIUS_MM_DEFAULT,
  BRUSH_RADIUS_MM_MAX,
  BRUSH_RADIUS_MM_MIN,
  buildPanel,
  canEdit,
  clampBrushRadius,
  defaultDrawingToolsState,
  describeStatus,
  DrawingToolsState,
  findTool,
  mvpTools,
  quickMenu,
  requiresActiveStructure,
  selectStructure,
  selectTool,
  setBrushRadius,
  setSmartBrush,
  TOOL_SPECS,
} from './drawingTools';

const withStructure = (over: Partial<DrawingToolsState> = {}): DrawingToolsState => ({
  ...defaultDrawingToolsState(),
  activeStructureNumber: 3,
  ...over,
});

describe('drawingTools — the catalogue', () => {
  it('mirrors the Eclipse panel across three categories', () => {
    expect(TOOL_SPECS.filter(t => t.category === 'draw').length).toBeGreaterThanOrEqual(9);
    expect(TOOL_SPECS.filter(t => t.category === 'transform').length).toBeGreaterThanOrEqual(8);
    expect(TOOL_SPECS.filter(t => t.category === 'segmentation').length).toBeGreaterThanOrEqual(5);
  });

  it('has no duplicate ids', () => {
    const ids = TOOL_SPECS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names the MVP set the ticket asked for', () => {
    const ids = mvpTools().map(t => t.id);
    expect(ids).toEqual(
      expect.arrayContaining(['brush', 'eraser', 'drawPlanarContour', 'select', 'clearStructure'])
    );
  });

  it('marks the geometry and segmentation families as not implemented yet', () => {
    expect(findTool('deformStructure')!.implemented).toBe(false);
    expect(findTool('segmentationWizard')!.implemented).toBe(false);
    expect(findTool('booleanOperators')!.implemented).toBe(false);
  });

  it('knows which tools need a structure', () => {
    expect(requiresActiveStructure('brush')).toBe(true);
    expect(requiresActiveStructure('select')).toBe(false);
    expect(requiresActiveStructure('searchBody')).toBe(false);
    expect(requiresActiveStructure('nope')).toBe(false);
  });
});

describe('drawingTools — tool and structure are independent axes', () => {
  // The ticket's stated principle. Collapsing the two is how you get an eraser that
  // quietly wipes the wrong organ.
  it('switching tool does not touch the active structure', () => {
    const state = selectTool(withStructure(), 'brush');
    expect(state.activeToolId).toBe('brush');
    expect(state.activeStructureNumber).toBe(3);
  });

  it('switching structure does not touch the active tool', () => {
    const state = selectStructure(selectTool(withStructure(), 'eraser'), 9);
    expect(state.activeToolId).toBe('eraser');
    expect(state.activeStructureNumber).toBe(9);
  });

  it('deselecting the structure keeps the tool armed', () => {
    const state = selectStructure(selectTool(withStructure(), 'brush'), undefined);
    expect(state.activeToolId).toBe('brush');
    expect(state.activeStructureNumber).toBeUndefined();
  });

  // Landing silently on a no-op tool means the next click does nothing and the physicist
  // thinks the edit failed.
  it('refuses to arm an unimplemented tool, keeping the previous one', () => {
    const before = selectTool(withStructure(), 'brush');
    expect(selectTool(before, 'deformStructure').activeToolId).toBe('brush');
    expect(selectTool(before, 'nonsense').activeToolId).toBe('brush');
  });
});

describe('drawingTools — the edit gate', () => {
  it('allows a brush on an active structure', () => {
    expect(canEdit(selectTool(withStructure(), 'brush'))).toEqual({ allowed: true });
  });

  it('refuses with no structure, and says to pick one', () => {
    const state = selectTool({ ...defaultDrawingToolsState(), activeToolId: 'brush' }, 'brush');
    const gate = canEdit(state);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('noStructure');
    expect(gate.message).toMatch(/Selecione uma estrutura/);
  });

  it('allows Select with no structure, because it is how you pick one', () => {
    expect(canEdit(defaultDrawingToolsState()).allowed).toBe(true);
  });

  it('distinguishes not-implemented from no-structure', () => {
    const state = { ...withStructure(), activeToolId: 'extractWall' as const };
    expect(canEdit(state).reason).toBe('notImplemented');
  });

  it('reports an unknown tool as a bug, not as a missing structure', () => {
    const state = { ...withStructure(), activeToolId: 'nope' as never };
    expect(canEdit(state).reason).toBe('unknownTool');
  });

  // Twenty minutes of contouring behind one click.
  it('requires confirmation for Clear Structure', () => {
    const state = selectTool(withStructure(), 'clearStructure');
    expect(canEdit(state)).toEqual({ allowed: true, confirm: true });
  });

  it('does not ask for confirmation for a brush stroke', () => {
    expect(canEdit(selectTool(withStructure(), 'brush')).confirm).toBeUndefined();
  });
});

describe('drawingTools — brush size and mode', () => {
  it('clamps the radius to something a physicist can actually paint with', () => {
    expect(clampBrushRadius(0)).toBe(BRUSH_RADIUS_MM_MIN);
    expect(clampBrushRadius(999)).toBe(BRUSH_RADIUS_MM_MAX);
    expect(clampBrushRadius(-4)).toBe(BRUSH_RADIUS_MM_MIN);
    expect(clampBrushRadius('abc')).toBe(BRUSH_RADIUS_MM_DEFAULT);
    expect(clampBrushRadius(7.5)).toBe(7.5);
  });

  it('sets radius and smart mode without disturbing the rest', () => {
    let state = setBrushRadius(selectTool(withStructure(), 'brush'), 12);
    state = setSmartBrush(state, true);
    expect(state.brushRadiusMm).toBe(12);
    expect(state.smartBrush).toBe(true);
    expect(state.activeToolId).toBe('brush');
    expect(state.activeStructureNumber).toBe(3);
  });

  // One Brush with a mode, not two tools: it is a modifier on the same gesture, and
  // splitting it would double the panel and the muscle memory.
  it('smart is a mode on the brush, not a separate tool', () => {
    expect(TOOL_SPECS.some(t => /smart/i.test(t.id))).toBe(false);
    expect(findTool('brush')!.sized).toBe(true);
  });
});

describe('drawingTools — the panel', () => {
  it('groups every tool, none dropped', () => {
    const panel = buildPanel(withStructure());
    expect(panel.map(g => g.category)).toEqual(['draw', 'transform', 'segmentation']);
    expect(panel.flatMap(g => g.tools)).toHaveLength(TOOL_SPECS.length);
  });

  it('marks the active tool', () => {
    const panel = buildPanel(selectTool(withStructure(), 'eraser'));
    const active = panel.flatMap(g => g.tools).filter(t => t.active);
    expect(active.map(t => t.id)).toEqual(['eraser']);
  });

  // A greyed control with no explanation is the worst possible state.
  it('never disables anything without saying why', () => {
    const disabled = buildPanel(defaultDrawingToolsState())
      .flatMap(g => g.tools)
      .filter(t => !t.enabled);
    expect(disabled.length).toBeGreaterThan(0);
    expect(disabled.every(t => !!t.disabledReason)).toBe(true);
  });

  // Hiding them loses the Eclipse-shaped map the physicist already knows; a silent no-op
  // gets filed as a bug.
  it('shows unimplemented tools disabled rather than hiding them', () => {
    const deform = buildPanel(withStructure())
      .flatMap(g => g.tools)
      .find(t => t.id === 'deformStructure')!;
    expect(deform.enabled).toBe(false);
    expect(deform.disabledReason).toMatch(/não implementada/);
  });

  it('disables structure-bound tools until one is selected', () => {
    const before = buildPanel(defaultDrawingToolsState()).flatMap(g => g.tools);
    expect(before.find(t => t.id === 'brush')!.disabledReason).toMatch(/Selecione uma estrutura/);
    expect(before.find(t => t.id === 'select')!.enabled).toBe(true);

    const after = buildPanel(withStructure()).flatMap(g => g.tools);
    expect(after.find(t => t.id === 'brush')!.enabled).toBe(true);
  });
});

describe('drawingTools — the operational context menu', () => {
  it('offers only working tools, for switching without looking', () => {
    const menu = quickMenu(withStructure());
    expect(menu.every(t => t.implemented)).toBe(true);
    expect(menu.map(t => t.id)).toEqual(expect.arrayContaining(['brush', 'eraser', 'select']));
  });

  // The menu exists so tools can be switched fast and without looking, which is exactly
  // the wrong way to reach "Clear Structure".
  it('never offers a destructive tool', () => {
    expect(quickMenu(withStructure()).some(t => t.destructive)).toBe(false);
    expect(quickMenu(withStructure()).some(t => t.id === 'clearStructure')).toBe(false);
  });

  // A quick menu padded with dead entries is slower than a short one.
  it('drops unimplemented tools instead of showing them disabled', () => {
    expect(quickMenu(withStructure()).some(t => t.id === 'deformStructure')).toBe(false);
    expect(quickMenu(withStructure()).length).toBeLessThan(TOOL_SPECS.length);
  });

  it('still greys the structure-bound tools when nothing is selected', () => {
    const menu = quickMenu(defaultDrawingToolsState());
    expect(menu.find(t => t.id === 'brush')!.enabled).toBe(false);
    expect(menu.find(t => t.id === 'select')!.enabled).toBe(true);
  });

  it('marks the active tool so the menu shows current state', () => {
    const menu = quickMenu(selectTool(withStructure(), 'brush'));
    expect(menu.find(t => t.active)!.id).toBe('brush');
  });
});

describe('drawingTools — the status line', () => {
  const spleen = { roiNumber: 3, roiName: 'Spleen', rtRoiInterpretedType: 'ORGAN' };

  // A physicist brushing on Spleen needs to know they are brushing AND that it is Spleen.
  it('shows tool and structure together', () => {
    const state = setBrushRadius(selectTool(withStructure(), 'brush'), 5);
    expect(describeStatus(state, spleen)).toBe('Brush 5.0 mm · Spleen [ORGAN]');
  });

  it('shows the smart modifier', () => {
    const state = setSmartBrush(setBrushRadius(selectTool(withStructure(), 'brush'), 3), true);
    expect(describeStatus(state, spleen)).toBe('Brush 3.0 mm (smart) · Spleen [ORGAN]');
  });

  it('omits the size for tools that have none', () => {
    expect(describeStatus(selectTool(withStructure(), 'select'), spleen)).toBe(
      'Select Structures · Spleen [ORGAN]'
    );
  });

  it('says plainly when no structure is active, rather than leaving a blank', () => {
    expect(describeStatus(defaultDrawingToolsState())).toBe(
      'Select Structures · nenhuma estrutura'
    );
  });

  it('survives a structure with no interpreted type', () => {
    expect(describeStatus(defaultDrawingToolsState(), { roiNumber: 1, roiName: 'PTV_70' })).toBe(
      'Select Structures · PTV_70'
    );
  });
});
