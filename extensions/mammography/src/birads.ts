/**
 * Pure **ACR BI-RADS® (5th ed.)** model + structured-report builder (RTV-78).
 *
 * Framework-free and `@ohif/*`-free: assessment categories, breast-density
 * categories, the finding lexicon, recommended management, and a report-text
 * builder — all unit-tested. The mammography panel renders this; the image
 * overlay of findings and DICOM SR (TID 2000) export are viewport/SR follow-ups.
 */

export interface BiradsCategory {
  code: string;
  label: string;
  management: string;
  /** Likelihood-of-malignancy descriptor (ACR). */
  malignancy: string;
}

/** BI-RADS assessment categories 0–6 (+ 4A/4B/4C subdivisions). */
export const BIRADS_CATEGORIES: BiradsCategory[] = [
  { code: '0', label: 'Incomplete', management: 'Recall for additional imaging and/or comparison with priors', malignancy: 'N/A' },
  { code: '1', label: 'Negative', management: 'Routine screening', malignancy: 'Essentially 0%' },
  { code: '2', label: 'Benign', management: 'Routine screening', malignancy: 'Essentially 0%' },
  { code: '3', label: 'Probably benign', management: 'Short-interval (6-month) follow-up', malignancy: '> 0% but ≤ 2%' },
  { code: '4', label: 'Suspicious', management: 'Tissue diagnosis', malignancy: '> 2% to < 95%' },
  { code: '4A', label: 'Suspicious — low', management: 'Tissue diagnosis', malignancy: '> 2% to ≤ 10%' },
  { code: '4B', label: 'Suspicious — moderate', management: 'Tissue diagnosis', malignancy: '> 10% to ≤ 50%' },
  { code: '4C', label: 'Suspicious — high', management: 'Tissue diagnosis', malignancy: '> 50% to < 95%' },
  { code: '5', label: 'Highly suggestive of malignancy', management: 'Tissue diagnosis', malignancy: '≥ 95%' },
  { code: '6', label: 'Known biopsy-proven malignancy', management: 'Surgical excision when clinically appropriate', malignancy: 'N/A' },
];

export interface BreastDensity {
  code: string;
  description: string;
}
export const BREAST_DENSITY: BreastDensity[] = [
  { code: 'a', description: 'The breasts are almost entirely fatty' },
  { code: 'b', description: 'There are scattered areas of fibroglandular density' },
  { code: 'c', description: 'The breasts are heterogeneously dense, which may obscure small masses' },
  { code: 'd', description: 'The breasts are extremely dense, which lowers the sensitivity of mammography' },
];

/** Finding lexicon (key descriptor sets from ACR BI-RADS 5th ed.). */
export const BIRADS_LEXICON = {
  findingTypes: ['Mass', 'Calcifications', 'Architectural distortion', 'Asymmetry', 'Lymph node', 'Skin lesion'],
  massShape: ['Oval', 'Round', 'Irregular'],
  massMargin: ['Circumscribed', 'Obscured', 'Microlobulated', 'Indistinct', 'Spiculated'],
  massDensity: ['High density', 'Equal density', 'Low density', 'Fat-containing'],
  calcMorphology: {
    typicallyBenign: ['Skin', 'Vascular', 'Coarse (popcorn-like)', 'Large rod-like', 'Round', 'Rim', 'Dystrophic', 'Milk of calcium', 'Suture'],
    suspicious: ['Amorphous', 'Coarse heterogeneous', 'Fine pleomorphic', 'Fine linear or fine-linear branching'],
  },
  calcDistribution: ['Diffuse', 'Regional', 'Grouped', 'Linear', 'Segmental'],
} as const;

/** Annotation/measurement labels exposed to the toolbar via customization. */
export const BIRADS_MEASUREMENT_LABELS = BIRADS_LEXICON.findingTypes.map(label => ({
  label,
  value: label.toLowerCase().replace(/\s+/g, '-'),
}));

/** Look up a category (case-insensitive on code). */
export function getBiradsCategory(code: string): BiradsCategory | undefined {
  return BIRADS_CATEGORIES.find(c => c.code.toLowerCase() === String(code).toLowerCase());
}

/** Recommended management text for a category code. */
export function recommendedManagement(code: string): string | undefined {
  return getBiradsCategory(code)?.management;
}

export interface BiradsFinding {
  type: string;
  descriptors?: string[];
  location?: string;
}

export interface BiradsAssessment {
  laterality?: 'Right' | 'Left' | 'Bilateral';
  density?: string; // a-d
  findings?: BiradsFinding[];
  category: string; // 0-6 / 4A-4C
}

/** Build a structured BI-RADS report text from an assessment. */
export function buildBiradsReport(assessment: BiradsAssessment): string {
  const lines: string[] = [];
  const density = assessment.density ? BREAST_DENSITY.find(d => d.code === assessment.density) : undefined;
  if (density) {
    lines.push(`Breast composition: ACR ${density.code} — ${density.description}.`);
  }
  if (assessment.laterality) {
    lines.push(`Laterality: ${assessment.laterality}.`);
  }
  if (assessment.findings?.length) {
    lines.push('Findings:');
    for (const f of assessment.findings) {
      const desc = f.descriptors?.length ? ` (${f.descriptors.join(', ')})` : '';
      const loc = f.location ? ` — ${f.location}` : '';
      lines.push(`  • ${f.type}${desc}${loc}`);
    }
  }
  const cat = getBiradsCategory(assessment.category);
  if (cat) {
    lines.push(`Assessment: BI-RADS ${cat.code} — ${cat.label}.`);
    lines.push(`Likelihood of malignancy: ${cat.malignancy}.`);
    lines.push(`Management: ${cat.management}.`);
  } else {
    lines.push(`Assessment: BI-RADS ${assessment.category}.`);
  }
  return lines.join('\n');
}

export default buildBiradsReport;
