import {
  defaultBase64Decode,
  isValidDicomUid,
  modeRouteForStudy,
  parseIheRequest,
  studyPath,
  worklistPathForPatient,
} from './iheInvoke';

/** Test base64 encoder (Node Buffer — jsdom btoa also works, this is explicit). */
const b64 = (value: string) => Buffer.from(value, 'binary').toString('base64');

describe('isValidDicomUid', () => {
  it('accepts digits-and-dots UIDs and rejects everything else', () => {
    expect(isValidDicomUid('1.2.840.113619.2.55')).toBe(true);
    expect(isValidDicomUid('1')).toBe(true);
    expect(isValidDicomUid('')).toBe(false);
    expect(isValidDicomUid('1.2.x.3')).toBe(false);
    expect(isValidDicomUid('1.2 .3')).toBe(false);
    expect(isValidDicomUid(undefined)).toBe(false);
  });
});

describe('parseIheRequest — requestType=STUDY', () => {
  it('parses a single studyUID', () => {
    expect(parseIheRequest('?requestType=STUDY&studyUID=1.2.3')).toEqual({
      kind: 'study',
      studyUids: ['1.2.3'],
    });
  });

  it('parses a comma-separated studyUID list, trimming and de-duplicating', () => {
    expect(
      parseIheRequest('requestType=STUDY&studyUID=1.2.3,4.5.6,%201.2.3%20')
    ).toEqual({ kind: 'study', studyUids: ['1.2.3', '4.5.6'] });
  });

  it('accepts repeated studyUID parameters (tolerance)', () => {
    expect(parseIheRequest('?requestType=STUDY&studyUID=1.2.3&studyUID=4.5.6')).toEqual({
      kind: 'study',
      studyUids: ['1.2.3', '4.5.6'],
    });
  });

  it('matches requestType value and parameter names case-insensitively', () => {
    expect(parseIheRequest('?REQUESTTYPE=study&STUDYUID=1.2.3')).toEqual({
      kind: 'study',
      studyUids: ['1.2.3'],
    });
  });

  it('ignores extra/unknown parameters', () => {
    expect(
      parseIheRequest('?requestType=STUDY&studyUID=1.2.3&diagnosticQuality=true&foo=bar')
    ).toEqual({ kind: 'study', studyUids: ['1.2.3'] });
  });

  it('rejects a missing studyUID', () => {
    const result = parseIheRequest('?requestType=STUDY');
    expect(result.kind).toBe('invalid');
    expect((result as any).reason).toMatch(/studyUID/);
  });

  it('rejects an invalid Study Instance UID with the offending value', () => {
    const result = parseIheRequest('?requestType=STUDY&studyUID=1.2.3,not-a-uid');
    expect(result.kind).toBe('invalid');
    expect((result as any).reason).toContain('not-a-uid');
  });

  it('rejects a studyUID of only commas/whitespace', () => {
    expect(parseIheRequest('?requestType=STUDY&studyUID=,%20,').kind).toBe('invalid');
  });
});

describe('parseIheRequest — requestType=STUDYBASE64', () => {
  it('decodes a base64 single UID (injected decoder)', () => {
    const decode = jest.fn(() => '1.2.3');
    expect(parseIheRequest('?requestType=STUDYBASE64&studyUID=AAA', decode)).toEqual({
      kind: 'study',
      studyUids: ['1.2.3'],
    });
    expect(decode).toHaveBeenCalledWith('AAA');
  });

  it('decodes a base64 comma-separated UID list with the default decoder', () => {
    const encoded = encodeURIComponent(b64('1.2.3,4.5.6'));
    expect(parseIheRequest(`?requestType=STUDYBASE64&studyUID=${encoded}`)).toEqual({
      kind: 'study',
      studyUids: ['1.2.3', '4.5.6'],
    });
  });

  it('is case-insensitive on the requestType value', () => {
    const encoded = encodeURIComponent(b64('1.2.3'));
    expect(parseIheRequest(`?requestType=studyBase64&studyUID=${encoded}`).kind).toBe('study');
  });

  it('rejects values that are not base64', () => {
    const result = parseIheRequest('?requestType=STUDYBASE64&studyUID=%25%25%25');
    expect(result.kind).toBe('invalid');
    expect((result as any).reason).toMatch(/base64/);
  });

  it('rejects base64 that decodes to a non-UID', () => {
    const encoded = encodeURIComponent(b64('hello world'));
    expect(parseIheRequest(`?requestType=STUDYBASE64&studyUID=${encoded}`).kind).toBe('invalid');
  });
});

describe('parseIheRequest — requestType=PATIENT (best-effort)', () => {
  it('parses patientID, preserving HL7 CX values untouched', () => {
    expect(parseIheRequest('?requestType=PATIENT&patientID=P001')).toEqual({
      kind: 'patient',
      patientId: 'P001',
    });
    expect(
      parseIheRequest('?requestType=patient&patientID=' + encodeURIComponent('1234^^^HOSP'))
    ).toEqual({ kind: 'patient', patientId: '1234^^^HOSP' });
  });

  it('rejects a missing/empty patientID', () => {
    expect(parseIheRequest('?requestType=PATIENT').kind).toBe('invalid');
    expect(parseIheRequest('?requestType=PATIENT&patientID=%20').kind).toBe('invalid');
  });
});

describe('parseIheRequest — invalid requests', () => {
  it('rejects a missing requestType', () => {
    const result = parseIheRequest('?studyUID=1.2.3');
    expect(result.kind).toBe('invalid');
    expect((result as any).reason).toMatch(/requestType/);
  });

  it('rejects unsupported requestType values, echoing them', () => {
    const result = parseIheRequest('?requestType=SERIES&studyUID=1.2.3');
    expect(result.kind).toBe('invalid');
    expect((result as any).reason).toContain('SERIES');
  });

  it('handles empty/whitespace search strings', () => {
    expect(parseIheRequest('').kind).toBe('invalid');
    expect(parseIheRequest('?').kind).toBe('invalid');
  });
});

describe('defaultBase64Decode', () => {
  it('decodes plain, URL-safe and unpadded base64', () => {
    expect(defaultBase64Decode(b64('1.2.3,4.5.6'))).toBe('1.2.3,4.5.6');
    // '1.2.63' → 'MS4yLjYz'; URL-safe variants must also decode.
    expect(defaultBase64Decode('MS4yLjYz')).toBe('1.2.63');
    expect(defaultBase64Decode(b64('1.2.3').replace(/=+$/, ''))).toBe('1.2.3');
    expect(defaultBase64Decode(b64('1.2.3').replace(/\+/g, '-').replace(/\//g, '_'))).toBe(
      '1.2.3'
    );
  });

  it('throws on non-base64 input', () => {
    expect(() => defaultBase64Decode('%%%')).toThrow();
  });
});

describe('modeRouteForStudy', () => {
  it('selects radiotherapy when any RT modality is present (case-insensitive)', () => {
    expect(modeRouteForStudy(['CT', 'RTPLAN'])).toBe('rtmedical-radiotherapy');
    expect(modeRouteForStudy(['rtdose'])).toBe('rtmedical-radiotherapy');
    expect(modeRouteForStudy(['CT', ' rtstruct '])).toBe('rtmedical-radiotherapy');
    expect(modeRouteForStudy(['RTIMAGE'])).toBe('rtmedical-radiotherapy');
  });

  it('selects radiology otherwise, including for unknown/empty modalities', () => {
    expect(modeRouteForStudy(['CT', 'MR', 'SR'])).toBe('rtmedical-radiology');
    expect(modeRouteForStudy([])).toBe('rtmedical-radiology');
    // RTRECORD is not in the auto-select set (plan/dose/struct/image only).
    expect(modeRouteForStudy(['RTRECORD'])).toBe('rtmedical-radiology');
  });
});

describe('studyPath', () => {
  it('builds a single-study mode path', () => {
    expect(studyPath('rtmedical-radiology', '1.2.3')).toBe(
      '/rtmedical-radiology?StudyInstanceUIDs=1.2.3'
    );
  });

  it('joins multiple studies with commas', () => {
    expect(studyPath('rtmedical-radiotherapy', ['1.2.3', '4.5.6'])).toBe(
      '/rtmedical-radiotherapy?StudyInstanceUIDs=' + encodeURIComponent('1.2.3,4.5.6')
    );
  });

  it('preserves deployment-driving params and drops the rest', () => {
    const path = studyPath(
      'rtmedical-radiology',
      '1.2.3',
      '?requestType=STUDY&studyUID=1.2.3&datasources=orthanc&configUrl=/cfg.json&foo=bar'
    );
    const query = new URLSearchParams(path.split('?')[1]);
    expect(query.get('StudyInstanceUIDs')).toBe('1.2.3');
    expect(query.get('datasources')).toBe('orthanc');
    expect(query.get('configUrl')).toBe('/cfg.json');
    expect(query.get('foo')).toBeNull();
    expect(query.get('requestType')).toBeNull();
    expect(query.get('studyUID')).toBeNull();
  });
});

describe('worklistPathForPatient', () => {
  it('builds the MRN-filtered worklist path, preserving deployment params', () => {
    const path = worklistPathForPatient('P001', '?requestType=PATIENT&datasources=orthanc');
    const query = new URLSearchParams(path.split('?')[1]);
    expect(path.startsWith('/worklist-rt?')).toBe(true);
    expect(query.get('mrn')).toBe('P001');
    expect(query.get('datasources')).toBe('orthanc');
    expect(query.get('requestType')).toBeNull();
  });

  it('URL-encodes exotic MRNs (HL7 CX)', () => {
    const path = worklistPathForPatient('1234^^^HOSP');
    expect(new URLSearchParams(path.split('?')[1]).get('mrn')).toBe('1234^^^HOSP');
  });
});
