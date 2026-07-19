import {
  BIRADS_CATEGORIES,
  BREAST_DENSITY,
  BIRADS_MEASUREMENT_LABELS,
  getBiradsCategory,
  recommendedManagement,
  buildBiradsReport,
} from './birads';

describe('BI-RADS catalogue', () => {
  it('covers categories 0–6 plus 4A/4B/4C', () => {
    const codes = BIRADS_CATEGORIES.map(c => c.code);
    expect(codes).toEqual(['0', '1', '2', '3', '4', '4A', '4B', '4C', '5', '6']);
  });

  it('has 4 ACR breast-density categories a–d', () => {
    expect(BREAST_DENSITY.map(d => d.code)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('exposes measurement labels (value-slugged)', () => {
    const mass = BIRADS_MEASUREMENT_LABELS.find(l => l.label === 'Mass');
    expect(mass).toEqual({ label: 'Mass', value: 'mass' });
    expect(BIRADS_MEASUREMENT_LABELS.find(l => l.label === 'Architectural distortion')?.value).toBe('architectural-distortion');
  });
});

describe('getBiradsCategory / recommendedManagement', () => {
  it('looks up case-insensitively', () => {
    expect(getBiradsCategory('4c')?.label).toBe('Suspicious — high');
    expect(getBiradsCategory('5')?.malignancy).toBe('≥ 95%');
  });
  it('returns management text', () => {
    expect(recommendedManagement('3')).toMatch(/6-month/);
    expect(recommendedManagement('1')).toBe('Routine screening');
    expect(recommendedManagement('99')).toBeUndefined();
  });
});

describe('buildBiradsReport', () => {
  it('renders composition, findings, assessment and management', () => {
    const report = buildBiradsReport({
      laterality: 'Right',
      density: 'c',
      findings: [{ type: 'Mass', descriptors: ['Irregular', 'Spiculated'], location: 'Upper outer quadrant' }],
      category: '4B',
    });
    expect(report).toContain('ACR c — The breasts are heterogeneously dense');
    expect(report).toContain('Laterality: Right.');
    expect(report).toContain('• Mass (Irregular, Spiculated) — Upper outer quadrant');
    expect(report).toContain('BI-RADS 4B — Suspicious — moderate');
    expect(report).toContain('Management: Tissue diagnosis.');
  });

  it('handles a minimal negative assessment', () => {
    const report = buildBiradsReport({ category: '1' });
    expect(report).toContain('BI-RADS 1 — Negative');
    expect(report).toContain('Management: Routine screening.');
  });
});
