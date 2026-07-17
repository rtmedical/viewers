/**
 * Graphical hanging-protocol editor panel (RTV-23).
 *
 * The operator defines layout (rows × cols), per-viewport match rules and
 * series order without touching JSON:
 *   - the current study's image series render as draggable chips; dropping a
 *     chip on a slot pins that viewport to the series' SeriesInstanceUID;
 *   - each slot also has a compact manual rule editor (Modality / BodyPart /
 *     SeriesDescription-contains) and a clear button;
 *   - Preview registers the built protocol with the HangingProtocolService
 *     (addProtocol) and applies it immediately via the stock
 *     'setHangingProtocol' command; Save persists it through the RTV-24
 *     HangingProtocolStore (localStorage) and registers it for matching.
 *
 * Zero-fork (RTV-114): public service APIs + the RTV-25 gridProtocol shape
 * only. The pure spec/protocol logic lives in ./hpBuilder (unit-tested).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@ohif/ui-next';
import {
  buildCustomProtocol,
  specFromProtocol,
  validateSpec,
  userProtocolId,
  type HpEditorSpec,
  type HpSlotSpec,
} from './hpBuilder';
import { HangingProtocolStore, type StoredProtocolRecord } from '../hpPersistence/hpPersistence';

const DND_MIME = 'application/x-rt-series';
const GRID_SIZES = [1, 2, 3, 4];

interface SubscribableService {
  EVENTS?: Record<string, string>;
  subscribe?: (event: string, cb: () => void) => { unsubscribe: () => void };
}
interface DisplaySetServiceLike extends SubscribableService {
  getActiveDisplaySets?: () => any[];
}
interface HangingProtocolServiceLike {
  addProtocol?: (protocolId: string, protocol: unknown) => void;
  addActiveProtocolId?: (id: string) => void;
  activeProtocolIds?: string[] | null;
}
export interface HpEditorPanelProps {
  servicesManager: {
    services: {
      displaySetService?: DisplaySetServiceLike;
      hangingProtocolService?: HangingProtocolServiceLike;
      userAuthenticationService?: { getUser?: () => any };
    } & Record<string, unknown>;
  };
  commandsManager: { runCommand?: (name: string, options?: unknown) => unknown };
  /** Injectable for tests; defaults to the localStorage-backed RTV-24 store. */
  store?: HangingProtocolStore;
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const resizeSlots = (slots: HpSlotSpec[], total: number): HpSlotSpec[] =>
  Array.from({ length: total }, (_unused, i) => slots[i] ?? {});

const readImageSeries = (displaySetService?: DisplaySetServiceLike): any[] =>
  (displaySetService?.getActiveDisplaySets?.() ?? []).filter(
    ds => (ds?.numImageFrames ?? 0) > 0
  );

const seriesLabel = (ds: any): string =>
  [ds?.Modality, ds?.SeriesDescription || ds?.label, ds?.SeriesNumber != null ? `#${ds.SeriesNumber}` : '']
    .filter(Boolean)
    .join(' · ');

const inputClass =
  'border-input w-full rounded border bg-black/30 px-1 py-0.5 text-xs text-white';

export function HpEditorPanel({
  servicesManager,
  commandsManager,
  store: injectedStore,
}: HpEditorPanelProps): React.ReactElement {
  const { t } = useTranslation('RTMedical');
  const { displaySetService, hangingProtocolService, userAuthenticationService } =
    servicesManager.services;
  const store = useMemo(() => injectedStore ?? new HangingProtocolStore(), [injectedStore]);

  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);
  const [name, setName] = useState('');
  const [slots, setSlots] = useState<HpSlotSpec[]>(() => resizeSlots([], 4));
  const [series, setSeries] = useState<any[]>(() => readImageSeries(displaySetService));
  const [saved, setSaved] = useState<StoredProtocolRecord[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const currentUser = useCallback((): string => {
    try {
      const profile = userAuthenticationService?.getUser?.()?.profile;
      return profile?.preferred_username || profile?.email || 'local';
    } catch {
      return 'local';
    }
  }, [userAuthenticationService]);

  const spec = useMemo<HpEditorSpec>(() => {
    const id = slugify(name) || 'draft';
    return { id, name: name.trim() || id, rows, cols, slots };
  }, [name, rows, cols, slots]);

  /** addProtocol (register) + join the active-id set so it can auto-match. */
  const registerProtocol = useCallback(
    (protocol: any): void => {
      if (!protocol?.id || !protocol?.stages) {
        return;
      }
      try {
        hangingProtocolService?.addProtocol?.(protocol.id, protocol);
        // Mode.tsx restricts activeProtocolIds to the mode default; only extend
        // an existing restriction — never create one (null means "all active").
        const active = hangingProtocolService?.activeProtocolIds;
        if (Array.isArray(active) && !active.includes(protocol.id)) {
          hangingProtocolService.addActiveProtocolId?.(protocol.id);
        }
      } catch (e) {
        console.warn('RTV-23: could not register protocol', protocol?.id, e);
      }
    },
    [hangingProtocolService]
  );

  const applyProtocolNow = useCallback(
    (protocolId: string): void => {
      try {
        commandsManager?.runCommand?.('setHangingProtocol', { protocolId, reset: true });
      } catch (e) {
        console.warn('RTV-23: could not apply protocol', protocolId, e);
      }
    },
    [commandsManager]
  );

  // Series chips follow the active study (pub-sub over the DisplaySetService).
  useEffect(() => {
    if (!displaySetService) {
      return undefined;
    }
    const refresh = () => setSeries(readImageSeries(displaySetService));
    refresh();
    const events = displaySetService.EVENTS;
    const subs =
      events && displaySetService.subscribe
        ? [events.DISPLAY_SETS_ADDED, events.DISPLAY_SETS_CHANGED, events.DISPLAY_SETS_REMOVED]
            .filter(Boolean)
            .map(evt => displaySetService.subscribe!(evt, refresh))
        : [];
    return () => subs.forEach(s => s.unsubscribe && s.unsubscribe());
  }, [displaySetService]);

  // Saved protocols: list them and register each so Apply / future matching work.
  useEffect(() => {
    const records = store.list();
    setSaved(records);
    records.forEach(record => registerProtocol(record.protocol));
  }, [store, registerProtocol]);

  const setGrid = (nextRows: number, nextCols: number): void => {
    setRows(nextRows);
    setCols(nextCols);
    setSlots(current => resizeSlots(current, nextRows * nextCols));
  };

  const updateSlot = (index: number, patch: Partial<HpSlotSpec>): void =>
    setSlots(current =>
      current.map((slot, i) => (i === index ? { ...slot, ...patch } : slot))
    );

  const onChipDragStart = (ds: any) => (event: React.DragEvent) => {
    const payload = JSON.stringify({
      seriesInstanceUID: ds.SeriesInstanceUID,
      modality: ds.Modality,
      description: ds.SeriesDescription || ds.label || '',
    });
    event.dataTransfer.setData(DND_MIME, payload);
    event.dataTransfer.setData('text/plain', ds.SeriesInstanceUID ?? '');
    event.dataTransfer.effectAllowed = 'copy';
  };

  const onSlotDrop = (index: number) => (event: React.DragEvent) => {
    event.preventDefault();
    let uid = '';
    try {
      const raw = event.dataTransfer.getData(DND_MIME);
      if (raw) {
        uid = JSON.parse(raw)?.seriesInstanceUID ?? '';
      }
    } catch {
      /* fall back to text/plain below */
    }
    if (!uid) {
      uid = event.dataTransfer.getData('text/plain');
    }
    if (uid) {
      updateSlot(index, { seriesInstanceUID: uid });
    }
  };

  const handlePreview = (): void => {
    const validationErrors = validateSpec(spec, { forSave: false });
    setErrors(validationErrors);
    if (validationErrors.length) {
      return;
    }
    const protocol = buildCustomProtocol(spec);
    registerProtocol(protocol);
    applyProtocolNow(protocol.id);
  };

  const handleSave = (): void => {
    const validationErrors = validateSpec(spec);
    setErrors(validationErrors);
    if (validationErrors.length) {
      return;
    }
    const protocol = buildCustomProtocol(spec);
    store.save(protocol.id, protocol, currentUser());
    registerProtocol(protocol);
    setSaved(store.list());
  };

  const handleLoad = (record: StoredProtocolRecord): void => {
    const loaded = specFromProtocol(record.protocol);
    if (!loaded) {
      return;
    }
    setRows(loaded.rows);
    setCols(loaded.cols);
    setSlots(resizeSlots(loaded.slots, loaded.rows * loaded.cols));
    setName(loaded.name);
    setErrors([]);
  };

  const handleApply = (record: StoredProtocolRecord): void => {
    const protocol: any = record.protocol;
    registerProtocol(protocol);
    applyProtocolNow(protocol?.id ?? userProtocolId(record.id));
  };

  const handleDelete = (record: StoredProtocolRecord): void => {
    store.remove(record.id, currentUser());
    setSaved(store.list());
  };

  const modalities = useMemo(
    () => Array.from(new Set(series.map(ds => ds?.Modality).filter(Boolean))) as string[],
    [series]
  );

  const slotSeriesCaption = (slot: HpSlotSpec): string | undefined => {
    if (!slot.seriesInstanceUID) {
      return undefined;
    }
    const ds = series.find(item => item?.SeriesInstanceUID === slot.seriesInstanceUID);
    return ds ? seriesLabel(ds) : `…${slot.seriesInstanceUID.slice(-14)}`;
  };

  return (
    <div
      className="ohif-scrollbar flex h-full flex-col gap-2 overflow-auto p-2 text-sm text-white"
      data-cy="hp-editor"
    >
      <div className="text-base font-medium">{t('hp_editor_title')}</div>

      {/* Grid size + protocol name */}
      <div className="flex items-end gap-2">
        <label className="flex flex-col text-xs">
          <span className="text-muted-foreground">{t('hp_rows')}</span>
          <select
            className={inputClass}
            value={rows}
            onChange={e => setGrid(Number(e.target.value), cols)}
          >
            {GRID_SIZES.map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-muted-foreground">{t('hp_cols')}</span>
          <select
            className={inputClass}
            value={cols}
            onChange={e => setGrid(rows, Number(e.target.value))}
          >
            {GRID_SIZES.map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col text-xs">
          <span className="text-muted-foreground">{t('hp_name')}</span>
          <Input
            className="h-6 text-xs"
            data-cy="hp-editor-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('hp_name')}
          />
        </label>
      </div>

      {/* Series chips (drag sources) */}
      <div>
        <div className="text-muted-foreground mb-1 text-xs">{t('hp_series')}</div>
        <div className="flex flex-wrap gap-1">
          {series.map((ds, n) => (
            <div
              key={ds?.displaySetInstanceUID ?? ds?.SeriesInstanceUID ?? n}
              draggable
              onDragStart={onChipDragStart(ds)}
              data-cy={`hp-editor-chip-${n}`}
              className="cursor-grab rounded border border-white/20 bg-black/30 px-1.5 py-0.5 text-xs hover:bg-black/50"
              title={ds?.SeriesInstanceUID}
            >
              {seriesLabel(ds)}
            </div>
          ))}
        </div>
      </div>

      {/* Slot grid (drop targets + compact rule editors) */}
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        data-cy="hp-editor-grid"
      >
        {slots.map((slot, i) => (
          <div
            key={i}
            data-cy={`hp-editor-slot-${i}`}
            onDragOver={e => e.preventDefault()}
            onDrop={onSlotDrop(i)}
            className="flex min-h-[92px] flex-col gap-1 rounded border border-dashed border-white/30 bg-black/20 p-1"
          >
            {slot.seriesInstanceUID ? (
              <div
                className="truncate rounded bg-white/10 px-1 text-xs"
                title={slot.seriesInstanceUID}
              >
                {slotSeriesCaption(slot)}
              </div>
            ) : (
              <div className="text-muted-foreground text-center text-[10px]">
                {t('hp_drop_hint')}
              </div>
            )}
            <select
              className={inputClass}
              aria-label={t('hp_modality')}
              value={slot.modality ?? ''}
              onChange={e => updateSlot(i, { modality: e.target.value || undefined })}
            >
              <option value="">{t('hp_modality')}</option>
              {modalities.map(modality => (
                <option key={modality} value={modality}>
                  {modality}
                </option>
              ))}
            </select>
            <Input
              className="h-5 text-xs"
              placeholder={t('hp_body_part')}
              value={slot.bodyPart ?? ''}
              onChange={e => updateSlot(i, { bodyPart: e.target.value || undefined })}
            />
            <Input
              className="h-5 text-xs"
              placeholder={t('hp_series_desc')}
              value={slot.seriesDescriptionContains ?? ''}
              onChange={e =>
                updateSlot(i, { seriesDescriptionContains: e.target.value || undefined })
              }
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-5 self-end px-1 text-[10px]"
              onClick={() => setSlots(current => current.map((s, k) => (k === i ? {} : s)))}
            >
              {t('hp_clear')}
            </Button>
          </div>
        ))}
      </div>

      {errors.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-red-400">
          {errors.map(error => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" size="sm" data-cy="hp-editor-preview" onClick={handlePreview}>
          {t('hp_preview')}
        </Button>
        <Button variant="default" size="sm" data-cy="hp-editor-save" onClick={handleSave}>
          {t('hp_save')}
        </Button>
      </div>

      {/* Saved protocols */}
      <div data-cy="hp-editor-saved-list">
        <div className="text-muted-foreground mb-1 text-xs">{t('hp_saved')}</div>
        {saved.length === 0 ? (
          <div className="text-muted-foreground text-xs">—</div>
        ) : (
          saved.map(record => (
            <div
              key={record.id}
              className="flex items-center gap-1 border-b border-white/10 py-0.5"
            >
              <span className="flex-1 truncate text-xs">
                {(record.protocol as any)?.name ?? record.id}
              </span>
              <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px]" onClick={() => handleApply(record)}>
                {t('hp_apply')}
              </Button>
              <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px]" onClick={() => handleLoad(record)}>
                {t('hp_load')}
              </Button>
              <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px]" onClick={() => handleDelete(record)}>
                {t('hp_delete')}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default HpEditorPanel;
