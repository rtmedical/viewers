import {
  describeFilters,
  emptyFilterGroup,
  filterStudies,
  FilterGroup,
  matchesCriterion,
  matchesStudy,
  normalizeDate,
  parseFilters,
  removeField,
  serializeFilters,
  upsertCriterion,
} from './worklistFilters';

const study = (over: Record<string, unknown> = {}) => ({
  patientName: 'Silva^Joao',
  mrn: '12345',
  studyDate: '20260814',
  modality: ['CT'],
  reportStatus: 'none',
  priority: 'normal',
  ...over,
});

describe('normalizeDate', () => {
  it('accepts DICOM and ISO', () => {
    // Rows arrive from QIDO-RS in one form and a RIS API in the other.
    expect(normalizeDate('20260814')).toBe('20260814');
    expect(normalizeDate('2026-08-14')).toBe('20260814');
    expect(normalizeDate('2026-08-14T10:00:00Z')).toBe('20260814');
  });

  it('is null for anything else', () => {
    expect(normalizeDate('14/08/2026')).toBeNull();
    expect(normalizeDate('')).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
  });
});

describe('matchesCriterion', () => {
  it('matches contains case-insensitively', () => {
    expect(matchesCriterion(study(), { field: 'patientName', operator: 'contains', value: 'silva' })).toBe(true);
    expect(matchesCriterion(study(), { field: 'patientName', operator: 'contains', value: 'souza' })).toBe(false);
  });

  it('treats an empty needle as "no filter yet"', () => {
    // A half-typed search box must not blank the list mid-word.
    expect(matchesCriterion(study(), { field: 'patientName', operator: 'contains', value: '' })).toBe(true);
    expect(matchesCriterion(study(), { field: 'patientName', operator: 'anyOf', value: [] })).toBe(true);
  });

  it('matches any of several values, including multi-valued fields', () => {
    const multi = study({ modality: ['CT', 'PT'] });
    expect(matchesCriterion(multi, { field: 'modality', operator: 'anyOf', value: ['mr', 'pt'] })).toBe(true);
    expect(matchesCriterion(multi, { field: 'modality', operator: 'anyOf', value: ['us'] })).toBe(false);
  });

  it('handles equals and emptiness', () => {
    expect(matchesCriterion(study(), { field: 'reportStatus', operator: 'equals', value: 'NONE' })).toBe(true);
    expect(matchesCriterion(study({ assignee: '' }), { field: 'assignee', operator: 'isEmpty' })).toBe(true);
    expect(matchesCriterion(study({ assignee: 'dr' }), { field: 'assignee', operator: 'notEmpty' })).toBe(true);
  });

  it('compares dates with before/after/between', () => {
    const s = study({ studyDate: '20260814' });
    expect(matchesCriterion(s, { field: 'studyDate', operator: 'after', value: '2026-08-01' })).toBe(true);
    expect(matchesCriterion(s, { field: 'studyDate', operator: 'before', value: '2026-08-01' })).toBe(false);
    expect(matchesCriterion(s, { field: 'studyDate', operator: 'between', value: ['20260801', '20260831'] })).toBe(true);
    expect(matchesCriterion(s, { field: 'studyDate', operator: 'between', value: ['20260901', '20260930'] })).toBe(false);
  });

  it('excludes an undated study from a date filter', () => {
    // Treating it as a match would quietly pad every date-filtered list.
    const undated = study({ studyDate: undefined });
    expect(matchesCriterion(undated, { field: 'studyDate', operator: 'after', value: '20260101' })).toBe(false);
  });

  it('ignores a malformed criterion rather than dropping the row', () => {
    expect(matchesCriterion(study(), {} as never)).toBe(true);
  });
});

describe('matchesStudy', () => {
  const ctOrMr: FilterGroup = {
    combinator: 'or',
    criteria: [
      { field: 'modality', operator: 'anyOf', value: ['ct'] },
      { field: 'modality', operator: 'anyOf', value: ['mr'] },
    ],
  };

  it('ANDs by default', () => {
    const group: FilterGroup = {
      combinator: 'and',
      criteria: [
        { field: 'modality', operator: 'anyOf', value: ['ct'] },
        { field: 'priority', operator: 'anyOf', value: ['urgent'] },
      ],
    };
    expect(matchesStudy(study(), group)).toBe(false);
    expect(matchesStudy(study({ priority: 'urgent' }), group)).toBe(true);
  });

  it('ORs when asked', () => {
    expect(matchesStudy(study({ modality: ['MR'] }), ctOrMr)).toBe(true);
    expect(matchesStudy(study({ modality: ['US'] }), ctOrMr)).toBe(false);
  });

  it('an empty group matches everything', () => {
    // Clearing the last chip must show the full worklist, not an empty one.
    expect(matchesStudy(study(), emptyFilterGroup())).toBe(true);
    expect(matchesStudy(study(), { combinator: 'or', criteria: [] })).toBe(true);
  });

  it('filters a list', () => {
    const rows = [study(), study({ modality: ['MR'] }), study({ modality: ['US'] })];
    expect(filterStudies(rows, ctOrMr)).toHaveLength(2);
    expect(filterStudies([], ctOrMr)).toEqual([]);
  });
});

describe('URL round-trip', () => {
  const group: FilterGroup = {
    combinator: 'and',
    criteria: [
      { field: 'modality', operator: 'anyOf', value: ['ct', 'mr'] },
      { field: 'reportStatus', operator: 'equals', value: 'none' },
    ],
  };

  it('round-trips', () => {
    expect(parseFilters(serializeFilters(group))).toEqual(group);
  });

  it('is compact enough to paste into chat', () => {
    expect(serializeFilters(group)).toBe('modality:anyOf:ct,mr;reportStatus:equals:none');
  });

  it('keeps the OR combinator', () => {
    const or: FilterGroup = { ...group, combinator: 'or' };
    expect(serializeFilters(or).startsWith('or|')).toBe(true);
    expect(parseFilters(serializeFilters(or)).combinator).toBe('or');
  });

  it('survives a value containing the separators', () => {
    // A patient name containing a separator must not corrupt the parse. The tilde is
    // in here on purpose: encodeURIComponent does NOT escape it, which is exactly why
    // it cannot be used as a separator.
    const tricky: FilterGroup = {
      combinator: 'and',
      criteria: [{ field: 'patientName', operator: 'contains', value: 'Silva, Joao~:;x' }],
    };
    expect(parseFilters(serializeFilters(tricky))).toEqual(tricky);
  });

  it('drops unknown fields and operators instead of failing', () => {
    // The URL may come from an older build with a field this one no longer has.
    const parsed = parseFilters('nope:contains:x;modality:anyOf:ct;mrn:whatever:1');
    expect(parsed.criteria).toHaveLength(1);
    expect(parsed.criteria[0].field).toBe('modality');
  });

  it('handles empty and malformed input', () => {
    expect(parseFilters('')).toEqual(emptyFilterGroup());
    expect(parseFilters(undefined)).toEqual(emptyFilterGroup());
    expect(serializeFilters(emptyFilterGroup())).toBe('');
    // A hand-mangled escape keeps the raw text rather than losing the filter.
    expect(parseFilters('patientName:contains:%E0%A4%A').criteria).toHaveLength(1);
  });
});

describe('upsertCriterion / removeField / describeFilters', () => {
  it('replaces the criterion for a field rather than stacking', () => {
    let group = upsertCriterion(emptyFilterGroup(), {
      field: 'modality',
      operator: 'anyOf',
      value: ['ct'],
    });
    group = upsertCriterion(group, { field: 'modality', operator: 'anyOf', value: ['mr'] });
    expect(group.criteria).toHaveLength(1);
    expect(group.criteria[0].value).toEqual(['mr']);
  });

  it('removes by field', () => {
    const group = upsertCriterion(emptyFilterGroup(), {
      field: 'mrn',
      operator: 'contains',
      value: '1',
    });
    expect(removeField(group, 'mrn').criteria).toEqual([]);
  });

  it('describes the active filters', () => {
    expect(describeFilters(emptyFilterGroup())).toBe('No filters');
    expect(
      describeFilters({
        combinator: 'or',
        criteria: [
          { field: 'modality', operator: 'anyOf', value: ['ct', 'mr'] },
          { field: 'assignee', operator: 'isEmpty' },
        ],
      })
    ).toBe('modality in ct, mr or assignee is empty');
  });
});
