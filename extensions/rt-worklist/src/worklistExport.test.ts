import { buildCsv, csvFilename, CSV_EOL, escapeCsvCell, UTF8_BOM } from './worklistExport';

const COLUMNS = [
  { id: 'patientName', label: 'Paciente' },
  { id: 'mrn', label: 'Prontuário' },
  { id: 'modality', label: 'Modalidade' },
];

describe('worklistExport — cell escaping', () => {
  it('leaves ordinary values alone', () => {
    expect(escapeCsvCell('SILVA^JOAO')).toBe('SILVA^JOAO');
    expect(escapeCsvCell(42)).toBe('42');
  });

  it('renders null and undefined as empty, not as the word', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(escapeCsvCell('SILVA, JOAO')).toBe('"SILVA, JOAO"');
    expect(escapeCsvCell('diz "urgente"')).toBe('"diz ""urgente"""');
    expect(escapeCsvCell('linha1\nlinha2')).toBe('"linha1\nlinha2"');
  });

  // CSV injection: Excel evaluates a cell that starts with one of these. PatientName is
  // free text controlled upstream, so this is a real path from the RIS to code execution
  // on the supervisor's laptop.
  it('neutralises formula prefixes', () => {
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('+41 22')).toBe("'+41 22");
    expect(escapeCsvCell('-1')).toBe("'-1");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('neutralises the classic command payload even though it also needs quoting', () => {
    const cell = escapeCsvCell('=cmd|\'/c calc\'!A1');
    // The guard apostrophe must be INSIDE the field quoting, or the spreadsheet never
    // sees it. Quoting alone does not disarm a formula: "=1+1" still evaluates.
    expect(cell.startsWith("'=")).toBe(true);
  });

  it('neutralises a leading tab or CR, which some parsers strip before evaluating', () => {
    expect(escapeCsvCell('\t=1+1')).toBe("'\t=1+1");
    // A CR also forces field quoting; the guard still has to sit inside it.
    expect(escapeCsvCell('\r=1+1')).toBe('"\'\r=1+1"');
  });
});

describe('worklistExport — buildCsv', () => {
  const rows = [
    { patientName: 'SILVA^JOAO', mrn: '12345', modality: 'CT', priority: 'urgente' },
    { patientName: 'SOUZA, MARIA', mrn: '67890', modality: 'MR', priority: 'normal' },
  ];

  it('writes the header from the labels and one line per row', () => {
    const csv = buildCsv(rows, COLUMNS);
    const lines = csv.content.split(CSV_EOL);
    expect(lines[0]).toBe(`${UTF8_BOM}Paciente,Prontuário,Modalidade`);
    expect(lines[1]).toBe('SILVA^JOAO,12345,CT');
    expect(lines[2]).toBe('"SOUZA, MARIA",67890,MR');
    expect(csv.rowCount).toBe(2);
  });

  // Exporting the full pool would quietly widen a PHI export past what was on screen.
  it('writes only the given columns, in the given order', () => {
    const csv = buildCsv(rows, [COLUMNS[2], COLUMNS[0]]);
    expect(csv.content.split(CSV_EOL)[1]).toBe('CT,SILVA^JOAO');
    expect(csv.columns).toEqual(['modality', 'patientName']);
    expect(csv.content).not.toMatch(/urgente/);
  });

  it('supports computed columns', () => {
    const csv = buildCsv(rows, [
      { id: 'label', label: 'Resumo', value: r => `${r.modality} ${r.mrn}` },
    ]);
    expect(csv.content.split(CSV_EOL)[1]).toBe('CT 12345');
  });

  it('leaves a missing field empty instead of writing undefined', () => {
    const csv = buildCsv([{ patientName: 'X' }], COLUMNS);
    expect(csv.content.split(CSV_EOL)[1]).toBe('X,,');
  });

  it('starts with the BOM so Excel reads accents correctly', () => {
    expect(buildCsv(rows, COLUMNS).content.startsWith(UTF8_BOM)).toBe(true);
  });

  it('uses CRLF and ends with one', () => {
    const csv = buildCsv(rows, COLUMNS);
    expect(csv.content.endsWith(CSV_EOL)).toBe(true);
    expect(csv.content.split('\r\n')).toHaveLength(4);
  });

  it('writes a header-only file for an empty selection', () => {
    const csv = buildCsv([], COLUMNS);
    expect(csv.rowCount).toBe(0);
    expect(csv.content).toBe(`${UTF8_BOM}Paciente,Prontuário,Modalidade${CSV_EOL}`);
  });

  it('drops malformed column definitions', () => {
    const csv = buildCsv(rows, [COLUMNS[0], null as never, { id: '', label: 'x' }]);
    expect(csv.columns).toEqual(['patientName']);
  });

  it('escapes a hostile patient name coming through a row', () => {
    const csv = buildCsv([{ patientName: '=HYPERLINK("http://evil","clique")' }], COLUMNS);
    expect(csv.content).toMatch(/'=HYPERLINK/);
  });
});

describe('worklistExport — filename', () => {
  it('is filesystem-safe and carries the caller-supplied timestamp', () => {
    expect(csvFilename('2026-08-15T13:45:02.123Z')).toBe(
      'worklist-2026-08-15T13-45-02-123Z.csv'
    );
  });

  it('accepts a custom prefix and strips anything unsafe from it', () => {
    expect(csvFilename('2026-08-15', 'lote-urgentes')).toBe('lote-urgentes-2026-08-15.csv');
    expect(csvFilename('2026-08-15', 'lote/../etc')).toBe('loteetc-2026-08-15.csv');
  });

  it('falls back rather than producing a nameless file', () => {
    expect(csvFilename('')).toBe('worklist-export.csv');
    expect(csvFilename('2026-08-15', '///')).toBe('worklist-2026-08-15.csv');
  });
});
