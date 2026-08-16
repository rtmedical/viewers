import {
  appendVersion,
  CanonicalReport,
  contentHash,
  currentVersion,
  describeVersion,
  effectiveObservations,
  isCurrent,
  Observation,
  ReportVersion,
  sealVersion,
  validateVersion,
} from './canonicalReport';

const T0 = 1_700_000_000_000;

const CONCEPT = {
  system: 'http://radelement.org',
  code: 'RDE1301',
  display: 'Diâmetro do nódulo',
  systemVersion: '2024-01',
};

const observation = (over: Partial<Observation> = {}): Observation => ({
  id: 'o1',
  concept: CONCEPT,
  value: { kind: 'quantity', value: 8, unit: 'mm' },
  section: 'achados',
  provenance: { assertedBy: 'human', actorId: 'ana', at: T0 },
  ...over,
});

const version = (over: Partial<ReportVersion> = {}): ReportVersion => ({
  version: 1,
  status: 'open',
  kind: 'report',
  sections: [{ id: 'achados', title: 'Achados', narrative: 'Nódulo de 8 mm no LSD.' }],
  observations: [observation()],
  evidence: [],
  createdAt: T0,
  createdBy: 'ana',
  ...over,
});

describe('canonicalReport — the structured value is the record', () => {
  it('accepts prose whose measurement an observation backs', () => {
    expect(validateVersion(version())).toEqual([]);
  });

  // A number in the text that is not in the data cannot be exported, compared, or trusted
  // after somebody edits the sentence around it.
  it('WARNS about a measurement in the prose with no observation behind it', () => {
    const issues = validateVersion(
      version({
        sections: [{ id: 'achados', title: 'Achados', narrative: 'Nódulo de 6 mm no LSD.' }],
      })
    );
    expect(issues.map(i => i.code)).toContain('unbackedMeasurement');
    expect(issues[0].message).toMatch(/não poderá ser exportado nem comparado/);
  });

  it('matches on the unit too, not just the number', () => {
    const issues = validateVersion(
      version({
        sections: [{ id: 'achados', title: 'Achados', narrative: 'Lesão de 8 cm.' }],
      })
    );
    expect(issues.map(i => i.code)).toContain('unbackedMeasurement');
  });

  it('accepts a decimal written with a comma', () => {
    const issues = validateVersion(
      version({
        observations: [observation({ value: { kind: 'quantity', value: 8.5, unit: 'mm' } })],
        sections: [{ id: 'achados', title: 'Achados', narrative: 'Nódulo de 8,5 mm.' }],
      })
    );
    expect(issues).toEqual([]);
  });

  it('says nothing about prose with no measurements', () => {
    expect(
      validateVersion(
        version({
          observations: [],
          sections: [{ id: 'a', title: 'A', narrative: 'Sem alterações.' }],
        })
      )
    ).toEqual([]);
  });
});

describe('canonicalReport — provenance', () => {
  // An unconfirmed machine assertion that looks identical to a radiologist's is the failure
  // that discredits the whole assisted-reporting feature.
  it('REFUSES an unconfirmed machine assertion', () => {
    const issues = validateVersion(
      version({
        observations: [
          observation({
            provenance: { assertedBy: 'machine', actorId: 'cad-v3', at: T0, source: 'cad-v3' },
          }),
        ],
      })
    );
    const issue = issues.find(i => i.code === 'unconfirmedMachineAssertion');
    expect(issue!.severity).toBe('error');
    expect(issue!.message).toMatch(/não foi confirmada por um humano/);
  });

  it('accepts one a human confirmed', () => {
    const issues = validateVersion(
      version({
        observations: [
          observation({
            provenance: {
              assertedBy: 'machine',
              actorId: 'cad-v3',
              at: T0,
              humanConfirmed: true,
            },
          }),
        ],
      })
    );
    expect(issues.filter(i => i.severity === 'error')).toEqual([]);
  });

  it('treats an imported assertion the same way', () => {
    const issues = validateVersion(
      version({
        observations: [observation({ provenance: { assertedBy: 'imported', actorId: 'ris', at: T0 } })],
      })
    );
    expect(issues.map(i => i.code)).toContain('unconfirmedMachineAssertion');
  });
});

describe('canonicalReport — codes and evidence', () => {
  it('refuses an observation with no coded concept', () => {
    const issues = validateVersion(
      version({ observations: [observation({ concept: { system: '', code: '' } })] })
    );
    expect(issues.find(i => i.code === 'missingConcept')!.severity).toBe('error');
  });

  // A code without its system version cannot be re-resolved when the system changes.
  it('warns about a code system with no version', () => {
    const issues = validateVersion(
      version({
        observations: [
          observation({ concept: { system: 'http://radelement.org', code: 'RDE1301' } }),
        ],
      })
    );
    const issue = issues.find(i => i.code === 'unversionedCodeSystem');
    expect(issue!.severity).toBe('warning');
    expect(issue!.message).toMatch(/pode mudar sem aviso/);
  });

  it('refuses an observation pointing at evidence that is not there', () => {
    const issues = validateVersion(version({ observations: [observation({ evidenceIds: ['e9'] })] }));
    expect(issues.find(i => i.code === 'danglingEvidence')!.severity).toBe('error');
  });

  it('accepts evidence that resolves', () => {
    const issues = validateVersion(
      version({
        observations: [observation({ evidenceIds: ['e1'] })],
        evidence: [{ id: 'e1', studyInstanceUid: '1.2.3', sopInstanceUid: '1.2.3.4' }],
      })
    );
    expect(issues).toEqual([]);
  });

  it('refuses duplicate observation ids', () => {
    const issues = validateVersion(
      version({ observations: [observation(), observation()] })
    );
    expect(issues.find(i => i.code === 'duplicateObservationId')!.severity).toBe('error');
  });

  it('refuses a completely empty version', () => {
    expect(
      validateVersion(version({ observations: [], sections: [] })).map(i => i.code)
    ).toContain('emptyVersion');
  });
});

describe('canonicalReport — sealing', () => {
  it('seals a clean version and stamps a hash', () => {
    const result = sealVersion(version(), 'ana', T0 + 1000);
    expect(result.version!.status).toBe('sealed');
    expect(result.version!.sealedBy).toBe('ana');
    expect(result.version!.contentHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('refuses on any error-severity issue', () => {
    const result = sealVersion(
      version({ observations: [observation({ concept: { system: '', code: '' } })] }),
      'ana',
      T0
    );
    expect(result.version).toBeNull();
    expect(result.error).toMatch(/não pode ser selada/);
  });

  // An unversioned code system is worth knowing about and not worth stopping a signature.
  it('seals despite warnings, returning them', () => {
    const result = sealVersion(
      version({
        observations: [observation({ concept: { system: 'http://x', code: 'C' } })],
      }),
      'ana',
      T0
    );
    expect(result.version).not.toBeNull();
    expect(result.issues.some(i => i.severity === 'warning')).toBe(true);
  });

  // Two layers that both believe they own immutability is how one of them stops enforcing
  // it.
  it('REFUSES to re-seal a sealed version', () => {
    const sealed = sealVersion(version(), 'ana', T0).version!;
    expect(sealVersion(sealed, 'bruno', T0 + 1).error).toMatch(/imutáveis/);
  });

  it('refuses without a responsible person or a time', () => {
    expect(sealVersion(version(), '  ', T0).error).toMatch(/responsável/);
    expect(sealVersion(version(), 'ana', NaN).error).toMatch(/horário/);
  });
});

describe('canonicalReport — the content hash', () => {
  it('is stable across two identical versions', () => {
    expect(contentHash(version())).toBe(contentHash(version()));
  });

  it('changes when the narrative changes', () => {
    expect(contentHash(version())).not.toBe(
      contentHash(version({ sections: [{ id: 'a', title: 'A', narrative: 'outro' }] }))
    );
  });

  it('changes when an observation value changes', () => {
    expect(contentHash(version())).not.toBe(
      contentHash(version({ observations: [observation({ value: { kind: 'quantity', value: 9, unit: 'mm' } })] }))
    );
  });

  // Order of observations is a storage detail, not content.
  it('does NOT change when the observations are merely reordered', () => {
    const a = version({ observations: [observation({ id: 'o1' }), observation({ id: 'o2' })] });
    const b = version({ observations: [observation({ id: 'o2' }), observation({ id: 'o1' })] });
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('answers "is what I hold current" without comparing fields', () => {
    const sealed = sealVersion(version(), 'ana', T0).version!;
    const report: CanonicalReport = {
      reportId: 'r1', patientId: 'p1', studyInstanceUid: '1.2.3', versions: [sealed],
    };
    expect(isCurrent(report, sealed.contentHash as string)).toBe(true);
    expect(isCurrent(report, 'deadbeef')).toBe(false);
  });
});

describe('canonicalReport — the version chain', () => {
  const seal = (v: ReportVersion) => sealVersion(v, 'ana', T0).version as ReportVersion;
  const base = (): CanonicalReport => ({
    reportId: 'r1', patientId: 'p1', studyInstanceUid: '1.2.3', versions: [],
  });

  it('appends a sealed version 1', () => {
    const result = appendVersion(base(), seal(version()));
    expect(result.report!.versions).toHaveLength(1);
  });

  // A mutable member of the collection is a hole in the record.
  it('REFUSES an open version', () => {
    expect(appendVersion(base(), version()).error).toMatch(/Só versões seladas/);
  });

  it('refuses a version out of sequence', () => {
    const one = appendVersion(base(), seal(version())).report!;
    expect(appendVersion(one, seal(version({ version: 5 }))).error).toMatch(/fora de sequência/);
  });

  it('refuses an addendum with no original', () => {
    expect(
      appendVersion(base(), seal(version({ kind: 'addendum', amends: 0 }))).error
    ).toMatch(/sem laudo original/);
  });

  it('accepts an addendum after the original', () => {
    const one = appendVersion(base(), seal(version())).report!;
    const two = appendVersion(one, seal(version({ version: 2, kind: 'addendum', amends: 1 })));
    expect(two.report!.versions).toHaveLength(2);
    expect(currentVersion(two.report!)!.version).toBe(2);
  });

  it('the latest assertion of each observation wins across versions', () => {
    const one = appendVersion(base(), seal(version())).report!;
    const amended = seal(
      version({
        version: 2,
        kind: 'addendum',
        amends: 1,
        observations: [observation({ value: { kind: 'quantity', value: 11, unit: 'mm' } })],
        sections: [{ id: 'achados', title: 'Achados', narrative: 'Nódulo de 11 mm.' }],
      })
    );
    const two = appendVersion(one, amended).report!;
    const effective = effectiveObservations(two);
    expect(effective).toHaveLength(1);
    expect((effective[0].value as { value: number }).value).toBe(11);
  });

  it('describes a version for the history list', () => {
    expect(describeVersion(seal(version()))).toMatch(/^v1 laudo · 1 observação\(ões\) · selado por ana$/);
    expect(describeVersion(version({ version: 3, kind: 'addendum', amends: 2 }))).toMatch(
      /v3 adendo \(complementa v2\).*aberto/
    );
    expect(describeVersion(undefined as never)).toBe('');
  });
});
