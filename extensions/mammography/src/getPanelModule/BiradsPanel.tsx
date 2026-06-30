/**
 * BI-RADS form right-panel (RTV-78): structured mammography assessment.
 *
 * Pure model/report from {@link ../birads}. Builds a BI-RADS assessment
 * (laterality / density / findings / category) with a live report preview and
 * copy-to-clipboard. RTV-114: `@ohif/ui-next` only. Drawing finding markers on
 * the image and DICOM SR (TID 2000) export are viewport/SR follow-ups.
 */
import React, { useMemo, useState } from 'react';
import { Button } from '@ohif/ui-next';
import {
  BIRADS_CATEGORIES,
  BREAST_DENSITY,
  BIRADS_LEXICON,
  buildBiradsReport,
  BiradsFinding,
} from '../birads';
import { downloadBiradsSr } from '../srExport';

const LATERALITIES = ['Right', 'Left', 'Bilateral'] as const;

export function BiradsPanel(): React.ReactElement {
  const [laterality, setLaterality] = useState<'Right' | 'Left' | 'Bilateral'>('Right');
  const [density, setDensity] = useState('b');
  const [category, setCategory] = useState('1');
  const [findingTypes, setFindingTypes] = useState<Set<string>>(new Set());
  const [massShape, setMassShape] = useState('');
  const [massMargin, setMassMargin] = useState('');

  const findings: BiradsFinding[] = useMemo(() => {
    return Array.from(findingTypes).map(type => {
      if (type === 'Mass') {
        const descriptors = [massShape, massMargin].filter(Boolean);
        return { type, descriptors };
      }
      return { type };
    });
  }, [findingTypes, massShape, massMargin]);

  const report = useMemo(
    () => buildBiradsReport({ laterality, density, findings, category }),
    [laterality, density, findings, category]
  );

  const toggleFinding = (type: string) => {
    setFindingTypes(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const copy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(report).catch(() => undefined);
    }
  };

  const sel = (value: string, opts: readonly string[] | { code: string }[], onChange: (v: string) => void, label: string, codeKey = false) => (
    <label className="mb-2 flex items-center justify-between gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <select className="rounded bg-black/30 p-1 text-sm" value={value} onChange={e => onChange(e.target.value)}>
        {(opts as any[]).map(o => {
          const v = codeKey ? o.code : o;
          return <option key={v} value={v}>{v}</option>;
        })}
      </select>
    </label>
  );

  return (
    <div className="ohif-scrollbar flex h-full flex-col overflow-auto px-2 py-2 text-sm text-white" data-cy="birads-panel">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-base font-medium">BI-RADS</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={copy}>Copy report</Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadBiradsSr({ laterality, density, findings, category }, { filename: 'birads-sr.dcm' })}
          >
            Export SR
          </Button>
        </div>
      </div>

      {sel(laterality, LATERALITIES, v => setLaterality(v as any), 'Laterality')}
      {sel(density, BREAST_DENSITY as any, setDensity, 'Density (ACR)', true)}

      <div className="text-muted-foreground mb-1 mt-1 text-xs">Findings</div>
      {BIRADS_LEXICON.findingTypes.map(t => (
        <label key={t} className="flex items-center gap-2 py-0.5">
          <input type="checkbox" checked={findingTypes.has(t)} onChange={() => toggleFinding(t)} />
          <span>{t}</span>
        </label>
      ))}

      {findingTypes.has('Mass') && (
        <div className="mt-1 rounded bg-black/20 p-2">
          {sel(massShape, ['', ...BIRADS_LEXICON.massShape], setMassShape, 'Mass shape')}
          {sel(massMargin, ['', ...BIRADS_LEXICON.massMargin], setMassMargin, 'Mass margin')}
        </div>
      )}

      <div className="mt-2">
        {sel(category, BIRADS_CATEGORIES as any, setCategory, 'Category', true)}
      </div>

      <div className="text-muted-foreground mb-1 mt-2 text-xs">Report preview</div>
      <pre className="whitespace-pre-wrap rounded bg-black/30 p-2 text-xs">{report}</pre>

      <p className="text-muted-foreground mt-2 text-xs">
        Finding markers on the image + DICOM SR (TID 2000) export are follow-ups.
      </p>
    </div>
  );
}

export default BiradsPanel;
