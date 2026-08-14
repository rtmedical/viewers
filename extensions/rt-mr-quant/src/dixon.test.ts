import {
  classifyDixonSeries,
  detectDixonSet,
  DIXON_HANGING_ORDER,
  namesDixonTechnique,
  tokenize,
} from './dixon';

describe('tokenize', () => {
  it('splits on the DICOM multi-value separator', () => {
    expect(tokenize('DERIVED\\PRIMARY\\W')).toEqual(['DERIVED', 'PRIMARY', 'W']);
  });

  it('accepts an already-split ImageType array', () => {
    expect(tokenize(['DERIVED', 'PRIMARY', 'FAT'])).toEqual(['DERIVED', 'PRIMARY', 'FAT']);
  });

  it('splits the separators vendors use inside a description', () => {
    expect(tokenize('T1_VIBE-FAT.ONLY/AX')).toEqual(['T1', 'VIBE', 'FAT', 'ONLY', 'AX']);
  });

  it('upper-cases and drops empty pieces', () => {
    expect(tokenize('  mDixon__w  ')).toEqual(['MDIXON', 'W']);
  });

  it('returns empty for absent values', () => {
    expect(tokenize(undefined)).toEqual([]);
    expect(tokenize('')).toEqual([]);
  });
});

describe('classifyDixonSeries — unambiguous spellings', () => {
  const cases: Array<[string, string, ReturnType<typeof classifyDixonSeries>]> = [
    ['water only', 'T1 Dixon WATER', 'water'],
    ['fat only', 'T1 Dixon FAT', 'fat'],
    ['water spelled out', 'AX T2 WATER_ONLY', 'water'],
    ['fat spelled out', 'AX T2 FAT_ONLY', 'fat'],
    ['in-phase joined', 'T1 INPHASE', 'inPhase'],
    ['in phase split', 'T1 IN PHASE', 'inPhase'],
    ['out of phase', 'T1 OUT OF PHASE', 'outPhase'],
    ['opposed phase', 'T1 OPPOSED PHASE', 'outPhase'],
  ];

  it.each(cases)('%s', (_label, description, expected) => {
    expect(classifyDixonSeries({ Modality: 'MR', SeriesDescription: description })).toBe(expected);
  });

  it('reads the component out of ImageType', () => {
    expect(
      classifyDixonSeries({ Modality: 'MR', ImageType: 'ORIGINAL\\PRIMARY\\M\\WATER' })
    ).toBe('water');
  });

  it('prefers ImageType over a conflicting description', () => {
    expect(
      classifyDixonSeries({
        Modality: 'MR',
        ImageType: ['DERIVED', 'PRIMARY', 'WATER'],
        SeriesDescription: 'T1 Dixon FAT',
      })
    ).toBe('water');
  });

  it('resolves out-of-phase before in-phase (OUT_PHASE must not read as IN)', () => {
    expect(classifyDixonSeries({ Modality: 'MR', ImageType: 'DERIVED\\OUT_PHASE' })).toBe('outPhase');
  });
});

describe('classifyDixonSeries — fat-saturation is not fat-only', () => {
  it.each(['T2 TSE FS', 'STIR fatsat cor', 'T1 SPAIR abdomen', 'T2 SPIR', 'CHESS T1'])(
    'does not classify %s',
    description => {
      expect(classifyDixonSeries({ Modality: 'MR', SeriesDescription: description })).toBeNull();
    }
  );

  it('vetoes fat when the description reveals a fat-saturated sequence', () => {
    expect(classifyDixonSeries({ Modality: 'MR', SeriesDescription: 'T1 FS FAT' })).toBeNull();
  });

  it('vetoes even when ImageType claims FAT but the description says FS', () => {
    expect(
      classifyDixonSeries({
        Modality: 'MR',
        ImageType: 'DERIVED\\PRIMARY\\FAT',
        SeriesDescription: 'T2 TSE FS',
      })
    ).toBeNull();
  });

  it('still allows a real Dixon fat series', () => {
    expect(classifyDixonSeries({ Modality: 'MR', SeriesDescription: 'mDIXON FAT' })).toBe('fat');
  });
});

describe('classifyDixonSeries — ambiguous abbreviations need a technique marker', () => {
  it('does not read T1-weighting as water', () => {
    expect(classifyDixonSeries({ Modality: 'MR', SeriesDescription: 'AX T1 W' })).toBeNull();
    expect(classifyDixonSeries({ Modality: 'MR', SeriesDescription: 'T2_W_TSE' })).toBeNull();
  });

  it('reads a bare W as water once the technique is named', () => {
    expect(classifyDixonSeries({ Modality: 'MR', SeriesDescription: 'mDIXON W' })).toBe('water');
    expect(classifyDixonSeries({ Modality: 'MR', SeriesDescription: 'IDEAL F' })).toBe('fat');
  });

  it('licenses the abbreviation when the technique is in the other field', () => {
    expect(
      classifyDixonSeries({
        Modality: 'MR',
        ImageType: 'DERIVED\\PRIMARY\\W',
        SeriesDescription: 'AX T1 mDIXON',
      })
    ).toBe('water');
  });

  it('reads IP / OP only with the technique named', () => {
    expect(classifyDixonSeries({ Modality: 'MR', SeriesDescription: 'LAVA IP' })).toBeNull();
    expect(classifyDixonSeries({ Modality: 'MR', SeriesDescription: 'LAVAFLEX IP' })).toBe('inPhase');
    expect(classifyDixonSeries({ Modality: 'MR', SeriesDescription: 'mDIXON OP' })).toBe('outPhase');
    expect(classifyDixonSeries({ Modality: 'MR', SeriesDescription: 'DIXON OPP' })).toBe('outPhase');
  });

  it('never matches a substring inside a longer word', () => {
    expect(classifyDixonSeries({ Modality: 'MR', SeriesDescription: 'WATERFALL protocol' })).toBeNull();
    expect(classifyDixonSeries({ Modality: 'MR', SeriesDescription: 'OUTER ear' })).toBeNull();
  });
});

describe('classifyDixonSeries — guards', () => {
  it('ignores non-MR modalities', () => {
    expect(classifyDixonSeries({ Modality: 'CT', SeriesDescription: 'IN PHASE' })).toBeNull();
    expect(classifyDixonSeries({ Modality: 'RTIMAGE', SeriesDescription: 'WATER' })).toBeNull();
  });

  it('tolerates absent Modality (metadata is often partial)', () => {
    expect(classifyDixonSeries({ SeriesDescription: 'T1 Dixon WATER' })).toBe('water');
  });

  it('handles empty and malformed input', () => {
    expect(classifyDixonSeries({} as never)).toBeNull();
    expect(classifyDixonSeries(undefined as never)).toBeNull();
    expect(classifyDixonSeries({ Modality: 'MR' })).toBeNull();
  });
});

describe('namesDixonTechnique', () => {
  it('recognises the vendor names', () => {
    expect(namesDixonTechnique(['T1', 'MDIXON'])).toBe(true);
    expect(namesDixonTechnique(['IDEAL'])).toBe(true);
    expect(namesDixonTechnique(['T1', 'TSE'])).toBe(false);
  });
});

describe('detectDixonSet', () => {
  const series = (SeriesNumber: number, SeriesDescription: string) => ({
    Modality: 'MR',
    SeriesInstanceUID: `uid-${SeriesNumber}`,
    SeriesNumber,
    SeriesDescription,
  });

  it('groups the full quartet in hanging order', () => {
    const set = detectDixonSet([
      series(4, 'T1 Dixon OUT OF PHASE'),
      series(1, 'T1 Dixon WATER'),
      series(3, 'T1 Dixon IN PHASE'),
      series(2, 'T1 Dixon FAT'),
    ]);

    expect(set.isDixon).toBe(true);
    expect(set.present).toEqual(DIXON_HANGING_ORDER);
    expect(set.components.water?.SeriesNumber).toBe(1);
    expect(set.components.outPhase?.SeriesNumber).toBe(4);
  });

  it('treats water+fat alone as a Dixon set', () => {
    const set = detectDixonSet([series(1, 'Dixon WATER'), series(2, 'Dixon FAT')]);
    expect(set.isDixon).toBe(true);
    expect(set.present).toEqual(['water', 'fat']);
  });

  it('does not call a single component a Dixon set', () => {
    const set = detectDixonSet([series(1, 'Dixon WATER'), series(2, 'AX T2 TSE')]);
    expect(set.isDixon).toBe(false);
    expect(set.present).toEqual(['water']);
  });

  it('keeps the lower SeriesNumber when a component repeats', () => {
    const set = detectDixonSet([
      series(9, 'Dixon WATER'),
      series(2, 'Dixon WATER'),
      series(3, 'Dixon FAT'),
    ]);
    expect(set.components.water?.SeriesNumber).toBe(2);
  });

  it('ranks a series with no SeriesNumber below one that has it', () => {
    const set = detectDixonSet([
      { Modality: 'MR', SeriesDescription: 'Dixon WATER' },
      { Modality: 'MR', SeriesNumber: 7, SeriesDescription: 'Dixon WATER' },
      { Modality: 'MR', SeriesNumber: 8, SeriesDescription: 'Dixon FAT' },
    ]);
    expect(set.components.water?.SeriesNumber).toBe(7);
  });

  it('ignores unrelated series', () => {
    const set = detectDixonSet([
      series(1, 'AX T2 TSE FS'),
      series(2, 'Localizer'),
      series(3, 'DWI b1000'),
    ]);
    expect(set.isDixon).toBe(false);
    expect(set.present).toEqual([]);
  });

  it('handles empty and nullish input', () => {
    expect(detectDixonSet([]).isDixon).toBe(false);
    expect(detectDixonSet(undefined as never).present).toEqual([]);
  });
});
