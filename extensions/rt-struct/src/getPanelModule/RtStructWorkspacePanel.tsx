import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { segmentation as cstSegmentation, Enums as csToolsEnums } from '@cornerstonejs/tools';
import { View, ViewOff, ChevronRight, ChevronDown, SettingsAdjust } from '@carbon/icons-react';
import { useRtStructSegments, RtSegment } from './useRtStructSegments';
import { parseRtStruct } from '../rtStructParser';
import {
  categorizeRoi,
  roiBadgeColor,
  contrastText,
  roiTypeLabel,
  categoryLabelKey,
  ROI_CATEGORY_ORDER,
  RoiCategory,
} from '../roiCategory';

/**
 * RT Structure "Focus" workspace — the left ROI list of the TPS layout
 * (RTV Wave 4 / Phase 3). Ported from the autoseg ROI Workspace
 * (components/viewer/{SegmentationPanel,SegmentRow,SelectedRoiInspector}.tsx):
 * structures grouped into Alvos / Órgãos em risco / Externo-Suporte via
 * `categorizeRoi`, each row with a visibility eye, colour swatch, name and a
 * derived type badge (GTV/CTV/PTV/…). Clicking a row makes it active (Carbon
 * g100 highlight: bg #161616 + #4589ff left accent) and opens the bottom
 * inspector-lite (Type / Color / Volume). Collapsible groups with a count pill
 * that bulk-toggles group visibility, plus a global opacity slider +
 * Fill/Outline toggle (defaults: 50% fill, autoseg parity). Display-only (no
 * editing) — rename/recolor/delete/boolean/margin/collab intentionally dropped.
 */

// Carbon glyphs (autoseg parity): View/ViewOff for the eyes, ChevronRight/Down
// for group collapse, SettingsAdjust for the display-controls toggle.
const Eye = ({ off = false }: { off?: boolean }) =>
  off ? <ViewOff size={16} aria-hidden /> : <View size={16} aria-hidden />;

const Chevron = ({ open }: { open: boolean }) =>
  open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />;

function SegmentRow({
  segment,
  isActive,
  onToggle,
  onSelect,
}: {
  segment: RtSegment;
  isActive: boolean;
  onToggle: (index: number, visible: boolean) => void;
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation('RTMedical');
  const cls = categorizeRoi(segment.label);
  const badgeBg = roiBadgeColor(cls, segment.color);
  const badgeFg = cls.category === 'target' ? '#ffffff' : contrastText(segment.color);
  const [r, g, b] = segment.color;
  return (
    <li
      data-cy="rt-struct-row"
      data-active={isActive || undefined}
      className={`flex items-center gap-1 border-l-2 px-2 ${
        isActive
          ? 'border-l-[#4589ff] bg-[#161616] hover:bg-[#161616]'
          : 'border-l-transparent hover:bg-[#333333]'
      } ${segment.visible ? '' : 'opacity-55'}`}
    >
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground shrink-0 p-1"
        title={segment.visible ? t('struct_hide') : t('struct_show')}
        aria-label={segment.visible ? t('struct_hide_structure') : t('struct_show_structure')}
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
          className="h-3.5 w-3.5 shrink-0 rounded-[2px] border border-[#6f6f6f]"
          style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }}
        />
        <span
          className={`min-w-0 flex-1 truncate text-[13px] ${
            isActive ? 'text-foreground font-semibold' : 'text-muted-foreground'
          }`}
        >
          {segment.label}
        </span>
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

/**
 * Inspector-lite (autoseg SelectedRoiInspector, display-only): Type / Color /
 * Volume of the active row, pinned to the panel bottom.
 */
function SelectedRoiInspector({ segment, volumeCc }: { segment: RtSegment; volumeCc?: number }) {
  const { t } = useTranslation('RTMedical');
  const cls = categorizeRoi(segment.label);
  const badgeBg = roiBadgeColor(cls, segment.color);
  const badgeFg = cls.category === 'target' ? '#ffffff' : contrastText(segment.color);
  const [r, g, b] = segment.color;
  const row = 'flex items-center justify-between gap-2';
  return (
    <div className="shrink-0 border-t border-[#6f6f6f] px-3 py-2" data-cy="rt-struct-inspector">
      <h3 className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-[0.04em]">
        {t('struct_selected')}
      </h3>
      <div className="flex flex-col gap-1.5 text-xs">
        <div className={row}>
          <span className="text-muted-foreground">{t('struct_type')}</span>
          <span
            className="inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold leading-none"
            style={{ backgroundColor: badgeBg, color: badgeFg }}
          >
            {roiTypeLabel(cls)}
          </span>
        </div>
        <div className={row}>
          <span className="text-muted-foreground">{t('struct_color')}</span>
          <span className="flex items-center gap-2">
            <span
              className="h-3.5 w-3.5 rounded-[2px] border border-[#6f6f6f]"
              style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }}
            />
            <span className="tabular-nums">{`rgb(${r}, ${g}, ${b})`}</span>
          </span>
        </div>
        <div className={row}>
          <span className="text-muted-foreground">{t('struct_volume')}</span>
          <span className="tabular-nums">
            {volumeCc != null && Number.isFinite(volumeCc) && volumeCc > 0
              ? `${volumeCc.toFixed(1)} cm³`
              : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

export interface RtStructWorkspacePanelProps {
  servicesManager: any;
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
}

export function RtStructWorkspacePanel({
  servicesManager,
  commandsManager,
}: RtStructWorkspacePanelProps): React.ReactElement {
  const { t } = useTranslation('RTMedical');
  const {
    segmentations,
    selectedId,
    setSelectedId,
    segments,
    hydrated,
    activeSegmentIndex,
    setVisibility,
    setGroupVisibility,
    setActive,
  } = useRtStructSegments(servicesManager);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showControls, setShowControls] = useState(false);
  // autoseg defaults: 50% opacity, FILL rendering (ViewerContext.tsx:109-110).
  const [opacity, setOpacity] = useState(50);
  const [outlineOnly, setOutlineOnly] = useState(false);

  // Group segments by clinical category, preserving order and dropping empties.
  const groups = useMemo(() => {
    const byCat: Record<RoiCategory, RtSegment[]> = { target: [], oar: [], external: [] };
    segments.forEach(s => byCat[categorizeRoi(s.label).category].push(s));
    return ROI_CATEGORY_ORDER.map(cat => ({ cat, members: byCat[cat] })).filter(
      g => g.members.length > 0
    );
  }, [segments]);

  const activeSegment = useMemo(
    () => segments.find(s => s.segmentIndex === activeSegmentIndex),
    [segments, activeSegmentIndex]
  );

  // Approximate ROI volumes (cm³) from the RTSTRUCT display set — same source
  // as RtStructPanel: parseRtStruct over the display set instance, matched to
  // the segment by ROI name (fallback: ROI number == segment index).
  // Parsed lazily — only once a row is active (inspector open) — and scoped to
  // the selected structure set: OHIF hydration keys the segmentation by the
  // RTSTRUCT displaySetInstanceUID, and multiple sets in one study routinely
  // reuse ROI names ('PTV', 'Bladder', …), so an all-sets merge could show the
  // volume from the WRONG set. All-sets fallback kept for segmentationIds that
  // don't match a display set UID.
  const hasActiveSegment = activeSegmentIndex != null;
  const roiVolumes = useMemo(() => {
    const byName = new Map<string, number>();
    const byNumber = new Map<number, number>();
    if (!hasActiveSegment) {
      return { byName, byNumber };
    }
    try {
      const displaySetService = servicesManager?.services?.displaySetService;
      const all =
        displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
      const rtSets = (all as any[]).filter(ds => ds?.Modality === 'RTSTRUCT');
      const scoped = rtSets.filter(ds => ds?.displaySetInstanceUID === selectedId);
      (scoped.length ? scoped : rtSets).forEach(ds => {
        // Cache the (full-contour-walk) parse on the display set; the
        // SopClassHandler stores `structureSet`, so `rtStruct` is ours.
        let rt = ds?.rtStruct;
        if (!rt) {
          rt = parseRtStruct(ds?.instances?.[0] ?? ds?.instance ?? ds);
          try {
            ds.rtStruct = rt;
          } catch {
            /* frozen display set — re-parse next time */
          }
        }
        (rt?.structures ?? []).forEach((s: any) => {
          if (s?.approxVolumeCc == null) {
            return;
          }
          if (s.name) {
            byName.set(String(s.name).trim().toLowerCase(), s.approxVolumeCc);
          }
          if (s.roiNumber != null) {
            byNumber.set(s.roiNumber, s.approxVolumeCc);
          }
        });
      });
    } catch {
      /* volume stays unavailable — inspector shows '—' */
    }
    return { byName, byNumber };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicesManager, hydrated, selectedId, hasActiveSegment]);

  // Prefer the voxel-exact labelmap volume (RTV-31, measurements command) when
  // a Labelmap representation exists; fall back to the contour-slab
  // approximation parsed from the RTSTRUCT.
  const voxelVolumeCc = useMemo(() => {
    if (!activeSegment || !selectedId) {
      return undefined;
    }
    try {
      const r: any = commandsManager?.runCommand?.('computeSegmentVolumeCc', {
        segmentationId: selectedId,
        segmentIndex: activeSegment.segmentIndex,
      });
      return r && Number.isFinite(r.volumeCc) && r.voxelCount > 0 ? r.volumeCc : undefined;
    } catch {
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandsManager, selectedId, activeSegment?.segmentIndex]);

  const activeVolumeCc =
    voxelVolumeCc ??
    (activeSegment
      ? roiVolumes.byName.get(String(activeSegment.label).trim().toLowerCase()) ??
        roiVolumes.byNumber.get(activeSegment.segmentIndex)
      : undefined);

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
              // Apply to BOTH the active and inactive segments so all ~25 ROIs
              // switch fill/outline together (not just the selected one).
              renderFill: !nextOutlineOnly,
              renderFillInactive: !nextOutlineOnly,
              renderOutline: true,
              renderOutlineInactive: true,
              outlineWidth: 2,
              outlineWidthInactive: 2,
              fillAlpha: nextOutlineOnly ? 0 : fillAlpha,
              fillAlphaInactive: nextOutlineOnly ? 0 : fillAlpha,
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
        {t('struct_none')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-cy="rt-struct-workspace">
      <div className="flex shrink-0 items-center justify-between px-2 py-2">
        <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-[0.04em]">
          {t('struct_workspace_title')}
        </span>
        <button
          type="button"
          className={`p-1 ${showControls ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          title={t('struct_display_controls')}
          aria-label={t('struct_display_controls')}
          onClick={() => setShowControls(s => !s)}
        >
          <SettingsAdjust size={16} aria-hidden />
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
            <span className="text-muted-foreground w-16">{t('struct_opacity')}</span>
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
            <span className="text-muted-foreground w-16">{t('struct_mode')}</span>
            <button
              type="button"
              className={`rounded px-2 py-0.5 ${!outlineOnly ? 'bg-primary text-primary-foreground' : 'bg-muted/40'}`}
              onClick={() => onOutline(false)}
            >
              {t('struct_fill')}
            </button>
            <button
              type="button"
              className={`rounded px-2 py-0.5 ${outlineOnly ? 'bg-primary text-primary-foreground' : 'bg-muted/40'}`}
              onClick={() => onOutline(true)}
            >
              {t('struct_outline')}
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
                  <span className="truncate text-[13px]">{t(categoryLabelKey(cat))}</span>
                </button>
                <button
                  type="button"
                  className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-[#525252] pl-2 pr-1 text-white hover:bg-[#4c4c4c]"
                  title={anyVisible ? t('struct_hide_group') : t('struct_show_group')}
                  onClick={() =>
                    setGroupVisibility(
                      members.map(m => m.segmentIndex),
                      !anyVisible
                    )
                  }
                >
                  <span className="text-xs tabular-nums">{members.length}</span>
                  {/* autoseg parity: crossed eye (ViewOff) while the group IS visible */}
                  <Eye off={anyVisible} />
                </button>
              </div>
              {!isCollapsed && (
                <ul className="m-0 list-none p-0 pb-1">
                  {members.map(m => (
                    <SegmentRow
                      key={m.segmentIndex}
                      segment={m}
                      isActive={m.segmentIndex === activeSegmentIndex}
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

      {activeSegment && <SelectedRoiInspector segment={activeSegment} volumeCc={activeVolumeCc} />}
    </div>
  );
}

export default RtStructWorkspacePanel;
