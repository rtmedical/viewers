/**
 * Anatomic sites for lesion tracking — pure data (RTV-10).
 *
 * RECIST 1.1 does **not** standardise a site list; it only distinguishes nodal from
 * non-nodal, because that changes how a lesion is measured (short axis vs longest
 * diameter) and what counts as resolved. This list is therefore a *curated* set of 38
 * sites carried over from the legacy Meteor lesion tracker, kept because the two-per-
 * organ rule needs a consistent vocabulary to group by — not because any guideline
 * prescribes these particular names.
 *
 * The `nodal` flag is the load-bearing part: get it wrong and the lesion is measured
 * on the wrong axis.
 */

export interface AnatomicSite {
  id: string;
  label: string;
  /** Measured by short axis, and resolves below 10 mm. */
  nodal: boolean;
  /** Organ key for the two-target-lesions-per-organ rule. */
  organ: string;
}

const nonNodal = (id: string, label: string, organ = id): AnatomicSite => ({
  id,
  label,
  nodal: false,
  organ,
});

const node = (id: string, label: string): AnatomicSite => ({
  id,
  label,
  nodal: true,
  // Every nodal station shares one organ key: RECIST treats lymph nodes as a single
  // "organ" for the two-per-organ rule, however far apart the stations are.
  organ: 'lymphNode',
});

export const ANATOMIC_SITES: AnatomicSite[] = [
  nonNodal('lung', 'Lung'),
  nonNodal('liver', 'Liver'),
  nonNodal('brain', 'Brain'),
  nonNodal('bone', 'Bone'),
  nonNodal('adrenal', 'Adrenal gland'),
  nonNodal('kidney', 'Kidney'),
  nonNodal('pancreas', 'Pancreas'),
  nonNodal('spleen', 'Spleen'),
  nonNodal('peritoneum', 'Peritoneum'),
  nonNodal('pleura', 'Pleura'),
  nonNodal('softTissue', 'Soft tissue'),
  nonNodal('subcutaneous', 'Subcutaneous tissue'),
  nonNodal('muscle', 'Muscle'),
  nonNodal('breast', 'Breast'),
  nonNodal('ovary', 'Ovary'),
  nonNodal('uterus', 'Uterus'),
  nonNodal('prostate', 'Prostate'),
  nonNodal('bladder', 'Bladder'),
  nonNodal('stomach', 'Stomach'),
  nonNodal('smallBowel', 'Small bowel'),
  nonNodal('colon', 'Colon'),
  nonNodal('rectum', 'Rectum'),
  nonNodal('esophagus', 'Esophagus'),
  nonNodal('thyroid', 'Thyroid'),
  nonNodal('skin', 'Skin'),
  nonNodal('mediastinum', 'Mediastinum'),
  nonNodal('chestWall', 'Chest wall'),
  nonNodal('retroperitoneum', 'Retroperitoneum'),
  nonNodal('mesentery', 'Mesentery'),
  nonNodal('biliary', 'Gallbladder / biliary'),
  nonNodal('headNeck', 'Head and neck'),
  node('nodeCervical', 'Lymph node — cervical'),
  node('nodeMediastinal', 'Lymph node — mediastinal / hilar'),
  node('nodeAxillary', 'Lymph node — axillary'),
  node('nodeAbdominal', 'Lymph node — abdominal'),
  node('nodeRetroperitoneal', 'Lymph node — retroperitoneal'),
  node('nodePelvic', 'Lymph node — pelvic'),
  node('nodeInguinal', 'Lymph node — inguinal'),
];

const BY_ID = new Map(ANATOMIC_SITES.map(site => [site.id, site]));

export function findSite(id?: string): AnatomicSite | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/**
 * The measurement kind for a site, defaulting to non-nodal.
 *
 * Defaulting to non-nodal is the safe direction: it measures the longest diameter and
 * applies the 10 mm measurability floor. Defaulting to nodal would silently switch an
 * unknown site to short-axis measurement, which is wrong for every solid organ.
 */
export function kindForSite(id?: string): 'nodal' | 'nonNodal' {
  return findSite(id)?.nodal ? 'nodal' : 'nonNodal';
}

/** Organ key for the two-per-organ rule; falls back to the raw id. */
export function organForSite(id?: string): string {
  return findSite(id)?.organ ?? (id ?? '');
}

export const NODAL_SITES = ANATOMIC_SITES.filter(s => s.nodal);
export const NON_NODAL_SITES = ANATOMIC_SITES.filter(s => !s.nodal);
