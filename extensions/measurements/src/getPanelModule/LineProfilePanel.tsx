import React, { useEffect, useState } from 'react';
import LineProfileChart from './LineProfileChart';
import {
  getLineProfile,
  subscribeLineProfile,
  type LineProfileState,
} from '../lineProfileStore';
import { profileStats, profileToCsv } from '../lineProfile';

/** Density profile panel (RTV-32): live chart + stats + CSV export. */
export default function LineProfilePanel(): React.ReactElement {
  const [state, setState] = useState<LineProfileState>(() => getLineProfile());

  useEffect(() => subscribeLineProfile(setState), []);

  const stats = profileStats(state.points);
  const unit = state.unit ?? '';

  const exportCsv = () => {
    if (typeof document === 'undefined' || !state.points.length) {
      return;
    }
    const blob = new Blob([profileToCsv(state.points)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'density-profile.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-2 text-foreground" data-cy="line-profile-panel">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-base font-medium">Perfil de Densidade</span>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!state.points.length}
          className="rounded bg-secondary-dark px-2 py-0.5 text-sm disabled:opacity-50"
          data-cy="line-profile-csv"
        >
          CSV
        </button>
      </div>
      <LineProfileChart points={state.points} unit={unit} />
      {stats ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
          <dt className="opacity-70">Min</dt>
          <dd>{Math.round(stats.min)} {unit}</dd>
          <dt className="opacity-70">Max</dt>
          <dd>{Math.round(stats.max)} {unit}</dd>
          <dt className="opacity-70">Média</dt>
          <dd>{stats.mean.toFixed(1)} {unit}</dd>
          <dt className="opacity-70">Comprimento</dt>
          <dd>{stats.lengthMm.toFixed(1)} mm</dd>
          <dt className="opacity-70">Amostras</dt>
          <dd>{stats.count}</dd>
        </dl>
      ) : null}
    </div>
  );
}
