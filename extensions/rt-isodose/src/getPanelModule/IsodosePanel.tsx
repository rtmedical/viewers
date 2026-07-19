/**
 * Isodoses right-panel (RTV-137): pick a dose colormap, set/derive the
 * prescription dose, and list isodose levels (% + absolute Gy + color).
 *
 * Color/level data is the pure {@link ../isodose}. The prescription is read from
 * a loaded RTPLAN display set (`rtPlan` from `@ohif/extension-rt-plan`) when
 * present, else entered manually. Viewport rendering lives in the commands:
 * `showDoseWash` (color wash) and `showIsodoseLines` (vector lines).
 * RTV-114: `@ohif/ui-next` only.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  buildIsodoseLevels,
  buildColormap,
  rgbToHex,
  ColormapName,
  COLORMAP_NAMES,
} from '../isodose';
import { derivePrescription } from '../rxDose';

interface ServicesManagerLike {
  services: Record<string, any>;
}
export interface IsodosePanelProps {
  servicesManager: ServicesManagerLike;
}

export function IsodosePanel({ servicesManager }: IsodosePanelProps): React.ReactElement {
  const displaySetService = servicesManager?.services?.displaySetService;
  const [colormap, setColormap] = useState<ColormapName>('jet');
  const [derived, setDerived] = useState<number | undefined>(() => derivePrescription(displaySetService));
  const [manualRx, setManualRx] = useState<string>('');

  useEffect(() => {
    if (!displaySetService?.subscribe) return undefined;
    const resync = () => setDerived(derivePrescription(displaySetService));
    resync();
    const events = displaySetService.EVENTS ?? {};
    const subs = [events.DISPLAY_SETS_ADDED, events.DISPLAY_SETS_CHANGED, events.DISPLAY_SETS_REMOVED]
      .filter(Boolean)
      .map((e: string) => displaySetService.subscribe(e, resync));
    return () => subs.forEach((s: any) => s?.unsubscribe?.());
  }, [displaySetService]);

  const prescriptionGy = manualRx !== '' ? Number(manualRx) : derived;
  const levels = useMemo(
    () => buildIsodoseLevels(Number.isFinite(prescriptionGy) ? prescriptionGy : undefined, undefined, colormap),
    [prescriptionGy, colormap]
  );
  const gradient = useMemo(() => buildColormap(colormap, 24), [colormap]);

  return (
    <div className="ohif-scrollbar flex h-full flex-col overflow-auto px-2 py-2 text-sm text-white" data-cy="rt-isodose-panel">
      <span className="mb-2 text-base font-medium">Isodoses</span>

      <label className="mb-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Colormap</span>
        <select className="rounded bg-black/30 p-1 text-sm" value={colormap} onChange={e => setColormap(e.target.value as ColormapName)}>
          {COLORMAP_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>

      {/* gradient bar */}
      <div className="mb-2 flex h-3 w-full overflow-hidden rounded">
        {gradient.map((c, i) => (
          <div key={i} className="h-full flex-1" style={{ backgroundColor: rgbToHex(c) }} />
        ))}
      </div>

      <label className="mb-3 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Prescription (Gy)</span>
        <input
          type="number" className="w-20 rounded bg-black/30 p-1 text-sm"
          placeholder={derived != null ? String(derived) : '—'}
          value={manualRx}
          onChange={e => setManualRx(e.target.value)}
        />
      </label>
      {derived != null && manualRx === '' && (
        <div className="text-muted-foreground -mt-2 mb-2 text-xs">From RT Plan: {derived} Gy</div>
      )}

      <table className="w-full border-collapse">
        <thead>
          <tr className="text-muted-foreground text-left">
            <th className="py-1">%</th>
            <th className="text-right">Dose (Gy)</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {levels.map(l => (
            <tr key={l.percent} className="border-t border-white/10">
              <td className="py-1">{l.percent}%</td>
              <td className="text-right">{l.doseGy != null ? l.doseGy.toFixed(2) : '—'}</td>
              <td>
                <span className="inline-block h-3 w-6 rounded-sm align-middle" style={{ backgroundColor: l.hex }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-muted-foreground mt-2 text-xs">
        Drawing isodose lines / dose-wash on the viewport (from the RTDOSE grid) is a follow-up.
      </p>
    </div>
  );
}

export default IsodosePanel;
