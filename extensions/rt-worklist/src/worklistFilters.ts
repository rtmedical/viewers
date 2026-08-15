/**
 * Composite worklist filters — pure core (RTV-185).
 *
 * A hospital reading 500+ studies a day needs more than "date and patient name": a
 * radiologist wants *(CT or MR) AND unreported AND urgent*, and wants that back
 * tomorrow morning as a link.
 *
 * Three properties drive the design:
 *
 * - **Composable.** Criteria combine with an explicit AND/OR operator rather than an
 *   implicit one, because "CT or MR" and "CT and MR" are both things a reader means
 *   and only one of them is ever the default.
 * - **Serialisable to a URL.** A filter that cannot be pasted into chat is a filter
 *   the reader rebuilds by hand every morning. Round-tripping through a query string
 *   is an explicit acceptance criterion, and it also gives back/forward for free.
 * - **Evaluated locally.** `matchesStudy` runs the same predicate the server would, so
 *   a filter behaves identically whether the rows came from QIDO-RS or a RIS API.
 *
 * Framework-free. Zero-fork per RTV-114.
 */

/** Fields a worklist row can be filtered on. */
export type FilterField =
  | 'patientName'
  | 'mrn'
  | 'accession'
  | 'studyDate'
  | 'modality'
  | 'bodyPart'
  | 'description'
  | 'reportStatus'
  | 'priority'
  | 'assignee'
  | 'referrer'
  | 'institution';

export type FilterOperator =
  | 'contains'
  | 'equals'
  | 'anyOf'
  | 'between'
  | 'before'
  | 'after'
  | 'isEmpty'
  | 'notEmpty';

export interface FilterCriterion {
  field: FilterField;
  operator: FilterOperator;
  /** A string for text operators, an array for `anyOf`, `[from, to]` for `between`. */
  value?: string | string[];
}

export type FilterCombinator = 'and' | 'or';

export interface FilterGroup {
  combinator: FilterCombinator;
  criteria: FilterCriterion[];
}

export function emptyFilterGroup(): FilterGroup {
  return { combinator: 'and', criteria: [] };
}

/** The shape a worklist row needs to expose to be filterable. */
export type FilterableStudy = Partial<Record<FilterField, unknown>>;

const text = (value: unknown): string =>
  value == null ? '' : String(Array.isArray(value) ? value.join(' ') : value).trim();

const lower = (value: unknown): string => text(value).toLowerCase();

/** Values as a lower-cased list — a study can carry several modalities. */
function valuesOf(study: FilterableStudy, field: FilterField): string[] {
  const raw = study?.[field];
  if (Array.isArray(raw)) {
    return raw.map(v => lower(v)).filter(Boolean);
  }
  const single = lower(raw);
  return single ? [single] : [];
}

/**
 * Normalises a date to `YYYYMMDD` for comparison.
 *
 * Accepts both the DICOM form (`20260814`) and ISO (`2026-08-14`), because study rows
 * come from QIDO-RS in one and from a RIS API in the other, and a filter must not care
 * which datasource the row came from.
 */
export function normalizeDate(value: unknown): string | null {
  const raw = text(value);
  if (/^\d{8}$/.test(raw)) {
    return raw;
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}${iso[2]}${iso[3]}` : null;
}

/** Evaluates one criterion against one study. */
export function matchesCriterion(study: FilterableStudy, criterion: FilterCriterion): boolean {
  if (!criterion?.field || !criterion.operator) {
    return true;
  }
  const values = valuesOf(study, criterion.field);

  switch (criterion.operator) {
    case 'isEmpty':
      return values.length === 0;
    case 'notEmpty':
      return values.length > 0;

    case 'contains': {
      const needle = lower(criterion.value);
      // An empty needle matches everything: a half-typed search box must not blank
      // the list before the reader finishes the word.
      return !needle || values.some(v => v.includes(needle));
    }

    case 'equals': {
      const needle = lower(criterion.value);
      return !needle || values.some(v => v === needle);
    }

    case 'anyOf': {
      const list = (Array.isArray(criterion.value) ? criterion.value : [criterion.value])
        .map(v => lower(v))
        .filter(Boolean);
      return !list.length || values.some(v => list.includes(v));
    }

    case 'before':
    case 'after':
    case 'between': {
      const studyDate = normalizeDate(study?.[criterion.field]);
      if (!studyDate) {
        // A row with no date cannot satisfy a date filter. Treating it as a match
        // would quietly pad every date-filtered list with undated studies.
        return false;
      }
      if (criterion.operator === 'before') {
        const to = normalizeDate(criterion.value);
        return to ? studyDate <= to : true;
      }
      if (criterion.operator === 'after') {
        const from = normalizeDate(criterion.value);
        return from ? studyDate >= from : true;
      }
      const [rawFrom, rawTo] = Array.isArray(criterion.value) ? criterion.value : [];
      const from = normalizeDate(rawFrom);
      const to = normalizeDate(rawTo);
      if (from && studyDate < from) {
        return false;
      }
      if (to && studyDate > to) {
        return false;
      }
      return true;
    }

    default:
      return true;
  }
}

/**
 * Evaluates a whole group.
 *
 * An empty group matches everything — "no filter" must not mean "no results". Note
 * this differs from the mathematical convention for an empty OR, and is deliberate:
 * clearing the last chip should show the full worklist, not an empty one.
 */
export function matchesStudy(study: FilterableStudy, group: FilterGroup): boolean {
  const criteria = (group?.criteria ?? []).filter(Boolean);
  if (!criteria.length) {
    return true;
  }
  return group.combinator === 'or'
    ? criteria.some(c => matchesCriterion(study, c))
    : criteria.every(c => matchesCriterion(study, c));
}

/** Applies a group to a list. */
export function filterStudies<T extends FilterableStudy>(studies: T[], group: FilterGroup): T[] {
  return (studies ?? []).filter(s => matchesStudy(s, group));
}

// --- URL state -------------------------------------------------------------

/**
 * Separators. All three MUST be characters that `encodeURIComponent` escapes,
 * otherwise a value containing one silently splits the filter into pieces.
 *
 * `~` was the obvious-looking choice and is wrong: `encodeURIComponent` leaves
 * `- _ . ! ~ * ' ( )` untouched, so a patient name containing a tilde would inject a
 * criterion boundary. `;` `:` `,` all encode to %3B %3A %2C.
 */
const CRITERION_SEPARATOR = ';';
const PART_SEPARATOR = ':';
const VALUE_SEPARATOR = ',';

/**
 * Serialises a group into one query-string value.
 *
 * Compact on purpose — `filter=modality:anyOf:ct,mr;reportStatus:equals:none` survives
 * being pasted into a chat window, which a JSON blob does not. Values are
 * percent-encoded so a patient name with a comma cannot corrupt the parse.
 */
export function serializeFilters(group: FilterGroup): string {
  const criteria = (group?.criteria ?? []).filter(c => c?.field && c?.operator);
  if (!criteria.length) {
    return '';
  }
  const parts = criteria.map(c => {
    const value = Array.isArray(c.value)
      ? c.value.map(v => encodeURIComponent(text(v))).join(VALUE_SEPARATOR)
      : encodeURIComponent(text(c.value));
    return [c.field, c.operator, value].join(PART_SEPARATOR);
  });
  const prefix = group.combinator === 'or' ? 'or|' : '';
  return prefix + parts.join(CRITERION_SEPARATOR);
}

const FIELDS = new Set<FilterField>([
  'patientName',
  'mrn',
  'accession',
  'studyDate',
  'modality',
  'bodyPart',
  'description',
  'reportStatus',
  'priority',
  'assignee',
  'referrer',
  'institution',
]);

const OPERATORS = new Set<FilterOperator>([
  'contains',
  'equals',
  'anyOf',
  'between',
  'before',
  'after',
  'isEmpty',
  'notEmpty',
]);

/**
 * Parses a query-string value back into a group.
 *
 * Unknown fields and operators are **dropped, not rejected**: this string comes from a
 * URL a colleague pasted, possibly from an older build with a field this one no longer
 * has. Showing the rest of their filter beats showing an error.
 */
export function parseFilters(raw: unknown): FilterGroup {
  const input = text(raw);
  if (!input) {
    return emptyFilterGroup();
  }

  let body = input;
  let combinator: FilterCombinator = 'and';
  if (body.startsWith('or|')) {
    combinator = 'or';
    body = body.slice(3);
  } else if (body.startsWith('and|')) {
    body = body.slice(4);
  }

  const criteria: FilterCriterion[] = [];
  for (const chunk of body.split(CRITERION_SEPARATOR)) {
    if (!chunk) {
      continue;
    }
    const [field, operator, ...rest] = chunk.split(PART_SEPARATOR);
    if (!FIELDS.has(field as FilterField) || !OPERATORS.has(operator as FilterOperator)) {
      continue;
    }
    const rawValue = rest.join(PART_SEPARATOR);
    const decoded = rawValue
      .split(VALUE_SEPARATOR)
      .map(v => safeDecode(v))
      .filter(v => v !== '');

    const needsList = operator === 'anyOf' || operator === 'between';
    criteria.push({
      field: field as FilterField,
      operator: operator as FilterOperator,
      value: needsList ? decoded : decoded[0],
    });
  }

  return { combinator, criteria };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape from a hand-edited URL: keep the raw text rather than
    // throwing away the whole filter.
    return value;
  }
}

/** Round-trips a group through the query string, for tests and for `?filter=`. */
export const FILTER_QUERY_KEY = 'filter';

/** Human summary for the active-filter bar. */
export function describeFilters(group: FilterGroup): string {
  const criteria = (group?.criteria ?? []).filter(c => c?.field);
  if (!criteria.length) {
    return 'No filters';
  }
  const joiner = group.combinator === 'or' ? ' or ' : ' and ';
  return criteria.map(describeCriterion).join(joiner);
}

export function describeCriterion(criterion: FilterCriterion): string {
  const field = criterion.field;
  switch (criterion.operator) {
    case 'isEmpty':
      return `${field} is empty`;
    case 'notEmpty':
      return `${field} is set`;
    case 'anyOf':
      return `${field} in ${(Array.isArray(criterion.value) ? criterion.value : []).join(', ')}`;
    case 'between': {
      const [from, to] = Array.isArray(criterion.value) ? criterion.value : [];
      return `${field} ${from ?? '…'}–${to ?? '…'}`;
    }
    case 'before':
      return `${field} before ${text(criterion.value)}`;
    case 'after':
      return `${field} after ${text(criterion.value)}`;
    case 'equals':
      return `${field} = ${text(criterion.value)}`;
    default:
      return `${field} contains "${text(criterion.value)}"`;
  }
}

/** Adds or replaces a criterion for a field, keeping the group otherwise intact. */
export function upsertCriterion(group: FilterGroup, criterion: FilterCriterion): FilterGroup {
  const base = group ?? emptyFilterGroup();
  const criteria = base.criteria.filter(c => c.field !== criterion.field);
  return { ...base, criteria: [...criteria, criterion] };
}

/** Removes every criterion for a field. */
export function removeField(group: FilterGroup, field: FilterField): FilterGroup {
  const base = group ?? emptyFilterGroup();
  return { ...base, criteria: base.criteria.filter(c => c.field !== field) };
}
