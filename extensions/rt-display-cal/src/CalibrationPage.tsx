/**
 * Fullscreen display-QC page (RTV-211) served at /display-calibration via the
 * `routes.customRoutes` customization (see getCustomizationModule.ts). The app
 * router injects `servicesManager` (platform/app/src/routes/index.tsx), used
 * best-effort for the operator identity.
 *
 * Layout: black full-viewport page with the selected TG18-style pattern on a
 * central canvas and a collapsible side panel holding the GSDF curve (pure SVG
 * from gsdfCurve, dvhChart-style geometry), the visual-conformance checklist
 * and the audit trail (ConformanceStore + CSV export).
 *
 * SCOPE (Fase 1, documented in gsdf.ts too): a browser cannot measure emitted
 * luminance — real PS3.14/TG-270 conformance needs a photometer — and GPU-LUT/
 * ICC calibration is out of scope. This page delivers visual QA against
 * computed GSDF targets with an auditable record of each session.
 *
 * DOM glue — verified interactively in the running app (data-cy: rt-cal-page, rt-cal-pattern-select,
 * rt-cal-canvas, rt-cal-checklist, rt-cal-record-btn, rt-cal-export-csv).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gsdfCurve, JND_MIN, JND_MAX } from './gsdf';
import { tg18qcSpec, tg18lnSpec, luminanceRampSpec, PatternSpec } from './tg18Patterns';
import { renderPatternToCanvas } from './renderPattern';
import { ConformanceStore, ConformanceRecord, exportCsv } from './conformanceStore';

interface ServicesManagerLike {
  services?: Record<string, any>;
}

export interface CalibrationPageProps {
  servicesManager?: ServicesManagerLike;
}

type PatternKey = 'qc' | 'ln' | 'ramp';

const PATTERNS: Record<PatternKey, { label: string; build: () => PatternSpec }> = {
  qc: { label: 'TG18-QC (overall)', build: () => tg18qcSpec() },
  ln: { label: 'TG18-LN (18 luminance steps)', build: () => tg18lnSpec(18) },
  ramp: { label: 'Luminance ramp (banding)', build: () => luminanceRampSpec(256) },
};

/** Checklist ids double as the answer keys in the audit record / CSV columns. */
const CHECKLIST: { id: string; label: string }[] = [
  { id: 'corner5', label: '0% squares inside the 5% corner patches are visible (TG18-QC)' },
  { id: 'corner95', label: '100% squares inside the 95% corner patches are visible (TG18-QC)' },
  { id: 'patches18', label: 'All 18 TG18-LN patches are distinguishable from their neighbours' },
  { id: 'rampSmooth', label: 'Luminance ramp is smooth — no banding or contouring' },
];

/** dvhChart-style pure geometry for the GSDF curve (log10 L over JND index). */
function buildGsdfChart(nPoints = 128) {
  const width = 300;
  const height = 180;
  const pad = 34;
  const points = gsdfCurve(nPoints);
  const logMin = Math.log10(points[0].L);
  const logMax = Math.log10(points[points.length - 1].L);
  const plotW = width - 2 * pad;
  const plotH = height - 2 * pad;
  const xOf = (j: number) => pad + ((j - JND_MIN) / (JND_MAX - JND_MIN)) * plotW;
  const yOf = (L: number) => height - pad - ((Math.log10(L) - logMin) / (logMax - logMin)) * plotH;
  const polyline = points.map(p => `${xOf(p.j).toFixed(1)},${yOf(p.L).toFixed(1)}`).join(' ');
  const lumTicks = [0.1, 1, 10, 100, 1000]
    .filter(L => Math.log10(L) >= logMin && Math.log10(L) <= logMax)
    .map(L => ({ value: L, y: yOf(L) }));
  const jndTicks = [1, 256, 512, 768, 1023].map(j => ({ value: j, x: xOf(j) }));
  return { width, height, pad, polyline, lumTicks, jndTicks };
}

function downloadBlob(content: string, type: string, filename: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Best-effort operator identity from the OIDC user (never throws). */
function readUser(servicesManager?: ServicesManagerLike): string {
  try {
    const user = servicesManager?.services?.userAuthenticationService?.getUser?.();
    return (
      user?.profile?.name ||
      user?.profile?.preferred_username ||
      user?.profile?.email ||
      'unknown'
    );
  } catch {
    return 'unknown';
  }
}

const STATION_ID_KEY = 'rt-display-cal-station';

/**
 * Workstation identity. `location.hostname` is the SERVER host (identical on
 * every workstation of a site), so the operator can set a per-station id —
 * persisted locally — and the screen resolution is appended as a hint.
 */
function readStation(): string {
  let custom = '';
  try {
    custom = (globalThis as any).localStorage?.getItem?.(STATION_ID_KEY) ?? '';
  } catch {
    /* storage unavailable */
  }
  const base = custom || ((globalThis as any).location?.hostname ?? 'unknown');
  const screen = (globalThis as any).screen;
  return screen ? `${base} (${screen.width}x${screen.height})` : base;
}

/** Persist the operator-chosen station id (best-effort). */
function writeStationId(id: string): void {
  try {
    (globalThis as any).localStorage?.setItem?.(STATION_ID_KEY, id);
  } catch {
    /* storage unavailable */
  }
}

export function CalibrationPage({ servicesManager }: CalibrationPageProps): React.ReactElement {
  const [patternKey, setPatternKey] = useState<PatternKey>('qc');
  const [panelOpen, setPanelOpen] = useState(true);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const [stationId, setStationId] = useState<string>(() => {
    try {
      return (globalThis as any).localStorage?.getItem?.(STATION_ID_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const store = useMemo(() => new ConformanceStore(), []);
  const [records, setRecords] = useState<ConformanceRecord[]>(() => store.listRecords());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chart = useMemo(() => buildGsdfChart(), []);

  // Render the selected pattern at device-pixel resolution (renderPattern.ts
  // note: CSS scaling would resample and could itself introduce banding).
  useEffect(() => {
    const render = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) {
        return;
      }
      const dpr = (globalThis as any).devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(container.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(container.clientHeight * dpr));
      renderPatternToCanvas(canvas, PATTERNS[patternKey].build());
    };
    render();
    window.addEventListener('resize', render);
    return () => window.removeEventListener('resize', render);
  }, [patternKey, panelOpen]);

  const allAnswered = CHECKLIST.every(item => answers[item.id] !== undefined);

  const handleRecord = useCallback(() => {
    if (!allAnswered) {
      return;
    }
    writeStationId(stationId.trim());
    store.recordConformanceCheck({
      station: readStation(),
      user: readUser(servicesManager),
      answers,
      passed: CHECKLIST.every(item => answers[item.id] === true),
      notes,
      now: new Date().toISOString(),
    });
    setRecords(store.listRecords());
    setAnswers({});
    setNotes('');
  }, [allAnswered, answers, notes, servicesManager, stationId, store]);

  const handleExportCsv = useCallback(() => {
    downloadBlob(exportCsv(records), 'text/csv;charset=utf-8', 'display-conformance.csv');
  }, [records]);

  return (
    <div
      data-cy="rt-cal-page"
      className="flex h-screen w-screen overflow-hidden bg-black text-white"
    >
      <div ref={containerRef} className="relative min-w-0 flex-1">
        <canvas data-cy="rt-cal-canvas" ref={canvasRef} className="block h-full w-full" />
        <div className="absolute left-2 top-2 flex items-center gap-2 rounded bg-black/70 p-2 text-sm">
          <label htmlFor="rt-cal-pattern-select">Pattern</label>
          <select
            id="rt-cal-pattern-select"
            data-cy="rt-cal-pattern-select"
            className="rounded border border-white/30 bg-black px-2 py-1"
            value={patternKey}
            onChange={event => setPatternKey(event.target.value as PatternKey)}
          >
            {Object.entries(PATTERNS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <button
            className="rounded border border-white/30 px-2 py-1"
            onClick={() => setPanelOpen(open => !open)}
          >
            {panelOpen ? 'Hide panel' : 'Show panel'}
          </button>
        </div>
      </div>

      {panelOpen && (
        <aside className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/20 bg-black p-3 text-sm">
          <section>
            <h2 className="mb-1 text-base font-medium">GSDF curve (DICOM PS3.14)</h2>
            <p className="mb-2 text-xs text-white/60">
              Target luminance vs JND index (log scale). Visual QA only — luminance measurement
              requires a photometer.
            </p>
            <svg
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              className="w-full"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect x={0} y={0} width={chart.width} height={chart.height} fill="#1a1a1a" />
              {chart.lumTicks.map((tick, i) => (
                <g key={`l${i}`}>
                  <line
                    x1={chart.pad}
                    y1={tick.y}
                    x2={chart.width - chart.pad}
                    y2={tick.y}
                    stroke="#333"
                  />
                  <text x={chart.pad - 4} y={tick.y + 3} fontSize={9} fill="#999" textAnchor="end">
                    {tick.value}
                  </text>
                </g>
              ))}
              {chart.jndTicks.map((tick, i) => (
                <text
                  key={`j${i}`}
                  x={tick.x}
                  y={chart.height - chart.pad + 12}
                  fontSize={9}
                  fill="#999"
                  textAnchor="middle"
                >
                  {tick.value}
                </text>
              ))}
              <text
                x={chart.width / 2}
                y={chart.height - 4}
                fontSize={10}
                fill="#bbb"
                textAnchor="middle"
              >
                JND index
              </text>
              <text
                x={10}
                y={chart.height / 2}
                fontSize={10}
                fill="#bbb"
                textAnchor="middle"
                transform={`rotate(-90 10 ${chart.height / 2})`}
              >
                cd/m²
              </text>
              <polyline points={chart.polyline} fill="none" stroke="#4ec9b0" strokeWidth={1.5} />
            </svg>
          </section>

          <section data-cy="rt-cal-checklist">
            <h2 className="mb-1 text-base font-medium">Visual conformance checklist</h2>
            <ul className="flex flex-col gap-2">
              {CHECKLIST.map(item => (
                <li key={item.id} className="flex items-start justify-between gap-2">
                  <span className="flex-1">{item.label}</span>
                  <span className="flex shrink-0 gap-1">
                    <button
                      className={`rounded border px-2 py-0.5 ${
                        answers[item.id] === true
                          ? 'border-green-400 bg-green-900/60'
                          : 'border-white/30'
                      }`}
                      onClick={() => setAnswers(a => ({ ...a, [item.id]: true }))}
                    >
                      Yes
                    </button>
                    <button
                      className={`rounded border px-2 py-0.5 ${
                        answers[item.id] === false
                          ? 'border-red-400 bg-red-900/60'
                          : 'border-white/30'
                      }`}
                      onClick={() => setAnswers(a => ({ ...a, [item.id]: false }))}
                    >
                      No
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <input
              data-cy="rt-cal-station"
              className="mt-2 w-full rounded border border-white/30 bg-black p-1 text-sm"
              placeholder="Station id (e.g. WS-RAD-01 — hostname is the server, not this workstation)"
              value={stationId}
              onChange={event => setStationId(event.target.value)}
            />
            <textarea
              className="mt-2 w-full rounded border border-white/30 bg-black p-1 text-sm"
              rows={2}
              placeholder="Notes (optional)"
              value={notes}
              onChange={event => setNotes(event.target.value)}
            />
            <button
              data-cy="rt-cal-record-btn"
              className="mt-2 w-full rounded border border-white/40 bg-white/10 px-2 py-1 font-medium disabled:opacity-40"
              disabled={!allAnswered}
              onClick={handleRecord}
            >
              Record conformance check
            </button>
          </section>

          <section>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-base font-medium">Records ({records.length})</h2>
              <button
                data-cy="rt-cal-export-csv"
                className="rounded border border-white/30 px-2 py-0.5 disabled:opacity-40"
                disabled={!records.length}
                onClick={handleExportCsv}
              >
                Export CSV
              </button>
            </div>
            {records.length === 0 ? (
              <p className="text-white/60">No conformance checks recorded on this station yet.</p>
            ) : (
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left text-white/60">
                    <th className="py-1">Date</th>
                    <th>User</th>
                    <th className="text-right">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {[...records].reverse().map(record => (
                    <tr key={record.id} className="border-t border-white/10">
                      <td className="py-1">{record.recordedAt.replace('T', ' ').slice(0, 16)}</td>
                      <td>{record.user}</td>
                      <td
                        className={`text-right font-medium ${
                          record.passed ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {record.passed ? 'PASS' : 'FAIL'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </aside>
      )}
    </div>
  );
}

export default CalibrationPage;
