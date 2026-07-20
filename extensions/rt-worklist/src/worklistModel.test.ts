import {
  dicomDateToIso,
  filterStudies,
  formatStudyRow,
  groupStudiesByPatient,
  normalizeText,
  splitModalities,
  WorklistStudy,
} from './worklistModel';

const study = (overrides: Partial<WorklistStudy>): WorklistStudy => ({
  studyInstanceUid: '1.2.3',
  date: '20240115',
  time: '101500',
  accession: 'ACC-1',
  mrn: 'P001',
  patientName: 'Silva, João',
  instances: 120,
  description: 'CT Chest',
  modalities: 'CT\\SR',
  ...overrides,
});

describe('normalizeText', () => {
  it('lowercases, strips accents and trims', () => {
    expect(normalizeText('  JOÃO  ')).toBe('joao');
    expect(normalizeText('Müller-Àvila')).toBe('muller-avila');
    expect(normalizeText(undefined)).toBe('');
  });
});

describe('dicomDateToIso', () => {
  it('converts DICOM DA to ISO', () => {
    expect(dicomDateToIso('20240115')).toBe('2024-01-15');
  });

  it('passes ISO dates through and rejects garbage', () => {
    expect(dicomDateToIso('2024-01-15')).toBe('2024-01-15');
    expect(dicomDateToIso('2024')).toBe('');
    expect(dicomDateToIso(undefined)).toBe('');
  });
});

describe('splitModalities', () => {
  it('splits on backslash (getString join), slash, comma and whitespace', () => {
    expect(splitModalities('CT\\SR')).toEqual(['CT', 'SR']);
    expect(splitModalities('CT/PT')).toEqual(['CT', 'PT']);
    expect(splitModalities('ct, mr')).toEqual(['CT', 'MR']);
    expect(splitModalities('')).toEqual([]);
    expect(splitModalities(undefined)).toEqual([]);
  });
});

describe('groupStudiesByPatient', () => {
  it('groups by PatientID and sorts patients by name, accent-insensitive', () => {
    const studies = [
      study({ studyInstanceUid: '1', mrn: 'P002', patientName: 'Ávila, Ana' }),
      study({ studyInstanceUid: '2', mrn: 'P001', patientName: 'Silva, João' }),
      study({ studyInstanceUid: '3', mrn: 'P002', patientName: 'Ávila, Ana' }),
    ];

    const groups = groupStudiesByPatient(studies);

    expect(groups.map(g => g.patientId)).toEqual(['P002', 'P001']);
    expect(groups[0].studies).toHaveLength(2);
    expect(groups[1].studies).toHaveLength(1);
  });

  it('sorts studies inside a patient by date desc, undated last', () => {
    const studies = [
      study({ studyInstanceUid: 'old', date: '20200101' }),
      study({ studyInstanceUid: 'none', date: undefined }),
      study({ studyInstanceUid: 'new', date: '20240110' }),
      study({ studyInstanceUid: 'same-day-late', date: '20240110', time: '235900' }),
    ];

    const [group] = groupStudiesByPatient(studies);

    expect(group.studies.map(s => s.studyInstanceUid)).toEqual([
      'same-day-late',
      'new',
      'old',
      'none',
    ]);
  });

  it('falls back to name-based grouping when PatientID is empty', () => {
    const studies = [
      study({ studyInstanceUid: '1', mrn: '', patientName: 'José' }),
      study({ studyInstanceUid: '2', mrn: '', patientName: 'JOSÉ' }),
      study({ studyInstanceUid: '3', mrn: '', patientName: 'Maria' }),
    ];

    const groups = groupStudiesByPatient(studies);

    expect(groups).toHaveLength(2);
    expect(groups[0].studies).toHaveLength(2); // José + JOSÉ cluster together
    expect(groups[0].patientId).toBe('');
  });

  it('handles the empty list', () => {
    expect(groupStudiesByPatient([])).toEqual([]);
  });
});

describe('filterStudies', () => {
  const studies = [
    study({ studyInstanceUid: '1', patientName: 'Silva, João', mrn: 'P001', date: '20240110' }),
    study({
      studyInstanceUid: '2',
      patientName: 'Avila, Ana',
      mrn: 'P002',
      date: '20240201',
      modalities: 'MR',
    }),
    study({ studyInstanceUid: '3', patientName: 'Ávila, Ana', mrn: 'P003', date: undefined }),
  ];

  it('matches patient name case- and accent-insensitively', () => {
    expect(filterStudies(studies, { patientName: 'joão' }).map(s => s.studyInstanceUid)).toEqual([
      '1',
    ]);
    expect(filterStudies(studies, { patientName: 'JOAO' }).map(s => s.studyInstanceUid)).toEqual([
      '1',
    ]);
    // 'ávila' must match both the accented and the unaccented spelling.
    expect(filterStudies(studies, { patientName: 'ávila' }).map(s => s.studyInstanceUid)).toEqual([
      '2',
      '3',
    ]);
  });

  it('matches PatientID as a case-insensitive substring', () => {
    expect(filterStudies(studies, { patientId: 'p00' })).toHaveLength(3);
    expect(filterStudies(studies, { patientId: 'P002' }).map(s => s.studyInstanceUid)).toEqual([
      '2',
    ]);
  });

  it('applies the inclusive date range and drops undated studies', () => {
    expect(
      filterStudies(studies, { dateFrom: '2024-01-10', dateTo: '2024-01-31' }).map(
        s => s.studyInstanceUid
      )
    ).toEqual(['1']);
    // DA-format bounds work too, and the range is inclusive on both ends.
    expect(
      filterStudies(studies, { dateFrom: '20240110', dateTo: '20240201' }).map(
        s => s.studyInstanceUid
      )
    ).toEqual(['1', '2']);
    // A date filter excludes studies without a StudyDate.
    expect(
      filterStudies(studies, { dateFrom: '2000-01-01' }).map(s => s.studyInstanceUid)
    ).toEqual(['1', '2']);
  });

  it('matches any modality token of ModalitiesInStudy', () => {
    expect(filterStudies(studies, { modality: 'sr' }).map(s => s.studyInstanceUid)).toEqual([
      '1',
      '3',
    ]);
    expect(filterStudies(studies, { modality: 'MR' }).map(s => s.studyInstanceUid)).toEqual(['2']);
    expect(filterStudies(studies, { modality: 'US' })).toEqual([]);
  });

  it('combines filters and returns everything when filters are empty', () => {
    expect(filterStudies(studies)).toHaveLength(3);
    expect(
      filterStudies(studies, { patientName: 'ana', modality: 'MR' }).map(s => s.studyInstanceUid)
    ).toEqual(['2']);
  });
});

describe('formatStudyRow', () => {
  it('projects the data source study into a display row', () => {
    expect(formatStudyRow(study({}))).toEqual({
      studyInstanceUid: '1.2.3',
      date: '2024-01-15',
      description: 'CT Chest',
      modalities: 'CT, SR',
      instances: 120,
      accession: 'ACC-1',
      patientName: 'Silva, João',
      mrn: 'P001',
    });
  });

  it('is defensive about missing fields', () => {
    expect(formatStudyRow({ studyInstanceUid: '9' } as WorklistStudy)).toEqual({
      studyInstanceUid: '9',
      date: '',
      description: '',
      modalities: '',
      instances: 0,
      accession: '',
      patientName: '',
      mrn: '',
    });
  });
});
