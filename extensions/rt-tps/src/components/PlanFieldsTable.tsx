import React from 'react';
import { usePlanData } from '../hooks/usePlanData';
import { num, angle, pair, mmToCm } from '../format';

/**
 * Eclipse "Fields" Info Window tab (RTV Wave 4 / Phase 2).
 *
 * Reproduces the beam/field table from the Varian Eclipse External Beam Planning
 * window (manual ref p28_i0.png): one row per beam with Group / Field ID /
 * Technique / Machine·Energy / MLC / Gantry / Coll / Couch / Wedge / Field X·Y
 * jaws / isocenter X·Y·Z / SSD / MU / Ref.D. Reads the parsed `displaySet.rtPlan`
 * model (rt-plan). Display-only — no editing. Horizontally scrollable; the page
 * body never scrolls sideways.
 */

interface Col {
  key: string;
  label: string;
  className?: string;
}

const COLS: Col[] = [
  { key: 'group', label: 'Group' },
  { key: 'field', label: 'Field ID' },
  { key: 'name', label: 'Nome' },
  { key: 'technique', label: 'Técnica' },
  { key: 'machine', label: 'Máquina/Energia' },
  { key: 'mlc', label: 'MLC' },
  { key: 'gantry', label: 'Gantry', className: 'text-right' },
  { key: 'coll', label: 'Coll', className: 'text-right' },
  { key: 'couch', label: 'Couch', className: 'text-right' },
  { key: 'wedge', label: 'Wedge' },
  { key: 'fieldX', label: 'Campo X [cm]', className: 'text-right' },
  { key: 'fieldY', label: 'Campo Y [cm]', className: 'text-right' },
  { key: 'isoX', label: 'X [cm]', className: 'text-right' },
  { key: 'isoY', label: 'Y [cm]', className: 'text-right' },
  { key: 'isoZ', label: 'Z [cm]', className: 'text-right' },
  { key: 'ssd', label: 'SSD [cm]', className: 'text-right' },
  { key: 'mu', label: 'MU', className: 'text-right' },
  { key: 'refd', label: 'Ref.D [Gy]', className: 'text-right' },
];

export default function PlanFieldsTable({
  servicesManager,
}: {
  servicesManager: any;
}): React.ReactElement {
  const { displaySets, selected, selectedUID, setSelectedUID, plan } = usePlanData(servicesManager);

  if (!plan) {
    return (
      <div className="text-muted-foreground p-3 text-sm" data-cy="rt-tps-fields">
        Nenhum RT Plan carregado.
      </div>
    );
  }

  const totalMu = plan.totalMeterset;

  return (
    <div className="flex h-full flex-col" data-cy="rt-tps-fields">
      <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Campos</span>
          {displaySets.length > 1 && (
            <select
              className="border-input bg-muted/40 rounded border px-1 py-0.5 text-xs"
              value={selectedUID}
              onChange={e => setSelectedUID(e.target.value)}
              data-cy="rt-tps-fields-plan-select"
            >
              {displaySets.map(ds => (
                <option key={ds.displaySetInstanceUID} value={ds.displaySetInstanceUID}>
                  {ds.label || ds.SeriesDescription || ds.rtPlan?.label || ds.displaySetInstanceUID}
                </option>
              ))}
            </select>
          )}
        </div>
        <span className="text-muted-foreground text-xs">
          {selected?.rtPlan?.label || selected?.label || ''} · {plan.beams.length} campos
          {plan.approvalStatus ? ` · ${plan.approvalStatus}` : ''}
        </span>
      </div>

      <div className="ohif-scrollbar min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted/40 sticky top-0">
            <tr className="text-muted-foreground text-left">
              {COLS.map(c => (
                <th
                  key={c.key}
                  className={`whitespace-nowrap px-2 py-1 font-medium ${c.className ?? ''}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.beams.map((b, i) => (
              <tr
                key={b.number != null ? `n${b.number}` : `i${i}`}
                className="border-input hover:bg-muted/30 border-t"
                data-cy="rt-tps-field-row"
              >
                <td className="px-2 py-1">{num(b.fractionGroupNumber)}</td>
                <td className="px-2 py-1">{b.number ?? '—'}</td>
                <td className="whitespace-nowrap px-2 py-1">{b.name || '—'}</td>
                <td className="whitespace-nowrap px-2 py-1">{b.type || '—'}</td>
                <td className="whitespace-nowrap px-2 py-1">
                  {[b.machine, b.energy].filter(Boolean).join(' · ') || '—'}
                </td>
                <td className="px-2 py-1">{b.hasMlc ? 'MLC' : 'None'}</td>
                <td className="px-2 py-1 text-right">{angle(b.gantryAngle)}</td>
                <td className="px-2 py-1 text-right">{angle(b.collimatorAngle)}</td>
                <td className="px-2 py-1 text-right">{angle(b.patientSupportAngle)}</td>
                <td className="px-2 py-1">{b.numberOfWedges ? String(b.numberOfWedges) : 'None'}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right">{pair(b.jawX)}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right">{pair(b.jawY)}</td>
                <td className="px-2 py-1 text-right">{mmToCm(b.isocenter?.[0])}</td>
                <td className="px-2 py-1 text-right">{mmToCm(b.isocenter?.[1])}</td>
                <td className="px-2 py-1 text-right">{mmToCm(b.isocenter?.[2])}</td>
                <td className="px-2 py-1 text-right">{num(b.ssdCm)}</td>
                <td className="px-2 py-1 text-right">{num(b.meterset)}</td>
                <td className="px-2 py-1 text-right">{num(b.beamDoseGy, 2)}</td>
              </tr>
            ))}
          </tbody>
          {totalMu != null && (
            <tfoot>
              <tr className="border-input text-muted-foreground border-t">
                <td className="px-2 py-1" colSpan={COLS.length - 2}>
                  Total
                </td>
                <td className="px-2 py-1 text-right font-medium">{num(totalMu)}</td>
                <td className="px-2 py-1" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
