/**
 * Parametric-map right panel (RTV-82): pick a perceptual LUT, set the display
 * range (or drive it as window/level), set the overlay opacity and the
 * transparency threshold, and read the colour-bar legend with units.
 *
 * All the arithmetic and colour lives in the pure cores ({@link ../parametricLut},
 * {@link ../parametricRange}); this component is state + markup only.
 *
 * The map kind is inferred from the active display set's SeriesDescription, so
 * opening an "ADC map" series pre-loads the conventional ADC window instead of
 * a meaningless 0-1 range.
 *
 * RTV-114: `@ohif/ui-next` conventions only, no core imports.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  lutCssGradient,
  PARAMETRIC_LUT_LABELS,
  PARAMETRIC_LUT_NAMES,
  ParametricLutName,
} from '../parametricLut';
import {
  buildLegendTicks,
  formatParametricValue,
  inferMapKind,
  ParametricMapKind,
  PARAMETRIC_MAP_DESCRIPTORS,
  PARAMETRIC_MAP_KINDS,
  rangeToWindow,
} from '../parametricRange';

interface ServicesManagerLike {
  services: Record<string, any>;
}

export interface ParametricMapPanelProps {
  servicesManager: ServicesManagerLike;
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
}

/** Reads the active viewport's display set description, if there is one. */
function activeSeriesDescription(servicesManager: ServicesManagerLike): string | undefined {
  const { displaySetService, viewportGridService } = servicesManager?.services ?? {};
  try {
    const activeViewportId = viewportGridService?.getActiveViewportId?.();
    const state = viewportGridService?.getState?.();
    const uids = state?.viewports?.get?.(activeViewportId)?.displaySetInstanceUIDs;
    const uid = uids?.[0];
    if (!uid) {
      return undefined;
    }
    return displaySetService?.getDisplaySetByUID?.(uid)?.SeriesDescription;
  } catch {
    // A panel must never take the viewer down because the grid was mid-update.
    return undefined;
  }
}

export function ParametricMapPanel({
  servicesManager,
  commandsManager,
}: ParametricMapPanelProps): React.ReactElement {
  const { viewportGridService } = servicesManager?.services ?? {};

  const [lut, setLut] = useState<ParametricLutName>('viridis');
  const [kind, setKind] = useState<ParametricMapKind>(() =>
    inferMapKind(activeSeriesDescription(servicesManager))
  );
  const descriptor = PARAMETRIC_MAP_DESCRIPTORS[kind] ?? PARAMETRIC_MAP_DESCRIPTORS.generic;

  const [min, setMin] = useState<number>(descriptor.defaultRange.min);
  const [max, setMax] = useState<number>(descriptor.defaultRange.max);
  const [opacity, setOpacity] = useState<number>(0.6);
  const [threshold, setThreshold] = useState<number>(descriptor.defaultRange.min);
  // Whether the reader has hand-edited the range; auto-detection stops overwriting it then.
  const [rangeTouched, setRangeTouched] = useState(false);

  // Follow the active viewport: a new series may be a different kind of map.
  useEffect(() => {
    if (!viewportGridService?.subscribe) {
      return undefined;
    }
    const resync = () => {
      const detected = inferMapKind(activeSeriesDescription(servicesManager));
      setKind(previous => (previous === detected ? previous : detected));
    };
    resync();
    const events = viewportGridService.EVENTS ?? {};
    const subs = [events.ACTIVE_VIEWPORT_ID_CHANGED, events.GRID_STATE_CHANGED]
      .filter(Boolean)
      .map((e: string) => viewportGridService.subscribe(e, resync));
    return () => subs.forEach((s: any) => s?.unsubscribe?.());
  }, [viewportGridService, servicesManager]);

  // Load the conventional window when the kind changes, unless the reader has
  // already set their own.
  useEffect(() => {
    if (rangeTouched) {
      return;
    }
    setMin(descriptor.defaultRange.min);
    setMax(descriptor.defaultRange.max);
    setThreshold(descriptor.defaultRange.min);
  }, [descriptor, rangeTouched]);

  const range = useMemo(() => ({ min, max }), [min, max]);
  const gradient = useMemo(() => lutCssGradient(lut, 12, 'to top'), [lut]);
  const ticks = useMemo(() => buildLegendTicks(range, kind, 5), [range, kind]);
  // Named windowLevel, not `window`: shadowing the global in a browser component
  // is a trap waiting for the next person who reaches for window.location here.
  const windowLevel = useMemo(() => rangeToWindow(range), [range]);

  const apply = () =>
    commandsManager?.runCommand('rtApplyParametricMap', {
      lut,
      kind,
      range,
      opacity,
      lowerThreshold: threshold,
    });

  const editRange = (setter: (value: number) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setRangeTouched(true);
    const value = Number(event.target.value);
    setter(Number.isFinite(value) ? value : 0);
  };

  return (
    <div
      className="ohif-scrollbar flex h-full flex-col overflow-auto px-2 py-2 text-sm text-white"
      data-cy="rt-parametric-map-panel"
    >
      <span className="mb-2 text-base font-medium">Parametric map</span>

      <label className="mb-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Map</span>
        <select
          className="rounded bg-black/30 p-1 text-sm"
          value={kind}
          onChange={e => {
            setKind(e.target.value as ParametricMapKind);
            setRangeTouched(false);
          }}
        >
          {PARAMETRIC_MAP_KINDS.map(k => (
            <option key={k} value={k}>
              {PARAMETRIC_MAP_DESCRIPTORS[k].label}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Colour map</span>
        <select
          className="rounded bg-black/30 p-1 text-sm"
          value={lut}
          onChange={e => setLut(e.target.value as ParametricLutName)}
        >
          {PARAMETRIC_LUT_NAMES.map(n => (
            <option key={n} value={n}>
              {PARAMETRIC_LUT_LABELS[n]}
            </option>
          ))}
        </select>
      </label>

      {/* Colour bar + ticks. The bar runs bottom-to-top, like a dose colorbar. */}
      <div className="mb-3 flex gap-2" style={{ height: 132 }}>
        <div className="w-4 rounded" style={{ background: gradient }} aria-hidden="true" />
        <div className="relative flex-1 text-[11px]">
          {ticks.map(tick => (
            <div
              key={tick.position}
              className="text-muted-foreground absolute left-0 -translate-y-1/2 whitespace-nowrap"
              style={{ bottom: `${tick.position * 100}%` }}
            >
              {tick.label}
            </div>
          ))}
        </div>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Min</span>
          <input
            type="number"
            className="rounded bg-black/30 p-1 text-sm"
            value={min}
            onChange={editRange(setMin)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Max</span>
          <input
            type="number"
            className="rounded bg-black/30 p-1 text-sm"
            value={max}
            onChange={editRange(setMax)}
          />
        </label>
      </div>

      <div className="text-muted-foreground mb-3 text-[11px]">
        W/L {formatParametricValue(windowLevel.windowWidth, kind, false)} /{' '}
        {formatParametricValue(windowLevel.windowCenter, kind)}
      </div>

      <label className="mb-2 flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">
          Opacity {Math.round(opacity * 100)}%
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={e => setOpacity(Number(e.target.value))}
        />
      </label>

      <label className="mb-3 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Transparent at or below</span>
        <input
          type="number"
          className="w-24 rounded bg-black/30 p-1 text-sm"
          value={threshold}
          onChange={e => setThreshold(Number(e.target.value) || 0)}
        />
      </label>

      <button
        type="button"
        className="mb-3 rounded bg-white/10 p-2 text-sm hover:bg-white/20"
        onClick={apply}
      >
        Apply to viewport
      </button>

      <p className="text-muted-foreground text-[11px]">
        Ramps are perceptually uniform, so colour distance tracks value distance —
        unlike rainbow maps, which invent edges. Dose-heat ramps live in the
        Isodoses panel.
      </p>
    </div>
  );
}

export default ParametricMapPanel;
