/**
 * Derive an ROI's clinical category + short type label from its name and TG-263
 * code, so the structures "Focus" panel can group ROIs into
 * Targets / Organs at risk / External-Support and show a type badge per row.
 *
 * Ported from autoseg (apps/frontend/src/components/viewer/roiCategory.ts,
 * ATS-235) — a pure, frontend-only heuristic: RTSTRUCT carries name/code/color
 * but no authoritative RTROIInterpretedType for many protocols. Pure function →
 * cheap per render, easy to unit-test. RTV-114: no @ohif/* import. i18n keys from
 * the source are replaced with literal English/PT labels for this viewer.
 */

export type RoiCategory = 'target' | 'oar' | 'external';

export interface RoiClassification {
  category: RoiCategory;
  /** Short badge label: GTV / CTV / PTV / ITV / IGTV / Organ / External / Support. */
  type: string;
}

// Target sub-types, longest-first so IGTV is matched before GTV (it contains it)
// and ITV before the bare target keys.
const TARGET_KEYS = ['IGTV', 'ITV', 'PTV', 'CTV', 'GTV'] as const;

// Body/skin contours → "External". Leading-boundary only so glued clinical
// names (e.g. SkinFold) still match, while embedded runs (ANTIBODY) do not.
const EXTERNAL_RE = /(^|[^A-Z])(EXTERNAL|BODY|SKIN|PATIENT_OUTLINE)/;
// Immobilisation / setup hardware and optimisation aids → "Support".
const SUPPORT_RE =
  /(^|[^A-Z])(COUCH|TABLE|SUPPORT|BOLUS|MARKER|FIDUCIAL|REGISTRATION|RAIL|BOARD)/;

/** Match a whole-ish token (not embedded inside a longer alpha run). */
function hasToken(haystack: string, token: string): boolean {
  return new RegExp(`(^|[^A-Z])${token}([^A-Z]|$)`).test(haystack);
}

/**
 * Classify an ROI. `name` is the display name; `code` is the TG-263 code
 * (both consulted so a protocol alias that hides the type in the name is still
 * caught via the code, and vice-versa).
 */
export function categorizeRoi(name: string, code?: string): RoiClassification {
  const hay = ` ${(name ?? '').toUpperCase()} ${(code ?? '').toUpperCase()} `;

  if (EXTERNAL_RE.test(hay)) {
    return { category: 'external', type: 'External' };
  }
  if (SUPPORT_RE.test(hay)) {
    return { category: 'external', type: 'Support' };
  }

  for (const key of TARGET_KEYS) {
    // Tolerate both whole-token (`PTV_High`, `CTV 54`) and glued forms (`CTVn`,
    // `PTVboost`) which are common in clinical naming.
    if (hasToken(hay, key) || hay.includes(key)) {
      return { category: 'target', type: key };
    }
  }

  return { category: 'oar', type: 'Organ' };
}

/** Fixed, conventional badge colours for the target sub-types (Carbon palette). */
const TARGET_BADGE: Record<string, string> = {
  GTV: '#A2191F', // red 70
  CTV: '#0F62FE', // blue 60
  PTV: '#198038', // green 60
  ITV: '#8A3FFC', // purple 60
  IGTV: '#9F1853', // magenta 70
};

/**
 * Resolve the badge background colour for a classification. Targets use the
 * fixed conventional colours; organs / external-support are tinted from the
 * ROI's own display colour.
 */
export function roiBadgeColor(cls: RoiClassification, rgb: [number, number, number]): string {
  if (cls.category === 'target') {
    return TARGET_BADGE[cls.type] ?? '#6F6F6F';
  }
  const [r, g, b] = rgb;
  return `rgb(${r}, ${g}, ${b})`;
}

/** Pick black/white text for contrast against a solid background colour. */
export function contrastText(rgb: [number, number, number]): string {
  const [r, g, b] = rgb;
  // Relative luminance (sRGB approximation).
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#161616' : '#ffffff';
}

export const ROI_CATEGORY_ORDER: RoiCategory[] = ['target', 'oar', 'external'];

/** Short type badge text (target sub-types shown verbatim; others generic). */
export function roiTypeLabel(cls: RoiClassification): string {
  if (cls.category === 'target') {
    return cls.type;
  }
  if (cls.category === 'oar') {
    return 'Organ';
  }
  return cls.type === 'Support' ? 'Support' : 'External';
}

/** Group heading for a category. */
export function categoryLabel(category: RoiCategory): string {
  switch (category) {
    case 'target':
      return 'Alvos';
    case 'external':
      return 'Externo / Suporte';
    case 'oar':
    default:
      return 'Órgãos de risco';
  }
}
