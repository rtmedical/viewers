import {
  KEY_OBJECT_SELECTION_SOP_CLASS_UID,
  KOS_DOCUMENT_TITLES,
  DEFAULT_KOS_TITLE,
  buildKosDescriptor,
} from './kos';
import { KeyImageReference } from './types';

const ref = (over: Partial<KeyImageReference> = {}): KeyImageReference => ({
  StudyInstanceUID: 'ST1',
  SeriesInstanceUID: 'SE1',
  SOPInstanceUID: 'OB1',
  ...over,
});

describe('KOS constants', () => {
  it('exposes the standard KOS SOP Class UID', () => {
    expect(KEY_OBJECT_SELECTION_SOP_CLASS_UID).toBe('1.2.840.10008.5.1.4.1.1.88.59');
  });

  it('defaults to the "Of Interest" (113000, DCM) title', () => {
    expect(DEFAULT_KOS_TITLE).toEqual({
      CodeValue: '113000',
      CodingSchemeDesignator: 'DCM',
      CodeMeaning: 'Of Interest',
    });
  });

  it('all titles are well-formed and use the DCM scheme with unique codes', () => {
    const values = Object.values(KOS_DOCUMENT_TITLES);
    for (const t of values) {
      expect(t.CodingSchemeDesignator).toBe('DCM');
      expect(t.CodeValue).toMatch(/^\d+$/);
      expect(t.CodeMeaning.length).toBeGreaterThan(0);
    }
    const codes = values.map(t => t.CodeValue);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('buildKosDescriptor', () => {
  it('throws on an empty selection', () => {
    expect(() => buildKosDescriptor([])).toThrow(/at least one/);
    // @ts-expect-error invalid input
    expect(() => buildKosDescriptor(null)).toThrow();
  });

  it('uses the default title and standard SOP class', () => {
    const d = buildKosDescriptor([ref()]);
    expect(d.sopClassUID).toBe(KEY_OBJECT_SELECTION_SOP_CLASS_UID);
    expect(d.title).toEqual(DEFAULT_KOS_TITLE);
  });

  it('honors an explicit title and description', () => {
    const d = buildKosDescriptor([ref()], {
      title: KOS_DOCUMENT_TITLES.FOR_TEACHING,
      seriesDescription: 'Teaching file',
    });
    expect(d.title).toEqual(KOS_DOCUMENT_TITLES.FOR_TEACHING);
    expect(d.seriesDescription).toBe('Teaching file');
  });

  it('de-duplicates by canonical id, preserving first-seen order', () => {
    const d = buildKosDescriptor([
      ref({ SOPInstanceUID: 'A' }),
      ref({ SOPInstanceUID: 'B' }),
      ref({ SOPInstanceUID: 'A' }), // dup
    ]);
    expect(d.references.map(r => r.SOPInstanceUID)).toEqual(['A', 'B']);
  });

  it('groups Study -> Series -> SOP Instance across multiple studies', () => {
    const d = buildKosDescriptor([
      ref({ StudyInstanceUID: 'ST1', SeriesInstanceUID: 'SE1', SOPInstanceUID: 'A' }),
      ref({ StudyInstanceUID: 'ST1', SeriesInstanceUID: 'SE2', SOPInstanceUID: 'B' }),
      ref({ StudyInstanceUID: 'ST2', SeriesInstanceUID: 'SE3', SOPInstanceUID: 'C' }),
    ]);
    expect(d.evidence.map(e => e.StudyInstanceUID)).toEqual(['ST1', 'ST2']);
    expect(d.evidence[0].series.map(s => s.SeriesInstanceUID)).toEqual(['SE1', 'SE2']);
    expect(d.evidence[1].series[0].sopInstances[0].SOPInstanceUID).toBe('C');
  });

  it('aggregates frame numbers (sorted, unique) per multiframe instance', () => {
    const d = buildKosDescriptor([
      ref({ SOPInstanceUID: 'MF', frameNumber: 3 }),
      ref({ SOPInstanceUID: 'MF', frameNumber: 1 }),
      ref({ SOPInstanceUID: 'MF', frameNumber: 3 }), // dup frame
    ]);
    const inst = d.evidence[0].series[0].sopInstances[0];
    expect(inst.SOPInstanceUID).toBe('MF');
    expect(inst.frames).toEqual([1, 3]);
  });

  it('omits frames for single-frame instances', () => {
    const d = buildKosDescriptor([ref()]);
    expect(d.evidence[0].series[0].sopInstances[0].frames).toBeUndefined();
  });
});
