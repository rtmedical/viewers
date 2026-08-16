import {
  buildReference,
  describeExport,
  exportDiagnosticReport,
  ExportInput,
  InternalReportState,
  isActionable,
  toFhirStatus,
} from './fhirExport';

const PATIENT = { system: 'urn:oid:2.16.840.1.113883.13.236', value: 'MRN-42' };
const CODE = { system: 'http://loinc.org', code: '24627-2', display: 'TC de tórax' };

const input = (over: Partial<ExportInput> = {}): ExportInput => ({
  reportId: 'r1',
  state: 'signed',
  code: CODE,
  patient: PATIENT,
  effectiveDateTime: '2026-08-15T10:00:00Z',
  issued: '2026-08-15T11:30:00Z',
  ...over,
});

describe('fhirExport — the status mapping and its near-misses', () => {
  it('maps the states', () => {
    expect(toFhirStatus('draft')).toBe('registered');
    expect(toFhirStatus('preliminary')).toBe('preliminary');
    expect(toFhirStatus('signed')).toBe('final');
    expect(toFhirStatus('amended')).toBe('amended');
    expect(toFhirStatus('retracted')).toBe('entered-in-error');
  });

  // Calling it preliminary tells a downstream system a clinician may act on it.
  it('awaitingReview is PARTIAL, not preliminary', () => {
    expect(toFhirStatus('awaitingReview')).toBe('partial');
    expect(toFhirStatus('awaitingReview')).not.toBe('preliminary');
  });

  it('draft is REGISTERED, not partial', () => {
    expect(toFhirStatus('draft')).toBe('registered');
  });

  // A receiving system treats final as clinically actionable and stops re-fetching it.
  it('nothing unsigned maps to final', () => {
    const unsigned: InternalReportState[] = ['draft', 'awaitingReview', 'preliminary', 'retracted'];
    for (const state of unsigned) {
      expect(toFhirStatus(state)).not.toBe('final');
    }
  });

  it('knows which statuses a receiver will act on', () => {
    expect(isActionable('final')).toBe(true);
    expect(isActionable('amended')).toBe(true);
    expect(isActionable('preliminary')).toBe(false);
    expect(isActionable('partial')).toBe(false);
  });
});

describe('fhirExport — references have to resolve', () => {
  it('builds one from a system-qualified identifier', () => {
    const result = buildReference('Patient', PATIENT, 'SILVA^JOAO');
    expect(result.reference!.identifier).toEqual(PATIENT);
    expect(result.reference!.display).toBe('SILVA^JOAO');
  });

  // Patient/42 is useful inside one database and useless outside it.
  it('REFUSES an identifier with no system', () => {
    const result = buildReference('Patient', { system: '', value: '42' });
    expect(result.reference).toBeNull();
    expect(result.error).toMatch(/não resolve fora do banco que o criou/);
  });

  it('refuses an empty value or resource type', () => {
    expect(buildReference('Patient', { system: 'x', value: '' }).error).toMatch(/identificador ausente/);
    expect(buildReference('', PATIENT).error).toMatch(/Tipo de recurso ausente/);
  });

  // An unresolvable export looks successful and fails at the far end, days later.
  it('the whole export fails when the subject cannot be resolved', () => {
    const result = exportDiagnosticReport(input({ patient: { system: '', value: '42' } }));
    expect(result.ok).toBe(false);
    expect(result.report).toBeNull();
    expect(result.errors.join(' ')).toMatch(/system/);
  });

  it('warns but continues when an ImagingStudy reference is unusable', () => {
    const result = exportDiagnosticReport(
      input({ imagingStudy: [{ system: '', value: '1.2.3' }] })
    );
    expect(result.ok).toBe(true);
    expect(result.report!.imagingStudy).toBeUndefined();
    expect(result.warnings.join(' ')).toMatch(/ImagingStudy/);
  });
});

describe('fhirExport — effective is the acquisition, issued is the release', () => {
  it('keeps them apart', () => {
    const result = exportDiagnosticReport(input());
    expect(result.report!.effectiveDateTime).toBe('2026-08-15T10:00:00Z');
    expect(result.report!.issued).toBe('2026-08-15T11:30:00Z');
  });

  it('refuses without the acquisition time, naming which one it means', () => {
    const result = exportDiagnosticReport(input({ effectiveDateTime: '' }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/hora da AQUISIÇÃO, não a da assinatura/);
  });

  // final is the status a receiver stops re-fetching.
  it('refuses a final report with no issue time', () => {
    const result = exportDiagnosticReport(input({ issued: '' }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/status final/);
  });

  it('allows a preliminary with no issue time', () => {
    expect(exportDiagnosticReport(input({ state: 'preliminary', issued: '' })).ok).toBe(true);
  });

  it('warns about an issue time on a non-final report', () => {
    const result = exportDiagnosticReport(input({ state: 'draft' }));
    expect(result.warnings.join(' ')).toMatch(/ainda não é final/);
  });
});

describe('fhirExport — structured findings do not live in the HTML', () => {
  const finding = (over = {}) => ({
    id: 'f1',
    code: { system: 'http://radelement.org', code: 'RDE1301', display: 'Diâmetro do nódulo' },
    valueQuantity: { value: 8, unit: 'mm', system: 'http://unitsofmeasure.org', code: 'mm' },
    ...over,
  });

  it('turns a coded finding into an Observation and links it', () => {
    const result = exportDiagnosticReport(input({ findings: [finding()] }));
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].code.code).toBe('RDE1301');
    expect(result.observations[0].valueQuantity!.value).toBe(8);
    expect(result.report!.result).toEqual([{ reference: 'Observation/f1' }]);
  });

  it('carries the DICOM evidence as derivedFrom', () => {
    const result = exportDiagnosticReport(
      input({ findings: [finding({ evidence: { sopInstanceUid: '1.2.3.4' } })] })
    );
    expect(result.observations[0].derivedFrom![0].identifier).toEqual({
      system: 'urn:dicom:uid',
      value: 'urn:oid:1.2.3.4',
    });
  });

  // The architecture note forbids exactly this quiet flattening.
  it('REPORTS a finding with no code instead of flattening it into prose', () => {
    const result = exportDiagnosticReport(
      input({ findings: [finding(), { id: 'f2', valueString: 'nódulo suspeito' }] })
    );
    expect(result.observations).toHaveLength(1);
    expect(result.unstructuredFindings).toEqual(['f2']);
    expect(result.warnings.join(' ')).toMatch(/contraria a decisão CDE-first/);
  });

  it('refuses a code without a system, same as any other identifier', () => {
    const result = exportDiagnosticReport(
      input({ findings: [finding({ code: { system: '', code: 'X' } })] })
    );
    expect(result.unstructuredFindings).toEqual(['f1']);
  });

  it('the Observation status follows the report status', () => {
    expect(exportDiagnosticReport(input({ findings: [finding()] })).observations[0].status).toBe('final');
    expect(
      exportDiagnosticReport(input({ state: 'preliminary', issued: '', findings: [finding()] }))
        .observations[0].status
    ).toBe('preliminary');
    expect(
      exportDiagnosticReport(input({ state: 'amended', findings: [finding()] })).observations[0].status
    ).toBe('amended');
  });

  it('leaves result undefined when there is nothing structured', () => {
    expect(exportDiagnosticReport(input()).report!.result).toBeUndefined();
  });
});

describe('fhirExport — the rest of the resource', () => {
  it('carries the narrative and the signed PDF', () => {
    const result = exportDiagnosticReport(
      input({ narrative: 'Tórax sem alterações.', pdfBase64: 'JVBERi0=' })
    );
    expect(result.report!.conclusion).toBe('Tórax sem alterações.');
    expect(result.report!.presentedForm![0].contentType).toBe('application/pdf');
  });

  it('carries the performer', () => {
    const result = exportDiagnosticReport(
      input({
        performer: [
          { identifier: { system: 'urn:oid:crm', value: 'DF-12345' }, display: 'Dra. Ana Lima' },
        ],
      })
    );
    expect(result.report!.performer![0].display).toBe('Dra. Ana Lima');
  });

  it('refuses a procedure code without a system', () => {
    expect(exportDiagnosticReport(input({ code: { system: '', code: 'x' } })).ok).toBe(false);
  });

  it('refuses a report with no id', () => {
    expect(exportDiagnosticReport(input({ reportId: '' })).ok).toBe(false);
  });

  it('summarises what it produced and what it dropped', () => {
    const text = describeExport(
      exportDiagnosticReport(
        input({
          findings: [
            { id: 'f1', code: { system: 'http://loinc.org', code: 'X' }, valueString: 'a' },
            { id: 'f2', valueString: 'b' },
          ],
        })
      )
    );
    expect(text).toMatch(/DiagnosticReport final · 1 Observation\(s\) · 1 achado\(s\) sem código/);
  });

  it('says why nothing was exported', () => {
    expect(describeExport(exportDiagnosticReport(input({ reportId: '' })))).toMatch(
      /Export não realizado/
    );
    expect(describeExport(undefined as never)).toBe('');
  });
});
