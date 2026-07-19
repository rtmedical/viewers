/**
 * De-identification right-panel (RTV-113): preview the de-id policy (PS3.15
 * Annex E Basic Profile), choose retain-dates / retain-UIDs, and download a
 * de-identified copy of the active instance.
 *
 * Policy/logic is the pure {@link ../deidentify}; byte writing is
 * {@link ../deidExport} (dcmjs). Batch / whole-study export + re-import is a
 * follow-up. RTV-114: `@ohif/ui-next` only.
 */
import React, { useMemo, useState } from 'react';
import { Button } from '@ohif/ui-next';
import { deidActions } from '../deidentify';
import { downloadDeidentified } from '../deidExport';

interface ServicesManagerLike {
  services: Record<string, any>;
}
export interface DeidPanelProps {
  servicesManager: ServicesManagerLike;
}

const instanceOf = (ds: any) => ds?.instances?.[0] ?? ds?.instance ?? ds;

function activeInstance(displaySetService: any): Record<string, any> | undefined {
  const all = displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  for (const ds of all as any[]) {
    const inst = instanceOf(ds);
    if (inst?.SOPInstanceUID) return inst;
  }
  return undefined;
}

const ACTION_LABEL: Record<string, string> = {
  D: 'dummy', Z: 'blank', X: 'remove', K: 'keep', U: 'UID remap',
};

export function DeidPanel({ servicesManager }: DeidPanelProps): React.ReactElement {
  const displaySetService = servicesManager?.services?.displaySetService;
  const [retainDates, setRetainDates] = useState(false);
  const [retainUids, setRetainUids] = useState(true);

  const actions = useMemo(() => deidActions(), []);
  const acted = actions.filter(a => a.action !== 'K');

  const handleDownload = () => {
    const inst = activeInstance(displaySetService);
    if (inst) {
      downloadDeidentified(inst, { retainDates, retainUids, filename: 'deidentified.dcm' });
    }
  };

  return (
    <div className="ohif-scrollbar flex h-full flex-col overflow-auto px-2 py-2 text-sm text-white" data-cy="deid-panel">
      <span className="mb-1 text-base font-medium">De-identification</span>
      <div className="text-muted-foreground mb-2 text-xs">PS3.15 Annex E Basic Profile · LGPD</div>

      <label className="mb-1 flex items-center gap-2">
        <input type="checkbox" checked={retainDates} onChange={e => setRetainDates(e.target.checked)} />
        <span>Retain dates</span>
      </label>
      <label className="mb-2 flex items-center gap-2">
        <input type="checkbox" checked={retainUids} onChange={e => setRetainUids(e.target.checked)} />
        <span>Retain UIDs (keep references)</span>
      </label>

      <Button variant="ghost" size="sm" className="mb-3 self-start" onClick={handleDownload}>
        Download de-identified (active instance)
      </Button>

      <div className="text-muted-foreground mb-1 text-xs">Policy ({acted.length} tags acted on)</div>
      <table className="w-full border-collapse">
        <tbody>
          {acted.map(a => (
            <tr key={a.keyword} className="border-t border-white/10">
              <td className="py-0.5">{a.keyword}</td>
              <td className="text-right text-xs text-sky-300">{ACTION_LABEL[a.action]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground mt-2 text-xs">
        Whole-study batch de-identification + re-import is a follow-up.
      </p>
    </div>
  );
}

export default DeidPanel;
