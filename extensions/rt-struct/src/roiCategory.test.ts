import {
  categorizeRoi,
  roiBadgeColor,
  contrastText,
  roiTypeLabel,
  categoryLabel,
  ROI_CATEGORY_ORDER,
} from './roiCategory';

describe('categorizeRoi', () => {
  it('classifies external/body/skin contours as external', () => {
    expect(categorizeRoi('BODY')).toMatchObject({ category: 'external', type: 'External' });
    expect(categorizeRoi('External')).toMatchObject({ category: 'external', type: 'External' });
    expect(categorizeRoi('Skin')).toMatchObject({ category: 'external', type: 'External' });
    expect(categorizeRoi('Patient_Outline')).toMatchObject({ category: 'external' });
  });

  it('classifies immobilisation / setup hardware as support', () => {
    expect(categorizeRoi('Couch')).toMatchObject({ category: 'external', type: 'Support' });
    expect(categorizeRoi('CouchSurface')).toMatchObject({ type: 'Support' });
    expect(categorizeRoi('Bolus 5mm')).toMatchObject({ type: 'Support' });
    expect(categorizeRoi('Fiducial_1')).toMatchObject({ type: 'Support' });
  });

  it('classifies target sub-types, matching the most specific first', () => {
    expect(categorizeRoi('GTV')).toMatchObject({ category: 'target', type: 'GTV' });
    expect(categorizeRoi('CTV_54')).toMatchObject({ category: 'target', type: 'CTV' });
    expect(categorizeRoi('PTV High')).toMatchObject({ category: 'target', type: 'PTV' });
    // IGTV contains GTV — must match IGTV, not GTV.
    expect(categorizeRoi('IGTV')).toMatchObject({ type: 'IGTV' });
    expect(categorizeRoi('ITV_boost')).toMatchObject({ type: 'ITV' });
  });

  it('tolerates glued clinical target names', () => {
    expect(categorizeRoi('PTVboost')).toMatchObject({ category: 'target', type: 'PTV' });
    expect(categorizeRoi('CTVn')).toMatchObject({ category: 'target', type: 'CTV' });
  });

  it('falls back to organ-at-risk', () => {
    expect(categorizeRoi('Spinal Cord')).toMatchObject({ category: 'oar', type: 'Organ' });
    expect(categorizeRoi('Heart')).toMatchObject({ category: 'oar', type: 'Organ' });
    expect(categorizeRoi('L Lung')).toMatchObject({ category: 'oar' });
  });

  it('consults the code when the name hides the type', () => {
    expect(categorizeRoi('Zone_A', 'PTV')).toMatchObject({ category: 'target', type: 'PTV' });
    expect(categorizeRoi('Alias', 'EXTERNAL')).toMatchObject({ category: 'external' });
  });

  it('does not misclassify embedded runs (ANTIBODY is not BODY)', () => {
    expect(categorizeRoi('Antibody region').category).toBe('oar');
  });

  it('handles empty / undefined input', () => {
    expect(categorizeRoi('')).toMatchObject({ category: 'oar', type: 'Organ' });
    expect(categorizeRoi(undefined as any)).toMatchObject({ category: 'oar' });
  });
});

describe('roiBadgeColor', () => {
  it('uses fixed conventional colours for targets', () => {
    expect(roiBadgeColor({ category: 'target', type: 'GTV' }, [10, 20, 30])).toBe('#A2191F');
    expect(roiBadgeColor({ category: 'target', type: 'PTV' }, [0, 0, 0])).toBe('#198038');
  });

  it('tints organs/external from the ROI display colour', () => {
    expect(roiBadgeColor({ category: 'oar', type: 'Organ' }, [12, 34, 56])).toBe('rgb(12, 34, 56)');
  });
});

describe('contrastText', () => {
  it('picks dark text on light backgrounds and vice-versa', () => {
    expect(contrastText([255, 255, 255])).toBe('#161616');
    expect(contrastText([0, 0, 0])).toBe('#ffffff');
  });
});

describe('labels + ordering', () => {
  it('renders type labels', () => {
    expect(roiTypeLabel({ category: 'target', type: 'PTV' })).toBe('PTV');
    expect(roiTypeLabel({ category: 'oar', type: 'Organ' })).toBe('Organ');
    expect(roiTypeLabel({ category: 'external', type: 'Support' })).toBe('Support');
    expect(roiTypeLabel({ category: 'external', type: 'External' })).toBe('External');
  });

  it('orders targets first, then OARs, then external', () => {
    expect(ROI_CATEGORY_ORDER).toEqual(['target', 'oar', 'external']);
    expect(categoryLabel('target')).toBeTruthy();
    expect(categoryLabel('oar')).toBeTruthy();
    expect(categoryLabel('external')).toBeTruthy();
  });
});
