import React from 'react';
import type { ProfilePoint } from '../lineProfile';

/** Minimal dependency-free SVG line chart (distance mm on X, value on Y). */
export default function LineProfileChart({
  points,
  unit = '',
  width = 280,
  height = 150,
}: {
  points: ProfilePoint[];
  unit?: string;
  width?: number;
  height?: number;
}): React.ReactElement {
  const pad = { l: 34, r: 6, t: 8, b: 18 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;

  if (points.length < 2) {
    return <div className="text-muted-foreground p-2 text-sm">Sem perfil. Desenhe uma linha com a ferramenta Perfil.</div>;
  }

  const xs = points.map(p => p.distanceMm);
  const ys = points.map(p => p.value);
  const xMax = Math.max(...xs) || 1;
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yRange = yMax - yMin || 1;

  const sx = (d: number) => pad.l + (d / xMax) * w;
  const sy = (v: number) => pad.t + h - ((v - yMin) / yRange) * h;

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.distanceMm).toFixed(1)},${sy(p.value).toFixed(1)}`).join(' ');

  return (
    <svg width={width} height={height} role="img" aria-label="line profile chart">
      {/* axes */}
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + h} stroke="currentColor" strokeOpacity={0.4} />
      <line x1={pad.l} y1={pad.t + h} x2={pad.l + w} y2={pad.t + h} stroke="currentColor" strokeOpacity={0.4} />
      {/* y labels */}
      <text x={2} y={pad.t + 8} fontSize={9} fill="currentColor" fillOpacity={0.7}>{Math.round(yMax)}</text>
      <text x={2} y={pad.t + h} fontSize={9} fill="currentColor" fillOpacity={0.7}>{Math.round(yMin)}</text>
      {/* x labels */}
      <text x={pad.l} y={height - 4} fontSize={9} fill="currentColor" fillOpacity={0.7}>0</text>
      <text x={pad.l + w - 18} y={height - 4} fontSize={9} fill="currentColor" fillOpacity={0.7}>{xMax.toFixed(0)}mm</text>
      {/* profile */}
      <path d={path} fill="none" stroke="#5acce6" strokeWidth={1.5} />
      {unit ? (
        <text x={pad.l} y={pad.t + 6} fontSize={9} fill="currentColor" fillOpacity={0.6}>{unit}</text>
      ) : null}
    </svg>
  );
}
