import { selectPriors, type StudySummary } from './selectPriors';

const current: StudySummary = {
  StudyInstanceUID: 'cur',
  StudyDate: '20260601',
  ModalitiesInStudy: 'CT',
};

const studies: StudySummary[] = [
  { StudyInstanceUID: 'cur', StudyDate: '20260601', ModalitiesInStudy: 'CT' },
  { StudyInstanceUID: 'p1', StudyDate: '20260101', ModalitiesInStudy: 'CT' },
  { StudyInstanceUID: 'p2', StudyDate: '20250601', ModalitiesInStudy: 'CT' },
  { StudyInstanceUID: 'mr', StudyDate: '20250301', ModalitiesInStudy: 'MR' },
  { StudyInstanceUID: 'future', StudyDate: '20270101', ModalitiesInStudy: 'CT' },
];

describe('selectPriors', () => {
  it('returns the most-recent prior of the same modality by default', () => {
    expect(selectPriors(current, studies)).toEqual(['p1']);
  });

  it('returns multiple priors most-recent-first up to count', () => {
    expect(selectPriors(current, studies, { count: 2 })).toEqual(['p1', 'p2']);
  });

  it('excludes the current study and any study not earlier than it', () => {
    const result = selectPriors(current, studies, { count: 5 });
    expect(result).not.toContain('cur');
    expect(result).not.toContain('future');
  });

  it('filters by modality (same as current by default)', () => {
    expect(selectPriors(current, studies, { count: 5 })).not.toContain('mr');
  });

  it('can target a different modality', () => {
    expect(selectPriors(current, studies, { count: 5, sameModalityAs: 'MR' })).toEqual(['mr']);
  });

  it('returns all matching when no modality filter applies', () => {
    const noMod: StudySummary = { StudyInstanceUID: 'cur', StudyDate: '20260601' };
    expect(selectPriors(noMod, studies, { count: 5 })).toEqual(['p1', 'p2', 'mr']);
  });

  it('returns nothing for count 0 or no eligible priors', () => {
    expect(selectPriors(current, studies, { count: 0 })).toEqual([]);
    expect(selectPriors(current, [current], { count: 2 })).toEqual([]);
  });

  it('handles "CT\\MR" multi-modality strings', () => {
    const petct: StudySummary = { StudyInstanceUID: 'cur', StudyDate: '20260601', ModalitiesInStudy: 'PT\\CT' };
    expect(selectPriors(petct, studies, { count: 5 })).toEqual(['p1', 'p2']);
  });
});
