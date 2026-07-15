import {
  TG263_ENTRIES,
  RT_ROI_INTERPRETED_TYPES,
  searchTg263,
  interpretedTypeForCategory,
  Tg263Entry,
} from './tg263';

const names = TG263_ENTRIES.map(e => e.primaryName);

describe('TG263_ENTRIES dictionary', () => {
  it('is a curated subset of at least 100 entries', () => {
    expect(TG263_ENTRIES.length).toBeGreaterThanOrEqual(100);
  });

  it('has unique primary names', () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it('uses TG-263 safe characters only (letters, digits, underscore)', () => {
    names.forEach(name => {
      expect(name).toMatch(/^[A-Za-z0-9_]+$/);
    });
  });

  it('never starts or ends a name with an underscore except laterality/level suffixes', () => {
    names.forEach(name => {
      expect(name.startsWith('_')).toBe(false);
      expect(name.endsWith('_')).toBe(false);
    });
  });

  it('has a complete lateral pair for every _L / _R structure', () => {
    const set = new Set(names);
    names.forEach(name => {
      if (name.endsWith('_L')) {
        expect(set.has(`${name.slice(0, -2)}_R`)).toBe(true);
      }
      if (name.endsWith('_R')) {
        expect(set.has(`${name.slice(0, -2)}_L`)).toBe(true);
      }
    });
  });

  it('contains the core target volumes and dose-level variants', () => {
    ['GTV', 'GTV_Primary', 'CTV', 'CTV_High', 'ITV', 'PTV', 'PTV_Low', 'PTV_High'].forEach(n =>
      expect(names).toContain(n)
    );
  });

  it('contains external, couch/support and bolus entries', () => {
    ['External', 'Body', 'Couch', 'CouchSurface', 'CouchInterior', 'Bolus'].forEach(n =>
      expect(names).toContain(n)
    );
  });

  it('contains the major lateralized and midline OARs', () => {
    [
      'Parotid_L',
      'Parotid_R',
      'Glnd_Submand_L',
      'Glnd_Submand_R',
      'SpinalCord',
      'SpinalCord_PRV',
      'Brainstem',
      'Brain',
      'OpticNrv_L',
      'OpticNrv_R',
      'OpticChiasm',
      'Eye_L',
      'Lens_R',
      'Cochlea_L',
      'Larynx',
      'Esophagus',
      'Thyroid',
      'Lung_L',
      'Lung_R',
      'Lungs',
      'Heart',
      'A_LAD',
      'Breast_L',
      'Breast_R',
      'Liver',
      'Stomach',
      'Spleen',
      'Kidney_L',
      'Kidney_R',
      'Bowel',
      'Bowel_Small',
      'Colon',
      'Rectum',
      'Bladder',
      'Prostate',
      'SeminalVes',
      'PenileBulb',
      'Femur_Head_L',
      'Femur_Head_R',
      'Duodenum',
      'Pancreas',
      'Trachea',
      'BrachialPlex_L',
      'BrachialPlex_R',
      'Chestwall_L',
      'Chestwall_R',
      'CaudaEquina',
      'Sacrum',
      'BoneMarrow',
      'Musc_Constrict',
      'Lips',
      'OralCavity',
      'Mandible',
    ].forEach(n => expect(names).toContain(n));
  });

  it('only uses valid categories and DICOM interpreted types', () => {
    const categories = new Set(['target', 'oar', 'external', 'support']);
    TG263_ENTRIES.forEach(e => {
      expect(categories.has(e.category)).toBe(true);
      expect(RT_ROI_INTERPRETED_TYPES).toContain(e.interpretedType);
    });
  });

  it('assigns category-consistent interpreted types', () => {
    TG263_ENTRIES.forEach(e => {
      switch (e.category) {
        case 'target':
          expect(['GTV', 'CTV', 'PTV']).toContain(e.interpretedType);
          break;
        case 'external':
          expect(e.interpretedType).toBe('EXTERNAL');
          break;
        case 'support':
          expect(['SUPPORT', 'BOLUS', 'FIXATION', 'MARKER']).toContain(e.interpretedType);
          break;
        case 'oar':
        default:
          expect(['ORGAN', 'AVOIDANCE']).toContain(e.interpretedType);
          break;
      }
    });
  });

  it('PRV structures are AVOIDANCE volumes', () => {
    TG263_ENTRIES.filter(e => e.primaryName.includes('_PRV')).forEach(e => {
      expect(e.interpretedType).toBe('AVOIDANCE');
    });
  });

  it('default colors, when present, are valid RGB triplets', () => {
    TG263_ENTRIES.filter(e => e.defaultColor).forEach(e => {
      expect(e.defaultColor).toHaveLength(3);
      e.defaultColor!.forEach(v => {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      });
    });
  });
});

describe('RT_ROI_INTERPRETED_TYPES (DICOM 3006,00A4 defined terms)', () => {
  it('is the complete defined-term list', () => {
    const expected = [
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
    ];
    expect([...RT_ROI_INTERPRETED_TYPES]).toEqual(expected);
    expect(new Set(RT_ROI_INTERPRETED_TYPES).size).toBe(24);
  });
});

describe('interpretedTypeForCategory', () => {
  it('maps every dictionary category to a coarse DICOM type', () => {
    expect(interpretedTypeForCategory('target')).toBe('PTV');
    expect(interpretedTypeForCategory('oar')).toBe('ORGAN');
    expect(interpretedTypeForCategory('external')).toBe('EXTERNAL');
    expect(interpretedTypeForCategory('support')).toBe('SUPPORT');
  });
});

describe('searchTg263 type-ahead', () => {
  const resultNames = (q: string, limit?: number) =>
    (limit == null ? searchTg263(q) : searchTg263(q, limit)).map((e: Tg263Entry) => e.primaryName);

  it('returns nothing for empty or whitespace queries', () => {
    expect(searchTg263('')).toEqual([]);
    expect(searchTg263('   ')).toEqual([]);
    expect(searchTg263(undefined as unknown as string)).toEqual([]);
  });

  it("ranks 'paro' with the lateral parotids first (prefix tier)", () => {
    const r = resultNames('paro');
    expect(r.slice(0, 2)).toEqual(['Parotid_L', 'Parotid_R']);
    expect(r).toContain('Parotids');
  });

  it('is case-insensitive', () => {
    expect(resultNames('PARO')).toEqual(resultNames('paro'));
    expect(resultNames('Paro')).toEqual(resultNames('paro'));
  });

  it("finds 'cord' inside SpinalCord before description hits (substring tier)", () => {
    const r = resultNames('cord');
    expect(r[0]).toBe('SpinalCord');
    expect(r[1]).toBe('SpinalCord_PRV');
    // description tier follows ('Spinal canal ... including the cord')
    expect(r).toContain('SpinalCanal');
    expect(r.indexOf('SpinalCanal')).toBeGreaterThan(r.indexOf('SpinalCord_PRV'));
  });

  it('matches descriptions when the name abbreviates the anatomy', () => {
    const r = resultNames('submandibular');
    expect(r.slice(0, 2)).toEqual(['Glnd_Submand_L', 'Glnd_Submand_R']);
  });

  it("finds targets by description ('gross tumor' → GTV family)", () => {
    const r = resultNames('gross tumor');
    expect(r[0]).toBe('GTV');
    expect(r).toContain('GTV_Primary');
  });

  it('keeps prefix matches ahead of everything for lungs', () => {
    const r = resultNames('lung');
    expect(r.slice(0, 3)).toEqual(['Lung_L', 'Lung_R', 'Lungs']);
  });

  it('lists base structures before derived forms (stable dictionary order)', () => {
    const r = resultNames('optic');
    expect(r.indexOf('OpticChiasm')).toBeLessThan(r.indexOf('OpticChiasm_PRV'));
  });

  it('caps results at the default limit of 12', () => {
    expect(searchTg263('a').length).toBeLessThanOrEqual(12);
  });

  it('honors a custom limit', () => {
    expect(searchTg263('a', 3)).toHaveLength(3);
    expect(searchTg263('paro', 1).map(e => e.primaryName)).toEqual(['Parotid_L']);
  });

  it('exact primary-name queries rank the exact entry first', () => {
    expect(resultNames('parotid_l')[0]).toBe('Parotid_L');
    expect(resultNames('PTV')[0]).toBe('PTV');
    expect(resultNames('external')[0]).toBe('External');
  });
});
