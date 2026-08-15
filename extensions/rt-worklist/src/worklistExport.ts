/**
 * CSV export of the worklist — pure core (RTV-191).
 *
 * "Exportar" on the bulk toolbar writes the *visible* columns of the *selected* rows,
 * in the order the reader arranged them (RTV-184 profiles). Two things about writing
 * that file are not obvious.
 *
 * ## A CSV cell starting with `=`, `+`, `-` or `@` is a formula
 *
 * Excel and LibreOffice evaluate it on open. That is CSV injection, and it is a real
 * path from "a patient name field in the RIS" to "code runs on the supervisor's laptop"
 * — `=cmd|'/c calc'!A1` is the textbook payload, and DICOM PatientName is free text that
 * a hostile or merely careless upstream controls. {@link escapeCsvCell} prefixes those
 * cells with a single quote, which Excel treats as "this is text" and strips on display.
 * Quoting alone does **not** prevent it: `"=1+1"` still evaluates.
 *
 * ## The file is PHI leaving the system
 *
 * A worklist CSV is a list of patient names, MRNs and birth dates in a file that will
 * live in a Downloads folder and get emailed. This module does not decide whether that
 * is allowed — that is the access policy (RTV-193) and the audit trail (RTV-206) — but
 * it does refuse to be silent about it: {@link buildCsv} returns the row count and the
 * columns written so the caller has something concrete to log, and the filename carries
 * a caller-supplied timestamp rather than a hidden `Date.now()`.
 *
 * Framework-free; no DOM, no download. The caller turns the string into a Blob, so this
 * stays testable in node and reusable from a server-side export later.
 */

/** Excel needs a BOM to read UTF-8; without it accented patient names arrive mojibake. */
export const UTF8_BOM = '﻿';

/** RFC 4180 says CRLF, and Excel on Windows agrees. */
export const CSV_EOL = '\r\n';

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Renders one cell safely.
 *
 * Order matters: neutralise the formula prefix *first*, then quote. Doing it the other
 * way round would put the guard quote outside the field quoting, where the spreadsheet
 * never sees it.
 */
export function escapeCsvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);

  if (text.length && FORMULA_PREFIXES.includes(text[0])) {
    // A leading apostrophe is the spreadsheet's own "treat as text" marker; it is not
    // shown in the cell and it is stripped on re-import.
    text = `'${text}`;
  }

  const needsQuotes = /[",\r\n;]/.test(text);
  const escaped = text.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

export interface CsvColumn<Row = Record<string, unknown>> {
  id: string;
  label: string;
  /** How to read the cell. Defaults to `row[id]`. */
  value?: (row: Row) => unknown;
}

export interface CsvResult {
  content: string;
  rowCount: number;
  /** Column ids written, in order — for the audit entry. */
  columns: string[];
}

/**
 * Builds the CSV text for the given rows and columns.
 *
 * Columns come in as the *resolved visible set*, already ordered by the caller's profile,
 * so what lands in the file is what the reader sees on screen. Exporting the full pool
 * instead would quietly widen a PHI export beyond what the user was looking at.
 */
export function buildCsv<Row = Record<string, unknown>>(
  rows: Row[],
  columns: CsvColumn<Row>[]
): CsvResult {
  const cols = (columns ?? []).filter(c => c && c.id);
  const list = rows ?? [];

  const header = cols.map(c => escapeCsvCell(c.label ?? c.id)).join(',');
  const lines = [header];

  for (const row of list) {
    const cells = cols.map(col => {
      const raw = col.value ? col.value(row) : (row as Record<string, unknown>)?.[col.id];
      return escapeCsvCell(raw);
    });
    lines.push(cells.join(','));
  }

  return {
    content: UTF8_BOM + lines.join(CSV_EOL) + CSV_EOL,
    rowCount: list.length,
    columns: cols.map(c => c.id),
  };
}

/**
 * A filesystem-safe export filename.
 *
 * `isoTimestamp` is passed in rather than read from the clock, so the name is
 * deterministic in tests and so the value written to the audit log is the same one in
 * the filename.
 */
export function csvFilename(isoTimestamp: string, prefix = 'worklist'): string {
  const stamp = String(isoTimestamp ?? '')
    .replace(/[:.]/g, '-')
    .replace(/[^0-9A-Za-z-]/g, '_');
  const safePrefix = String(prefix ?? 'worklist').replace(/[^0-9A-Za-z_-]/g, '') || 'worklist';
  return `${safePrefix}-${stamp || 'export'}.csv`;
}
