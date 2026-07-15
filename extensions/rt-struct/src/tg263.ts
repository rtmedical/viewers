/**
 * TG-263 nomenclature core (RTV-213) — pure, dependency-free module backing the
 * Eclipse-style structure Properties dialog.
 *
 * Eclipse separates three concepts and so do we:
 *  (A) Volume Type   = DICOM RT ROI Interpreted Type (3006,00A4) defined term
 *                      → `RT_ROI_INTERPRETED_TYPES`.
 *  (B) Structure Code = an entry of a nomenclature dictionary (AAPM TG-263)
 *                      picked via type-ahead → `TG263_ENTRIES` + `searchTg263`.
 *                      Selecting a code cross-fills type, name and colour.
 *  (C) ROI Name       = free text, defaulted to the TG-263 Primary Name.
 *
 * The dictionary below is a curated subset of the AAPM TG-263 standard
 * nomenclature (targets, external/support and the major OARs, lateralised with
 * the TG-263 `_L`/`_R` suffix convention). Descriptions are English prose used
 * as a secondary type-ahead haystack (so "submandibular" finds Glnd_Submand_L
 * even though the primary name abbreviates it).
 *
 * RTV-114 hard rule: no @ohif/* import — keep this file pure.
 */

export type Tg263Category = 'target' | 'oar' | 'external' | 'support';

/**
 * DICOM RT ROI Interpreted Type (3006,00A4) defined terms — PS3.3 C.8.8.5/8.
 * This is the full "Volume Type" list the Properties dialog offers.
 */
export const RT_ROI_INTERPRETED_TYPES = [
  'EXTERNAL',
  'PTV',
  'CTV',
  'GTV',
  'TREATED_VOLUME',
  'IRRAD_VOLUME',
  'BOLUS',
  'AVOIDANCE',
  'ORGAN',
  'MARKER',
  'REGISTRATION',
  'ISOCENTER',
  'CONTRAST_AGENT',
  'CAVITY',
  'BRACHY_CHANNEL',
  'BRACHY_ACCESSORY',
  'BRACHY_SRC_APP',
  'BRACHY_CHNL_SHLD',
  'SUPPORT',
  'FIXATION',
  'DOSE_REGION',
  'CONTROL',
  'DOSE_MEASUREMENT',
  'NONE',
] as const;

export type RtRoiInterpretedType = (typeof RT_ROI_INTERPRETED_TYPES)[number];

export interface Tg263Entry {
  /** TG-263 Primary Name (CamelCase, `_L`/`_R` laterality suffix). */
  primaryName: string;
  /** English description — secondary type-ahead haystack. */
  description: string;
  category: Tg263Category;
  /** DICOM RT ROI Interpreted Type (3006,00A4) cross-filled on selection. */
  interpretedType: RtRoiInterpretedType;
  /** Conventional display colour (RGB 0-255) cross-filled on selection. */
  defaultColor?: [number, number, number];
}

// Conventional target colours (kept in sync with roiCategory badge palette).
const GTV_COLOR: [number, number, number] = [255, 0, 0];
const CTV_COLOR: [number, number, number] = [255, 165, 0];
const ITV_COLOR: [number, number, number] = [255, 215, 0];
const PTV_COLOR: [number, number, number] = [0, 128, 255];

/**
 * Curated AAPM TG-263 subset. Order matters: `searchTg263` is stable within
 * each ranking tier, so keep base structures before their derived (`_PRV`,
 * combined) forms and `_L` before `_R`.
 *
 * Note on targets: DICOM (3006,00A4) has no ITV/IGTV defined term — the motion
 * envelopes map onto the volume they wrap (ITV→CTV, IGTV→GTV), the common
 * Eclipse practice.
 */
export const TG263_ENTRIES: Tg263Entry[] = [
  // --- Targets -------------------------------------------------------------
  { primaryName: 'GTV', description: 'Gross tumor volume', category: 'target', interpretedType: 'GTV', defaultColor: GTV_COLOR },
  { primaryName: 'GTV_Primary', description: 'Gross tumor volume, primary lesion', category: 'target', interpretedType: 'GTV', defaultColor: GTV_COLOR },
  { primaryName: 'GTV_Node', description: 'Gross tumor volume, involved nodal disease', category: 'target', interpretedType: 'GTV', defaultColor: GTV_COLOR },
  { primaryName: 'GTV_Boost', description: 'Gross tumor volume, boost', category: 'target', interpretedType: 'GTV', defaultColor: GTV_COLOR },
  { primaryName: 'IGTV', description: 'Internal gross target volume (GTV motion envelope)', category: 'target', interpretedType: 'GTV', defaultColor: ITV_COLOR },
  { primaryName: 'CTV', description: 'Clinical target volume', category: 'target', interpretedType: 'CTV', defaultColor: CTV_COLOR },
  { primaryName: 'CTV_High', description: 'Clinical target volume, high-risk / high-dose', category: 'target', interpretedType: 'CTV', defaultColor: CTV_COLOR },
  { primaryName: 'CTV_Mid', description: 'Clinical target volume, intermediate-risk / mid-dose', category: 'target', interpretedType: 'CTV', defaultColor: CTV_COLOR },
  { primaryName: 'CTV_Low', description: 'Clinical target volume, low-risk / low-dose', category: 'target', interpretedType: 'CTV', defaultColor: CTV_COLOR },
  { primaryName: 'CTV_Node', description: 'Clinical target volume, elective nodal region', category: 'target', interpretedType: 'CTV', defaultColor: CTV_COLOR },
  { primaryName: 'CTV_Boost', description: 'Clinical target volume, boost', category: 'target', interpretedType: 'CTV', defaultColor: CTV_COLOR },
  { primaryName: 'ITV', description: 'Internal target volume (CTV motion envelope)', category: 'target', interpretedType: 'CTV', defaultColor: ITV_COLOR },
  { primaryName: 'PTV', description: 'Planning target volume', category: 'target', interpretedType: 'PTV', defaultColor: PTV_COLOR },
  { primaryName: 'PTV_High', description: 'Planning target volume, high-dose level', category: 'target', interpretedType: 'PTV', defaultColor: PTV_COLOR },
  { primaryName: 'PTV_Mid', description: 'Planning target volume, intermediate-dose level', category: 'target', interpretedType: 'PTV', defaultColor: PTV_COLOR },
  { primaryName: 'PTV_Low', description: 'Planning target volume, low-dose level', category: 'target', interpretedType: 'PTV', defaultColor: PTV_COLOR },
  { primaryName: 'PTV_Boost', description: 'Planning target volume, boost', category: 'target', interpretedType: 'PTV', defaultColor: PTV_COLOR },

  // --- External / patient outline -----------------------------------------
  { primaryName: 'External', description: 'External patient contour (body outline)', category: 'external', interpretedType: 'EXTERNAL', defaultColor: [0, 255, 0] },
  { primaryName: 'Body', description: 'Body / external patient outline (Eclipse convention)', category: 'external', interpretedType: 'EXTERNAL', defaultColor: [0, 255, 0] },

  // --- Support / accessories ------------------------------------------------
  { primaryName: 'Couch', description: 'Treatment couch (patient support)', category: 'support', interpretedType: 'SUPPORT', defaultColor: [128, 128, 128] },
  { primaryName: 'CouchSurface', description: 'Treatment couch, outer surface shell', category: 'support', interpretedType: 'SUPPORT', defaultColor: [160, 160, 160] },
  { primaryName: 'CouchInterior', description: 'Treatment couch, interior (low-density core)', category: 'support', interpretedType: 'SUPPORT', defaultColor: [96, 96, 96] },
  { primaryName: 'Bolus', description: 'Bolus (tissue-equivalent build-up material)', category: 'support', interpretedType: 'BOLUS', defaultColor: [0, 255, 255] },

  // --- OARs: CNS / head -----------------------------------------------------
  { primaryName: 'Brain', description: 'Whole brain', category: 'oar', interpretedType: 'ORGAN', defaultColor: [180, 130, 200] },
  { primaryName: 'Brainstem', description: 'Brainstem', category: 'oar', interpretedType: 'ORGAN', defaultColor: [0, 200, 100] },
  { primaryName: 'Brainstem_PRV', description: 'Brainstem planning risk volume (PRV margin)', category: 'oar', interpretedType: 'AVOIDANCE' },
  { primaryName: 'SpinalCord', description: 'Spinal cord', category: 'oar', interpretedType: 'ORGAN', defaultColor: [255, 255, 0] },
  { primaryName: 'SpinalCord_PRV', description: 'Spinal cord planning risk volume (PRV margin)', category: 'oar', interpretedType: 'AVOIDANCE', defaultColor: [255, 200, 0] },
  { primaryName: 'SpinalCanal', description: 'Spinal canal (thecal sac including the cord)', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'CaudaEquina', description: 'Cauda equina (terminal spinal nerve roots)', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'OpticChiasm', description: 'Optic chiasm', category: 'oar', interpretedType: 'ORGAN', defaultColor: [255, 0, 255] },
  { primaryName: 'OpticChiasm_PRV', description: 'Optic chiasm planning risk volume (PRV margin)', category: 'oar', interpretedType: 'AVOIDANCE' },
  { primaryName: 'OpticNrv_L', description: 'Left optic nerve', category: 'oar', interpretedType: 'ORGAN', defaultColor: [255, 128, 255] },
  { primaryName: 'OpticNrv_R', description: 'Right optic nerve', category: 'oar', interpretedType: 'ORGAN', defaultColor: [255, 128, 255] },
  { primaryName: 'Eye_L', description: 'Left eye (globe)', category: 'oar', interpretedType: 'ORGAN', defaultColor: [0, 170, 255] },
  { primaryName: 'Eye_R', description: 'Right eye (globe)', category: 'oar', interpretedType: 'ORGAN', defaultColor: [0, 170, 255] },
  { primaryName: 'Lens_L', description: 'Left lens of the eye', category: 'oar', interpretedType: 'ORGAN', defaultColor: [120, 220, 255] },
  { primaryName: 'Lens_R', description: 'Right lens of the eye', category: 'oar', interpretedType: 'ORGAN', defaultColor: [120, 220, 255] },
  { primaryName: 'Retina_L', description: 'Left retina', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Retina_R', description: 'Right retina', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Cochlea_L', description: 'Left cochlea (inner ear)', category: 'oar', interpretedType: 'ORGAN', defaultColor: [200, 120, 60] },
  { primaryName: 'Cochlea_R', description: 'Right cochlea (inner ear)', category: 'oar', interpretedType: 'ORGAN', defaultColor: [200, 120, 60] },
  { primaryName: 'Pituitary', description: 'Pituitary gland (hypophysis)', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Hippocampus_L', description: 'Left hippocampus', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Hippocampus_R', description: 'Right hippocampus', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Glnd_Lacrimal_L', description: 'Left lacrimal gland', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Glnd_Lacrimal_R', description: 'Right lacrimal gland', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Cerebellum', description: 'Cerebellum', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Lobe_Temporal_L', description: 'Left temporal lobe of the brain', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Lobe_Temporal_R', description: 'Right temporal lobe of the brain', category: 'oar', interpretedType: 'ORGAN' },

  // --- OARs: head & neck ----------------------------------------------------
  { primaryName: 'Parotid_L', description: 'Left parotid gland', category: 'oar', interpretedType: 'ORGAN', defaultColor: [0, 200, 200] },
  { primaryName: 'Parotid_R', description: 'Right parotid gland', category: 'oar', interpretedType: 'ORGAN', defaultColor: [0, 200, 200] },
  { primaryName: 'Parotids', description: 'Parotid glands, combined left + right', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Glnd_Submand_L', description: 'Left submandibular gland', category: 'oar', interpretedType: 'ORGAN', defaultColor: [80, 200, 160] },
  { primaryName: 'Glnd_Submand_R', description: 'Right submandibular gland', category: 'oar', interpretedType: 'ORGAN', defaultColor: [80, 200, 160] },
  { primaryName: 'Larynx', description: 'Larynx (voice box)', category: 'oar', interpretedType: 'ORGAN', defaultColor: [230, 160, 60] },
  { primaryName: 'Glottis', description: 'Glottic larynx (vocal cords region)', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Pharynx', description: 'Pharynx', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Musc_Constrict', description: 'Pharyngeal constrictor muscles', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Lips', description: 'Lips', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'OralCavity', description: 'Oral cavity', category: 'oar', interpretedType: 'ORGAN', defaultColor: [220, 120, 120] },
  { primaryName: 'Mandible', description: 'Mandible (lower jaw bone)', category: 'oar', interpretedType: 'ORGAN', defaultColor: [220, 220, 180] },
  { primaryName: 'Thyroid', description: 'Thyroid gland', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Esophagus', description: 'Esophagus', category: 'oar', interpretedType: 'ORGAN', defaultColor: [160, 90, 40] },
  { primaryName: 'Trachea', description: 'Trachea', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Bronchus', description: 'Bronchus (main stem airways)', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Bronchus_Prox', description: 'Proximal bronchial tree', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'BrachialPlex_L', description: 'Left brachial plexus', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'BrachialPlex_R', description: 'Right brachial plexus', category: 'oar', interpretedType: 'ORGAN' },

  // --- OARs: thorax -----------------------------------------------------------
  { primaryName: 'Lung_L', description: 'Left lung', category: 'oar', interpretedType: 'ORGAN', defaultColor: [100, 180, 255] },
  { primaryName: 'Lung_R', description: 'Right lung', category: 'oar', interpretedType: 'ORGAN', defaultColor: [100, 180, 255] },
  { primaryName: 'Lungs', description: 'Lungs, combined left + right', category: 'oar', interpretedType: 'ORGAN', defaultColor: [70, 150, 240] },
  { primaryName: 'Heart', description: 'Heart (whole organ)', category: 'oar', interpretedType: 'ORGAN', defaultColor: [220, 40, 60] },
  { primaryName: 'Pericardium', description: 'Pericardium (heart sac)', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'A_LAD', description: 'Left anterior descending coronary artery', category: 'oar', interpretedType: 'ORGAN', defaultColor: [255, 80, 80] },
  { primaryName: 'A_Aorta', description: 'Aorta (artery)', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'A_Carotid_L', description: 'Left carotid artery', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'A_Carotid_R', description: 'Right carotid artery', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'V_Venacava_S', description: 'Superior vena cava (vein)', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'GreatVes', description: 'Great vessels of the mediastinum', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Breast_L', description: 'Left breast', category: 'oar', interpretedType: 'ORGAN', defaultColor: [255, 170, 190] },
  { primaryName: 'Breast_R', description: 'Right breast', category: 'oar', interpretedType: 'ORGAN', defaultColor: [255, 170, 190] },
  { primaryName: 'Chestwall_L', description: 'Left chest wall', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Chestwall_R', description: 'Right chest wall', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Humerus_Head_L', description: 'Left humeral head', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Humerus_Head_R', description: 'Right humeral head', category: 'oar', interpretedType: 'ORGAN' },

  // --- OARs: abdomen -----------------------------------------------------------
  { primaryName: 'Liver', description: 'Liver', category: 'oar', interpretedType: 'ORGAN', defaultColor: [180, 100, 40] },
  { primaryName: 'Stomach', description: 'Stomach', category: 'oar', interpretedType: 'ORGAN', defaultColor: [230, 190, 80] },
  { primaryName: 'Spleen', description: 'Spleen', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Gallbladder', description: 'Gallbladder', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Kidney_L', description: 'Left kidney', category: 'oar', interpretedType: 'ORGAN', defaultColor: [140, 80, 200] },
  { primaryName: 'Kidney_R', description: 'Right kidney', category: 'oar', interpretedType: 'ORGAN', defaultColor: [140, 80, 200] },
  { primaryName: 'Kidneys', description: 'Kidneys, combined left + right', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Duodenum', description: 'Duodenum', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Pancreas', description: 'Pancreas', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Bowel', description: 'Bowel (undifferentiated intestine)', category: 'oar', interpretedType: 'ORGAN', defaultColor: [200, 160, 90] },
  { primaryName: 'Bowel_Small', description: 'Small bowel (small intestine)', category: 'oar', interpretedType: 'ORGAN', defaultColor: [210, 170, 100] },
  { primaryName: 'Bowel_Large', description: 'Large bowel (large intestine)', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Bag_Bowel', description: 'Bowel bag (peritoneal cavity envelope)', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Colon', description: 'Colon', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Colon_Sigmoid', description: 'Sigmoid colon', category: 'oar', interpretedType: 'ORGAN' },

  // --- OARs: pelvis -----------------------------------------------------------
  { primaryName: 'Rectum', description: 'Rectum', category: 'oar', interpretedType: 'ORGAN', defaultColor: [140, 90, 50] },
  { primaryName: 'Bladder', description: 'Urinary bladder', category: 'oar', interpretedType: 'ORGAN', defaultColor: [255, 220, 60] },
  { primaryName: 'Prostate', description: 'Prostate gland', category: 'oar', interpretedType: 'ORGAN', defaultColor: [110, 190, 130] },
  { primaryName: 'SeminalVes', description: 'Seminal vesicles', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'PenileBulb', description: 'Penile bulb', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Urethra', description: 'Urethra', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Uterus', description: 'Uterus', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Cervix', description: 'Uterine cervix', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Vagina', description: 'Vagina', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Ovary_L', description: 'Left ovary', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Ovary_R', description: 'Right ovary', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Femur_Head_L', description: 'Left femoral head (hip)', category: 'oar', interpretedType: 'ORGAN', defaultColor: [200, 200, 140] },
  { primaryName: 'Femur_Head_R', description: 'Right femoral head (hip)', category: 'oar', interpretedType: 'ORGAN', defaultColor: [200, 200, 140] },
  { primaryName: 'Sacrum', description: 'Sacrum (bone)', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'Bone_Pelvic', description: 'Pelvic bones', category: 'oar', interpretedType: 'ORGAN' },
  { primaryName: 'BoneMarrow', description: 'Bone marrow (hematopoietic)', category: 'oar', interpretedType: 'ORGAN' },

  // --- OARs: other -----------------------------------------------------------
  { primaryName: 'Skin', description: 'Skin (dermal rind)', category: 'oar', interpretedType: 'ORGAN' },
];

/**
 * Coarse fallback Volume Type for a dictionary category — used when a category
 * is known but no specific TG-263 entry was selected. Individual entries carry
 * their own precise `interpretedType`, which always wins.
 */
export function interpretedTypeForCategory(category: Tg263Category): RtRoiInterpretedType {
  switch (category) {
    case 'target':
      return 'PTV';
    case 'external':
      return 'EXTERNAL';
    case 'support':
      return 'SUPPORT';
    case 'oar':
    default:
      return 'ORGAN';
  }
}

/**
 * Case-insensitive type-ahead over the TG-263 dictionary.
 * Ranking tiers (stable — dictionary order preserved within a tier):
 *   1. primaryName prefix match
 *   2. primaryName substring match
 *   3. description substring match
 * Empty / whitespace-only queries return no results.
 */
export function searchTg263(query: string, limit = 12): Tg263Entry[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) {
    return [];
  }
  const prefix: Tg263Entry[] = [];
  const substring: Tg263Entry[] = [];
  const description: Tg263Entry[] = [];
  for (const entry of TG263_ENTRIES) {
    const name = entry.primaryName.toLowerCase();
    if (name.startsWith(q)) {
      prefix.push(entry);
    } else if (name.includes(q)) {
      substring.push(entry);
    } else if (entry.description.toLowerCase().includes(q)) {
      description.push(entry);
    }
  }
  return [...prefix, ...substring, ...description].slice(0, Math.max(0, limit));
}
