/**
 * 4D / gating right panel (RTV-93, RTV-51).
 *
 * Shows what the phases *mean* — "40% EX", "25% (250 ms)", the cardiac
 * synchronisation technique, and a warning when the series has fewer phases than
 * it claims — then lets the reader jump between them and build a temporal
 * projection over a chosen phase range.
 *
 * The phase *slider* and *cine* deliberately live where they already are (the
 * ui-next CinePlayer, driven by `displaySet.dynamicVolumeInfo`); duplicating them
 * here would give the reader two controls fighting over one volume. What this
 * panel adds is the labelling and the projection, neither of which exists upstream.
 *
 * All logic is in the pure cores; this is state + markup. RTV-114: no core imports.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { describeGating, GatingInfo, isPhaseSetIncomplete } from '../phaseDetect';
import {
  TEMPORAL_OPERATION_LABELS,
  TEMPORAL_OPERATIONS,
  TemporalOperation,
} from '../temporalProjection';

interface ServicesManagerLike {
  services: Record<string, any>;
}

export interface Rt4dPanelProps {
  servicesManager: ServicesManagerLike;
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => any };
}

const NOT_GATED: GatingInfo = { isGated: false, kind: null, phases: [], sourceTag: null };

export function Rt4dPanel({ servicesManager, commandsManager }: Rt4dPanelProps): React.ReactElement {
  const { viewportGridService, displaySetService } = servicesManager?.services ?? {};

  const [info, setInfo] = useState<GatingInfo>(NOT_GATED);
  const [operation, setOperation] = useState<TemporalOperation>('MIP');
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [status, setStatus] = useState<string>('');

  // Re-detect whenever the active viewport or the loaded display sets change.
  useEffect(() => {
    const resync = () => {
      const detected: GatingInfo =
        commandsManager?.runCommand('rt4dDetectGating') ?? NOT_GATED;
      setInfo(detected ?? NOT_GATED);
      if (detected?.phases?.length) {
        setRangeStart(0);
        setRangeEnd(detected.phases.length - 1);
      }
    };
    resync();

    const subs: any[] = [];
    const subscribe = (service: any, names: string[]) => {
      if (!service?.subscribe) {
        return;
      }
      const events = service.EVENTS ?? {};
      names
        .map(name => events[name])
        .filter(Boolean)
        .forEach((event: string) => subs.push(service.subscribe(event, resync)));
    };
    subscribe(viewportGridService, ['ACTIVE_VIEWPORT_ID_CHANGED', 'GRID_STATE_CHANGED']);
    subscribe(displaySetService, ['DISPLAY_SETS_ADDED', 'DISPLAY_SETS_CHANGED']);

    return () => subs.forEach(s => s?.unsubscribe?.());
  }, [viewportGridService, displaySetService, commandsManager]);

  const phases = info.phases;
  const incomplete = useMemo(() => isPhaseSetIncomplete(info), [info]);

  const selectPhase = (index: number) => {
    // Commands count dimension groups from 1; phases here are 0-based.
    const result = commandsManager?.runCommand('rt4dSetPhase', { phase: index + 1 });
    setStatus(result?.ok ? '' : (result?.reason ?? ''));
  };

  const project = async () => {
    const start = Math.min(rangeStart, rangeEnd);
    const end = Math.max(rangeStart, rangeEnd);
    const phaseIndices = Array.from({ length: end - start + 1 }, (_unused, i) => start + i);
    setStatus('Projecting…');
    try {
      const result = await commandsManager?.runCommand('rt4dTemporalProjection', {
        operation,
        phaseIndices,
      });
      setStatus(result?.ok ? (result.description ?? 'Done') : (result?.reason ?? 'Failed'));
    } catch (error) {
      setStatus((error as Error)?.message ?? 'Failed');
    }
  };

  return (
    <div
      className="ohif-scrollbar flex h-full flex-col overflow-auto px-2 py-2 text-sm text-white"
      data-cy="rt-4d-panel"
    >
      <span className="mb-1 text-base font-medium">4D / gating</span>
      <span className="text-muted-foreground mb-2 text-xs">{describeGating(info)}</span>

      {info.sourceTag && (
        <span className="text-muted-foreground mb-2 text-[11px]">
          Phases from <code>{info.sourceTag}</code>
          {info.respiratorySignalSource ? ` · signal: ${info.respiratorySignalSource}` : ''}
        </span>
      )}

      {incomplete && (
        <div className="mb-2 rounded bg-yellow-500/20 p-2 text-[11px] text-yellow-200">
          Only {phases.length} of {info.expectedPhaseCount} phases are present. Contouring on an
          incomplete respiratory cycle will miss part of the tumour excursion.
        </div>
      )}

      {!info.isGated && (
        <p className="text-muted-foreground text-[11px]">
          The active series carries no respiratory, cardiac or temporal phase tags.
        </p>
      )}

      {info.isGated && (
        <>
          <span className="text-muted-foreground mb-1 text-xs">Phases</span>
          <div className="mb-3 flex flex-wrap gap-1">
            {phases.map(phase => (
              <button
                key={phase.key}
                type="button"
                className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
                title={`${phase.instanceCount} images`}
                onClick={() => selectPhase(phase.index)}
              >
                {phase.label}
              </button>
            ))}
          </div>

          <span className="text-muted-foreground mb-1 text-xs">Temporal projection</span>
          <select
            className="mb-2 rounded bg-black/30 p-1 text-sm"
            value={operation}
            onChange={e => setOperation(e.target.value as TemporalOperation)}
          >
            {TEMPORAL_OPERATIONS.map(op => (
              <option key={op} value={op}>
                {TEMPORAL_OPERATION_LABELS[op]}
              </option>
            ))}
          </select>

          <div className="mb-2 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">From</span>
              <select
                className="rounded bg-black/30 p-1 text-sm"
                value={rangeStart}
                onChange={e => setRangeStart(Number(e.target.value))}
              >
                {phases.map(p => (
                  <option key={p.key} value={p.index}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">To</span>
              <select
                className="rounded bg-black/30 p-1 text-sm"
                value={rangeEnd}
                onChange={e => setRangeEnd(Number(e.target.value))}
              >
                {phases.map(p => (
                  <option key={p.key} value={p.index}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="button"
            className="mb-2 rounded bg-white/10 p-2 text-sm hover:bg-white/20"
            onClick={project}
          >
            Build projection
          </button>

          <p className="text-muted-foreground text-[11px]">
            MIP across the cycle is the union of tumour positions the ITV is drawn from.
            Cornerstone's built-in temporal operators offer only sum, average and subtract, so
            max and min are computed here.
          </p>
        </>
      )}

      {status && <span className="mt-2 text-[11px] text-sky-300">{status}</span>}
    </div>
  );
}

export default Rt4dPanel;
