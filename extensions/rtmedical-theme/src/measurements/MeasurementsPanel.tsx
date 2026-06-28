/**
 * Custom RT measurements panel (RTV-151) — lists the study's measurements with
 * click-to-jump and CSV export. Subscribes to the native MeasurementService
 * (pub/sub) and dispatches the stock `jumpToMeasurement` command. RTV-114:
 * only public service/command APIs; display logic lives in the tested view model.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@ohif/ui-next';
import {
  buildMeasurementsViewModel,
  measurementsToCsv,
  type MeasurementLike,
} from './measurementsViewModel';

interface CommandsManagerLike {
  runCommand: (commandName: string, options?: Record<string, unknown>) => unknown;
}
interface MeasurementServiceLike {
  EVENTS: Record<string, string>;
  getMeasurements: () => MeasurementLike[];
  subscribe: (event: string, cb: () => void) => { unsubscribe: () => void };
}
interface ServicesManagerLike {
  services: { measurementService?: MeasurementServiceLike } & Record<string, unknown>;
}

export interface MeasurementsPanelProps {
  servicesManager: ServicesManagerLike;
  commandsManager: CommandsManagerLike;
}

export function MeasurementsPanel({
  servicesManager,
  commandsManager,
}: MeasurementsPanelProps): React.ReactElement {
  const measurementService = servicesManager.services.measurementService;
  const [measurements, setMeasurements] = useState<MeasurementLike[]>(
    () => measurementService?.getMeasurements() ?? []
  );

  useEffect(() => {
    if (!measurementService) {
      return undefined;
    }
    const refresh = () => setMeasurements(measurementService.getMeasurements());
    refresh();
    const events = measurementService.EVENTS;
    const subs = [events.MEASUREMENT_ADDED, events.MEASUREMENT_UPDATED, events.MEASUREMENT_REMOVED]
      .filter(Boolean)
      .map(evt => measurementService.subscribe(evt, refresh));
    return () => subs.forEach(s => s.unsubscribe());
  }, [measurementService]);

  const rows = buildMeasurementsViewModel(measurements);

  const jumpTo = useCallback(
    (uid: string) => commandsManager.runCommand('jumpToMeasurement', { uid }),
    [commandsManager]
  );

  const exportCsv = useCallback(() => {
    const csv = measurementsToCsv(measurements);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'measurements.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [measurements]);

  return (
    <div className="ohif-scrollbar flex h-full flex-col text-white" data-cy="rtmedical-measurements-panel">
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-base font-medium">Medidas ({rows.length})</span>
        <Button variant="ghost" size="sm" disabled={rows.length === 0} onClick={exportCsv}>
          CSV
        </Button>
      </div>
      {rows.length === 0 ? (
        <div className="text-muted-foreground px-2 py-4 text-sm">Nenhuma medida.</div>
      ) : (
        <ul className="flex-1 space-y-1 overflow-auto px-2">
          {rows.map(row => (
            <li key={row.uid}>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded bg-black/20 px-2 py-1 text-left text-sm hover:bg-black/40"
                onClick={() => jumpTo(row.uid)}
                title={row.summary}
              >
                <span className="truncate">{row.label || row.type}</span>
                <span className="text-muted-foreground ml-2 shrink-0">{row.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default MeasurementsPanel;
