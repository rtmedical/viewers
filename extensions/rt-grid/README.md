# @ohif/extension-rt-grid

Reference grid over the image — **RTV-142**. The migration of the legacy
connectviewer `DrawGridTool` + `MoveGridTool` + `grid_tool` Redux store.

Follows the **RTV-114** extension-first / zero-fork policy. Nothing here imports
`@ohif/core` or `@cornerstonejs/core`.

## Modules

| Module | Purpose |
| --- | --- |
| `grid` (`buildGridLines`, `moveGridMm`, `clampSpacingMm`, `serializeGrid`) | Pure, unit-tested model: spacing, offset, line generation, persistence |
| `gridOverlay` (`buildGridSvg`, `buildGridSvgDocument`, `mountGridOverlay`) | Pure SVG builder + a thin mount/unmount |
| `getCommandsModule` | `rtGridToggle`, `rtGridSetSpacing`, `rtGridAdjustSpacing`, `rtGridMove`, `rtGridResetOffset`, `rtGridRefresh`, `rtGridGetState` |

## Millimetres, not pixels

That is the whole point. A grid in pixels tells you nothing about the patient, and
changes meaning with zoom and with each series' pixel spacing. Millimetres survive
both, which is what makes the grid usable for eyeballing field placement.

**When `PixelSpacing` is missing, the grid falls back to pixels and says so** — the
toast reads `uncalibrated` and `rtGridToggle` returns `calibrated: false`. An
uncalibrated grid labelled in millimetres would be worse than an honest pixel grid.

## Two details worth knowing

**The offset is reduced modulo the spacing.** Dragging by 10 mm on a 10 mm grid is
the same grid, so the stored offset always stays inside one cell. Without it, a long
drag accumulates an ever-growing offset that eventually loses precision and makes
"reset" the only way back. A negative offset reads positive (−1 mm on a 10 mm grid
is 9 mm).

**A too-fine grid is coarsened, not truncated.** A 1 mm grid over a 1000 px field is
1001 lines per axis, redrawn on every pan, zoom and scroll. `buildGridLines`
multiplies the step until it fits under `GRID_MAX_LINES_PER_AXIS` and reports
`truncated: true`, which the toolbar surfaces as "coarsened to stay responsive".
Skipping every Nth line instead would draw a grid whose visible spacing is a lie.

## Rendering

The grid is built in **image pixel space** and mapped to the screen by one SVG
transform (`viewBox` + `preserveAspectRatio="none"`), rather than re-projecting
every line each frame: during pan and zoom the transform changes, the geometry does
not. The overlay is `pointer-events: none`, so it never eats a click meant for an
image tool.

`mountGridOverlay` is idempotent — mounting twice replaces rather than stacks, so a
re-render cannot leave two grids fighting.

## Toolbar

`rtGrid` (toggle), `rtGridInc` / `rtGridDec` (±5 mm), `rtGridReset` (origin) are
registered in `@rt/mode-radiotherapy` and `@rt/mode-radiology`, next to the slab
projection buttons.

## Scope / follow-ups

- **The drag gesture is not bound.** `rtGridMove({ deltaXMm, deltaYMm })` is the
  MoveGridTool's behaviour and is unit-tested, but wiring it to a Cornerstone3D
  mouse-drag tool (so the reader grabs the grid and pulls) is a separate step. Until
  then the command is drivable from a panel or a hotkey.
- **Redraw on pan/zoom/series change** needs `rtGridRefresh` on the relevant
  cornerstone events. The command is idempotent and cheap, but the subscriptions are
  not registered here.
- **Not validated in a browser.** The DEV1 box has no memory headroom to build and
  serve the viewer (see `docker/README.md`). The evidence is the unit tests,
  including the SVG markup and the jsdom mount/unmount behaviour — but not how the
  grid looks over a real image.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-grid/jest.config.js --ci
```
