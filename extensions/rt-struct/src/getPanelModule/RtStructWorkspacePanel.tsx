import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { segmentation as cstSegmentation, Enums as csToolsEnums } from '@cornerstonejs/tools';
import { useRtStructSegments, RtSegment } from './useRtStructSegments';
import {
  categorizeRoi,
  roiBadgeColor,
  contrastText,
  roiTypeLabel,
  categoryLabel,
  ROI_CATEGORY_ORDER,
  RoiCategory,
} from '../roiCategory';

/**
 * RT Structure "Focus" workspace — the left ROI list of the TPS layout
 * (RTV Wave 4 / Phase 3). Ported from the autoseg ROI Workspace
 * (components/viewer/{SegmentationPanel,SegmentRow}.tsx): structures grouped into
 * Alvos / Órgãos de risco / Externo-Suporte via `categorizeRoi`, each row with a
 * visibility eye, colour swatch, name and a derived type badge (GTV/CTV/PTV/…).
 * Collapsible groups with a count pill that bulk-toggles group visibility, plus a
 * global opacity slider + Fill/Outline toggle. Display-only (no editing) — the
 * editor bits (rename/recolor/delete/boolean/margin/collab) are intentionally dropped.
 */

const Eye = ({ off = false }: { off?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    {off ? (
      <>
        <path
          d="M2 8s2.5-4 6-4c1 0 1.9.3 2.7.8M14 8s-2.5 4-6 4c-1 0-1.9-.3-2.7-.8"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </>
    ) : (
      <>
        <path d="M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8Z" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="8" cy="8" r="1.8" fill="currentColor" />
      </>
    )}
  </svg>
);

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}
    aria-hidden
  >
    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function SegmentRow({
  segment,
  onToggle,
  onSelect,
}: {
  segment: RtSegment;
  onToggle: (index: number, visible: boolean) => void;
  onSelect: (index: number) => void;
}) {
  const cls = categorizeRoi(segment.label);
  const badgeBg = roiBadgeColor(cls, segment.color);
  const badgeFg = cls.category === 'target' ? '#ffffff' : contrastText(segment.color);
  const [r, g, b] = segment.color;
  return (
    <li
      className={`flex items-center gap-1 border-l-2 border-transparent px-2 hover:bg-white/5 ${
        segment.visible ? '' : 'opacity-55'
      }`}
    >
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground shrink-0 p-1"
        title={segment.visible ? 'Ocultar' : 'Mostrar'}
        aria-label={segment.visible ? 'Ocultar estrutura' : 'Mostrar estrutura'}
        onClick={() => onToggle(segment.segmentIndex, !segment.visible)}
      >
        <Eye off={!segment.visible} />
      </button>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent py-2 text-left"
        title={segment.label}
        onClick={() => onSelect(segment.segmentIndex)}
      >
        <span
          className="border-input h-3.5 w-3.5 shrink-0 rounded-[2px] border"
          style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }}
        />
        <span className="text-foreground min-w-0 flex-1 truncate text-[13px]">{segment.label}</span>
      </button>
      <span
        className="inline-flex h-5 shrink-0 items-center rounded-full pl-2 pr-2 text-[11px] font-semibold leading-none"
        style={{ backgroundColor: badgeBg, color: badgeFg }}
        title={roiTypeLabel(cls)}
      >
        {roiTypeLabel(cls)}
      </span>
    </li>
  );
}

export interface RtStructWorkspacePanelProps {
  servicesManager: any;
}

export function RtStructWorkspacePanel({
  servicesManager,
}: RtStructWorkspacePanelProps): React.ReactElement {
  const {
    segmentations,
    selectedId,
    setSelectedId,
    segments,
    hydrated,
    setVisibility,
    setGroupVisibility,
    setActive,
  } = useRtStructSegments(servicesManager);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showControls, setShowControls] = useState(false);
  const [opacity, setOpacity] = useState(100);
  const [outlineOnly, setOutlineOnly] = useState(false);

  // Group segments by clinical category, preserving order and dropping empties.
  const groups = useMemo(() => {
    const byCat: Record<RoiCategory, RtSegment[]> = { target: [], oar: [], external: [] };
    segments.forEach(s => byCat[categorizeRoi(s.label).category].push(s));
    return ROI_CATEGORY_ORDER.map(cat => ({ cat, members: byCat[cat] })).filter(
      g => g.members.length > 0
    );
  }, [segments]);

  // Apply a global labelmap style change (opacity / fill-outline) to the MPR
  // labelmap rendering; best-effort + re-render. No-op if no labelmap rep yet.
  const applyStyle = useCallback(
    (nextOpacity: number, nextOutlineOnly: boolean) => {
      if (!selectedId) {
        return;
      }
      const fillAlpha = Math.max(0, Math.min(1, nextOpacity / 100));
      [
        csToolsEnums.SegmentationRepresentations.Labelmap,
        csToolsEnums.SegmentationRepresentations.Contour,
      ].forEach(type => {
        try {
          cstSegmentation.config.style.setStyle(
            { segmentationId: selectedId, type },
            {
              renderFill: !nextOutlineOnly,
              renderOutline: true,
              outlineWidth: 2,
              fillAlpha: nextOutlineOnly ? 0 : fillAlpha,
            } as any,
            true
          );
        } catch {
          /* rep/type absent */
        }
      });
      try {
        servicesManager?.services?.cornerstoneViewportService
          ?.getRenderingEngine?.()
          ?.render?.();
      } catch {
        /* ignore */
      }
    },
    [selectedId, servicesManager]
  );

  // Re-apply the current opacity/outline controls to the newly selected
  // segmentation so the rendered structures always match what the controls show
  // (setStyle is keyed per segmentationId, so switching plans would otherwise
  // leave the new one at its default style).
  useEffect(() => {
    if (selectedId) {
      applyStyle(opacity, outlineOnly);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const onOpacity = (v: number) => {
    setOpacity(v);
    applyStyle(v, outlineOnly);
  };
  const onOutline = (v: boolean) => {
    setOutlineOnly(v);
    applyStyle(opacity, v);
  };

  if (!hydrated) {
    return (
      <div className="text-muted-foreground p-3 text-sm" data-cy="rt-struct-workspace">
        Nenhuma estrutura carregada. Hidrate a RTSTRUCT para visualizar as estruturas.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-cy="rt-struct-workspace">
      <div className="flex shrink-0 items-center justify-between px-2 py-2">
        <span className="text-base font-medium">Estruturas ({segments.length})</span>
        <button
          type="button"
          className={`p-1 ${showControls ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          title="Controles de exibição"
          aria-label="Controles de exibição"
          onClick={() => setShowControls(s => !s)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.2" />
            <path
              d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {segmentations.length > 1 && (
        <select
          className="border-input bg-muted/40 mx-2 mb-2 rounded border p-1 text-sm"
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          data-cy="rt-struct-workspace-select"
        >
          {segmentations.map(s => (
            <option key={s.segmentationId} value={s.segmentationId}>
              {s.label}
            </option>
          ))}
        </select>
      )}

      {showControls && (
        <div className="border-input mx-2 mb-2 flex flex-col gap-2 border-b pb-2">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground w-16">Opacidade</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={opacity}
              onChange={e => onOpacity(Number(e.target.value))}
              className="flex-1"
              data-cy="rt-struct-opacity"
            />
            <span className="w-8 text-right tabular-nums">{opacity}%</span>
          </label>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground w-16">Modo</span>
            <button
              type="button"
              className={`rounded px-2 py-0.5 ${!outlineOnly ? 'bg-primary text-primary-foreground' : 'bg-muted/40'}`}
              onClick={() => onOutline(false)}
            >
              Preenchido
            </button>
            <button
              type="button"
              className={`rounded px-2 py-0.5 ${outlineOnly ? 'bg-primary text-primary-foreground' : 'bg-muted/40'}`}
              onClick={() => onOutline(true)}
            >
              Contorno
            </button>
          </div>
        </div>
      )}

      <div className="ohif-scrollbar min-h-0 flex-1 overflow-auto">
        {groups.map(({ cat, members }) => {
          const anyVisible = members.some(m => m.visible);
          const isCollapsed = !!collapsed[cat];
          return (
            <div key={cat} className="border-input border-b">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <button
                  type="button"
                  className="text-muted-foreground flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent"
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed(c => ({ ...c, [cat]: !c[cat] }))}
                >
                  <Chevron open={!isCollapsed} />
                  <span className="truncate text-[13px]">{categoryLabel(cat)}</span>
                </button>
                <button
                  type="button"
                  className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-[#525252] pl-2 pr-1 text-white hover:bg-[#4c4c4c]"
                  title={anyVisible ? 'Ocultar grupo' : 'Mostrar grupo'}
                  onClick={() =>
                    setGroupVisibility(
                      members.map(m => m.segmentIndex),
                      !anyVisible
                    )
                  }
                >
                  <span className="text-xs tabular-nums">{members.length}</span>
                  <Eye off={!anyVisible} />
                </button>
              </div>
              {!isCollapsed && (
                <ul className="m-0 list-none p-0 pb-1">
                  {members.map(m => (
                    <SegmentRow
                      key={m.segmentIndex}
                      segment={m}
                      onToggle={setVisibility}
                      onSelect={setActive}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default RtStructWorkspacePanel;
