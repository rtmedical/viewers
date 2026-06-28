import {
  scoreMatch,
  selectProtocol,
  MATCH_WEIGHTS,
  type ProtocolCandidate,
} from './protocolMatcher';

describe('scoreMatch', () => {
  it('sums the weights of matching criteria', () => {
    const score = scoreMatch(
      { modality: 'CT', bodyPart: 'CHEST', studyDescription: 'CT THORAX' },
      {
        modality: { value: 'CT', level: 'exact' },
        bodyPart: { value: 'chest' },
        studyDescription: { value: 'thorax' },
      }
    );
    expect(score).toBeCloseTo(
      MATCH_WEIGHTS.modality + MATCH_WEIGHTS.bodyPart + MATCH_WEIGHTS.studyDescription
    );
  });

  it('scores 0 when nothing matches', () => {
    expect(scoreMatch({ modality: 'MR' }, { modality: { value: 'CT', level: 'exact' } })).toBe(0);
  });

  it('supports exact / contains / regex levels (case-insensitive)', () => {
    expect(scoreMatch({ modality: 'ct' }, { modality: { value: 'CT', level: 'exact' } })).toBe(
      MATCH_WEIGHTS.modality
    );
    expect(
      scoreMatch({ studyDescription: 'Crânio AVC agudo' }, { studyDescription: { value: 'avc' } })
    ).toBe(MATCH_WEIGHTS.studyDescription);
    expect(
      scoreMatch(
        { studyDescription: 'TC CRANIO' },
        { studyDescription: { value: 'cr[âa]nio', level: 'regex' } }
      )
    ).toBe(MATCH_WEIGHTS.studyDescription);
  });

  it('treats a missing attribute or invalid regex as no match', () => {
    expect(scoreMatch({}, { bodyPart: { value: 'HEAD' } })).toBe(0);
    expect(scoreMatch({ modality: 'CT' }, { modality: { value: '(', level: 'regex' } })).toBe(0);
  });
});

describe('selectProtocol', () => {
  const candidates: ProtocolCandidate[] = [
    { id: 'ct-chest', criteria: { modality: { value: 'CT', level: 'exact' }, bodyPart: { value: 'chest' } } },
    { id: 'ct-neuro', criteria: { modality: { value: 'CT', level: 'exact' }, studyDescription: { value: 'avc' } } },
    { id: 'mr-brain', criteria: { modality: { value: 'MR', level: 'exact' }, bodyPart: { value: 'head' } } },
  ];

  it('chooses the highest combined score above threshold', () => {
    const r = selectProtocol(
      { modality: 'CT', bodyPart: 'CHEST', studyDescription: 'rotina' },
      candidates
    );
    expect(r).toEqual({ protocolId: 'ct-chest', score: 0.7, isFallback: false });
  });

  it('falls back when the best score is below threshold', () => {
    // modality-only match = 0.4 < 0.5 default threshold
    const r = selectProtocol({ modality: 'CT', bodyPart: 'ABDOMEN' }, candidates);
    expect(r.isFallback).toBe(true);
    expect(r.protocolId).toBe('rt-radiology-default');
    expect(r.score).toBe(0.4);
  });

  it('honors a custom threshold and fallback id', () => {
    const r = selectProtocol({ modality: 'CT' }, candidates, {
      threshold: 0.4,
      fallbackId: 'house-default',
    });
    expect(r.isFallback).toBe(false);
    expect(r.score).toBe(0.4);
  });

  it('returns the fallback for no candidates', () => {
    const r = selectProtocol({ modality: 'CT' }, []);
    expect(r).toEqual({ protocolId: 'rt-radiology-default', score: 0, isFallback: true });
  });
});
