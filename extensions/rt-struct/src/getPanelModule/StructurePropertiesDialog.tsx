import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RT_ROI_INTERPRETED_TYPES,
  RtRoiInterpretedType,
  searchTg263,
  Tg263Entry,
} from '../tg263';
import { categorizeRoi } from '../roiCategory';

/**
 * Eclipse-style structure Properties dialog (RTV-213).
 *
 * Remediation-first: right-click → Properties on an existing structure renames
 * an imported ROI ('Lt Parotid' / 'PAROTID_L' / 'parotid_left') to the TG-263
 * standard (Parotid_L). Fields, Eclipse-style:
 *  - Structure Code: TG-263 type-ahead; picking an entry CROSS-FILLS the
 *    Volume Type, ROI Name (TG-263 Primary Name) and colour.
 *  - Volume Type: DICOM RT ROI Interpreted Type (3006,00A4) enum.
 *  - ROI Name: free text.
 *  - Color: swatch input.
 *
 * Apply (verified against SegmentationService.ts):
 *  - rename  → segmentationService.setSegmentLabel(segmentationId, segmentIndex,
 *              label)                       (SegmentationService.ts:1202)
 *  - recolor → segmentationService.setSegmentColor(viewportId, segmentationId,
 *              segmentIndex, RGBA)          (SegmentationService.ts:1126) —
 *              per-viewport; silently skipped when no viewport carries the rep.
 *  - create  → segmentationService.addSegment(segmentationId, {segmentIndex,
 *              label, active})              (SegmentationService.ts:894) —
 *              writes segmentation state only (updateSegmentations), so it also
 *              works for Contour-hydrated RTSTRUCT segmentations.
 *
 * RTSTRUCT has no writable slot for the interpreted type / TG-263 code in the
 * in-memory cornerstone segmentation, so those are recorded in the exported
 * `structureMetaStore` (keyed `${segmentationId}:${segmentIndex}`) and mirrored
 * to `window.__rtStructMeta` for E2E assertions.
 */

export interface StructureMeta {
  /** DICOM RT ROI Interpreted Type (3006,00A4) chosen in the dialog. */
  interpretedType?: RtRoiInterpretedType;
  /** TG-263 Primary Name of the selected Structure Code (if one was picked). */
  tg263Name?: string;
}

/** Module-level metadata store: `${segmentationId}:${segmentIndex}` → meta. */
export const structureMetaStore = new Map<string, StructureMeta>();

export function structureMetaKey(segmentationId: string, segmentIndex: number): string {
  return `${segmentationId}:${segmentIndex}`;
}

export function getStructureMeta(
  segmentationId?: string,
  segmentIndex?: number
): StructureMeta | undefined {
  if (!segmentationId || segmentIndex == null) {
    return undefined;
  }
  return structureMetaStore.get(structureMetaKey(segmentationId, segmentIndex));
}

function recordStructureMeta(
  segmentationId: string,
  segmentIndex: number,
  meta: StructureMeta
): void {
  structureMetaStore.set(structureMetaKey(segmentationId, segmentIndex), meta);
  try {
    // E2E mirror (Playwright reads this instead of poking module scope).
    (window as unknown as Record<string, unknown>).__rtStructMeta = Object.fromEntries(
      structureMetaStore.entries()
    );
  } catch {
    /* non-browser environment */
  }
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map(v => clamp255(v).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) {
    return [136, 136, 136];
  }
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Default Volume Type for an existing ROI without recorded metadata — reuses
 * the panel's name heuristic (categorizeRoi) so 'PTV boost' opens as PTV and
 * 'BODY' opens as EXTERNAL rather than always ORGAN.
 */
export function defaultTypeForLabel(label?: string): RtRoiInterpretedType {
  const cls = categorizeRoi(label ?? '');
  if (cls.category === 'target') {
    if (cls.type === 'GTV' || cls.type === 'IGTV') {
      return 'GTV';
    }
    if (cls.type === 'CTV' || cls.type === 'ITV') {
      return 'CTV';
    }
    return 'PTV';
  }
  if (cls.category === 'external') {
    return cls.type === 'Support' ? 'SUPPORT' : 'EXTERNAL';
  }
  return 'ORGAN';
}

export interface StructurePropertiesDialogProps {
  servicesManager: { services: Record<string, any> };
  segmentationId: string;
  /** A viewport that carries the segmentation representation (colour writes). */
  primaryViewportId?: string;
  mode: 'edit' | 'create';
  /** Required in edit mode; ignored in create mode (next index is computed). */
  segmentIndex?: number;
  initialLabel?: string;
  initialColor?: [number, number, number];
  onClose: () => void;
  /** Called after a successful Apply with the affected segment index. */
  onApplied?: (segmentIndex: number) => void;
}

export function StructurePropertiesDialog({
  servicesManager,
  segmentationId,
  primaryViewportId,
  mode,
  segmentIndex,
  initialLabel,
  initialColor,
  onClose,
  onApplied,
}: StructurePropertiesDialogProps): React.ReactElement {
  const { t } = useTranslation('RTMedical');
  const storedMeta = mode === 'edit' ? getStructureMeta(segmentationId, segmentIndex) : undefined;

  const [name, setName] = useState<string>(initialLabel ?? '');
  const [typeValue, setTypeValue] = useState<RtRoiInterpretedType>(
    storedMeta?.interpretedType ?? defaultTypeForLabel(initialLabel)
  );
  const [colorHex, setColorHex] = useState<string>(rgbToHex(initialColor ?? [136, 136, 136]));
  const [query, setQuery] = useState<string>('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [pickedCode, setPickedCode] = useState<string | undefined>(storedMeta?.tg263Name);

  const results = useMemo(() => searchTg263(query), [query]);

  // Escape closes (cancel) — Eclipse dialog behaviour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Structure Code selection cross-fills type + name + colour (Eclipse). */
  const pick = (entry: Tg263Entry) => {
    setName(entry.primaryName);
    setTypeValue(entry.interpretedType);
    if (entry.defaultColor) {
      setColorHex(rgbToHex(entry.defaultColor));
    }
    setQuery(entry.primaryName);
    setPickedCode(entry.primaryName);
    setDropdownOpen(false);
  };

  const apply = () => {
    const segmentationService = servicesManager?.services?.segmentationService;
    const label = name.trim();
    if (!segmentationService || !segmentationId || !label) {
      return;
    }

    let index = segmentIndex;
    if (mode === 'create') {
      // addSegment (SegmentationService.ts:894) only writes segmentation state
      // via cstSegmentation.updateSegmentations — safe for Contour-hydrated
      // RTSTRUCT segmentations (no labelmap access on this path).
      try {
        index = segmentationService.getNextAvailableSegmentIndex(segmentationId);
      } catch {
        index = undefined;
      }
      if (index == null) {
        try {
          const seg = segmentationService.getSegmentation(segmentationId);
          const keys = Object.keys(seg?.segments ?? {})
            .map(Number)
            .filter(n => Number.isFinite(n));
          index = keys.length ? Math.max(...keys) + 1 : 1;
        } catch {
          return;
        }
      }
      try {
        segmentationService.addSegment(segmentationId, {
          segmentIndex: index,
          label,
          active: true,
        });
      } catch {
        return;
      }
    } else {
      if (index == null) {
        return;
      }
      try {
        // SegmentationService.ts:1202
        segmentationService.setSegmentLabel(segmentationId, index, label);
      } catch {
        /* keep going — colour/meta may still apply */
      }
    }

    // Colour is per-viewport (SegmentationService.ts:1126) and requires a
    // viewport that carries the representation — skip silently otherwise.
    if (primaryViewportId) {
      try {
        const [r, g, b] = hexToRgb(colorHex);
        segmentationService.setSegmentColor(primaryViewportId, segmentationId, index, [
          r,
          g,
          b,
          255,
        ]);
      } catch {
        /* no representation on that viewport */
      }
    }

    recordStructureMeta(segmentationId, index, {
      interpretedType: typeValue,
      tg263Name: pickedCode,
    });
    onApplied?.(index);
    onClose();
  };

  const fieldLabel = 'text-muted-foreground text-[11px] font-semibold uppercase tracking-[0.04em]';
  const fieldInput =
    'border-input bg-muted/40 w-full rounded border p-1 text-[13px] text-foreground';

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-black/60 p-3 pt-8"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('tg263_properties')}
        data-cy="tg263-dialog"
        className="w-full max-w-[300px] rounded border border-[#6f6f6f] bg-[#262626] p-3 shadow-xl"
        onMouseDown={e => e.stopPropagation()}
      >
        <h3 className="text-foreground mb-3 text-[13px] font-semibold">
          {t('tg263_properties')}
          {mode === 'edit' && initialLabel ? ` — ${initialLabel}` : ''}
        </h3>

        <div className="flex flex-col gap-2.5">
          {/* Structure Code — TG-263 type-ahead, cross-fills type/name/colour */}
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>{t('tg263_structure_code')}</span>
            <input
              type="text"
              data-cy="tg263-code-input"
              className={fieldInput}
              value={query}
              placeholder="Parotid_L"
              autoComplete="off"
              spellCheck={false}
              onChange={e => {
                setQuery(e.target.value);
                setDropdownOpen(true);
              }}
              onFocus={() => setDropdownOpen(true)}
            />
          </label>
          {dropdownOpen && query.trim() !== '' && (
            <ul
              data-cy="tg263-code-results"
              className="ohif-scrollbar m-0 max-h-44 list-none overflow-auto rounded border border-[#6f6f6f] bg-[#161616] p-0"
            >
              {results.length === 0 ? (
                <li className="text-muted-foreground px-2 py-1.5 text-xs">
                  {t('tg263_no_results')}
                </li>
              ) : (
                results.map(entry => (
                  <li key={entry.primaryName}>
                    <button
                      type="button"
                      data-cy="tg263-code-option"
                      className="hover:bg-[#333333] flex w-full flex-col items-start gap-0.5 border-0 bg-transparent px-2 py-1.5 text-left"
                      onClick={() => pick(entry)}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="text-foreground text-[13px]">{entry.primaryName}</span>
                        <span className="text-muted-foreground text-[10px] uppercase">
                          {entry.interpretedType}
                        </span>
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        {entry.description}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}

          {/* Volume Type — DICOM RT ROI Interpreted Type (3006,00A4) */}
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>{t('tg263_volume_type')}</span>
            <select
              data-cy="tg263-type-select"
              className={fieldInput}
              value={typeValue}
              onChange={e => setTypeValue(e.target.value as RtRoiInterpretedType)}
            >
              {RT_ROI_INTERPRETED_TYPES.map(tp => (
                <option key={tp} value={tp}>
                  {tp}
                </option>
              ))}
            </select>
          </label>

          {/* ROI Name — free text */}
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>{t('tg263_name')}</span>
            <input
              type="text"
              data-cy="tg263-name-input"
              className={fieldInput}
              value={name}
              autoComplete="off"
              spellCheck={false}
              onChange={e => setName(e.target.value)}
            />
          </label>

          {/* Color */}
          <label className="flex items-center justify-between gap-2">
            <span className={fieldLabel}>{t('tg263_color')}</span>
            <input
              type="color"
              data-cy="tg263-color-input"
              className="h-6 w-10 cursor-pointer rounded border border-[#6f6f6f] bg-transparent p-0"
              value={colorHex}
              onChange={e => setColorHex(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            data-cy="tg263-cancel"
            className="bg-muted/40 hover:bg-muted/60 rounded px-3 py-1 text-xs"
            onClick={onClose}
          >
            {t('tg263_cancel')}
          </button>
          <button
            type="button"
            data-cy="tg263-apply"
            className="bg-primary text-primary-foreground rounded px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!name.trim()}
            onClick={apply}
          >
            {t('tg263_apply')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default StructurePropertiesDialog;
