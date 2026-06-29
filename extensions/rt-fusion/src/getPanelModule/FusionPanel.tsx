/**
 * Fusion config right-panel (RTV-197): choose fixed/moving layers, opacity,
 * blend mode, colormap and inversion, with a live CSS-blended preview.
 *
 * Config/state is the pure {@link ../fusionConfig}. Compositing the moving layer
 * onto the fixed layer in the cornerstone viewport (and applying the colormap
 * LUT from `@ohif/extension-rt-isodose`) is an integration follow-up. RTV-114:
 * `@ohif/ui-next` only.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@ohif/ui-next';
import {
  defaultFusionConfig,
  normalizeFusionConfig,
  buildLayerStyle,
  isFusable,
  FusionConfig,
  BLEND_MODES,
  FUSION_COLORMAPS,
} from '../fusionConfig';

interface ServicesManagerLike {
  services: Record<string, any>;
}
export interface FusionPanelProps {
  servicesManager: ServicesManagerLike;
}

interface LayerOption {
  id: string;
  label: string;
}

const IMAGE_MODALITIES = new Set(['CT', 'MR', 'PT', 'NM', 'PET']);

function readLayers(displaySetService: any): LayerOption[] {
  const all = displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  return (all as any[])
    .filter(ds => IMAGE_MODALITIES.has((ds?.Modality || '').toUpperCase()) && (ds?.numImageFrames ?? 1) > 0)
    .map(ds => ({
      id: ds.displaySetInstanceUID,
      label: `${ds.Modality || '?'} · ${ds.SeriesDescription || ds.SeriesNumber || ds.displaySetInstanceUID?.slice(0, 6)}`,
    }));
}

export function FusionPanel({ servicesManager }: FusionPanelProps): React.ReactElement {
  const displaySetService = servicesManager?.services?.displaySetService;
  const [layers, setLayers] = useState<LayerOption[]>(() => readLayers(displaySetService));
  const [config, setConfig] = useState<FusionConfig>(() => defaultFusionConfig());

  useEffect(() => {
    if (!displaySetService?.subscribe) return undefined;
    const resync = () => setLayers(readLayers(displaySetService));
    resync();
    const events = displaySetService.EVENTS ?? {};
    const subs = [events.DISPLAY_SETS_ADDED, events.DISPLAY_SETS_CHANGED, events.DISPLAY_SETS_REMOVED]
      .filter(Boolean)
      .map((e: string) => displaySetService.subscribe(e, resync));
    return () => subs.forEach((s: any) => s?.unsubscribe?.());
  }, [displaySetService]);

  const set = (patch: Partial<FusionConfig>) => setConfig(c => normalizeFusionConfig({ ...c, ...patch }));
  const style = useMemo(() => buildLayerStyle(config), [config]);

  return (
    <div className="ohif-scrollbar flex h-full flex-col overflow-auto px-2 py-2 text-sm text-white" data-cy="rt-fusion-panel">
      <span className="mb-2 text-base font-medium">Fusion</span>

      <label className="mb-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Fixed</span>
        <select className="max-w-[60%] rounded bg-black/30 p-1 text-sm" value={config.fixedLayerId ?? ''} onChange={e => set({ fixedLayerId: e.target.value || undefined })}>
          <option value="">—</option>
          {layers.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </label>
      <label className="mb-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Moving</span>
        <select className="max-w-[60%] rounded bg-black/30 p-1 text-sm" value={config.movingLayerId ?? ''} onChange={e => set({ movingLayerId: e.target.value || undefined })}>
          <option value="">—</option>
          {layers.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </label>

      <label className="mb-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Opacity {Math.round(config.opacity * 100)}%</span>
        <input type="range" min={0} max={100} value={Math.round(config.opacity * 100)} onChange={e => set({ opacity: Number(e.target.value) / 100 })} />
      </label>
      <label className="mb-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Blend</span>
        <select className="rounded bg-black/30 p-1 text-sm" value={config.blendMode} onChange={e => set({ blendMode: e.target.value as any })}>
          {BLEND_MODES.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <label className="mb-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Colormap</span>
        <select className="rounded bg-black/30 p-1 text-sm" value={config.colormap} onChange={e => set({ colormap: e.target.value as any })}>
          {FUSION_COLORMAPS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="mb-3 flex items-center gap-2">
        <input type="checkbox" checked={config.inverted} onChange={e => set({ inverted: e.target.checked })} />
        <span className="text-muted-foreground text-xs">Invert colormap</span>
      </label>

      <div className="text-muted-foreground mb-1 text-xs">Preview</div>
      <div className="relative mx-auto h-24 w-24 overflow-hidden rounded">
        <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg,#111,#555)' }} />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(135deg,#0bf,#f30)', opacity: style.opacity, mixBlendMode: style.mixBlendMode as any }}
        />
      </div>

      <div className="mt-2 text-xs">
        {isFusable(config)
          ? <span className="text-emerald-300">Ready to fuse (apply on viewport — follow-up).</span>
          : <span className="text-muted-foreground">Pick two distinct layers to fuse.</span>}
      </div>
      <Button className="mt-2" variant="ghost" size="sm" disabled={!isFusable(config)} onClick={() => undefined}>
        Apply fusion (viewport — follow-up)
      </Button>
      <p className="text-muted-foreground mt-2 text-xs">
        Viewport compositing (overlay + colormap LUT) is a cornerstone integration follow-up.
      </p>
    </div>
  );
}

export default FusionPanel;
