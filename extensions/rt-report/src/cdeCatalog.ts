/**
 * Common Data Element catalogue and validation — pure core (RTV-217).
 *
 * A CDE says what a structured finding is allowed to be: its value type, its permitted
 * values, its unit, how many times it may appear. Validating an observation against its
 * element is the difference between a structured report and a JSON blob with codes in it.
 *
 * ## The unit mismatch is the silent one
 *
 * An element that specifies millimetres, given a value measured in centimetres, is wrong by
 * a factor of ten — and both are numbers, both are plausible nodule sizes, and nothing
 * about the record looks broken. It is the single most likely way a structured value goes
 * wrong, because the unit lives in the definition and the number lives in the observation
 * and nobody looks at both.
 *
 * {@link validateObservation} rejects rather than converting silently.
 * {@link convertToElementUnit} exists for the caller that *wants* a conversion, and it
 * returns the conversion it applied so it can be shown — a silent unit conversion is the
 * same failure with a different cause.
 *
 * ## A value set has a version, and a retired code passes the wrong one
 *
 * Codes get retired. A value valid in the 2023 release of an element may be gone in 2025.
 * Validating against whichever version happens to be loaded accepts something that will be
 * rejected downstream, months later, by a system that has the current release.
 *
 * So the element version is part of the identity, and validation reports when the
 * observation was recorded against a different one than the catalogue holds.
 *
 * ## Cardinality is not a formality
 *
 * A single-valued element with two observations is a data error that surfaces as
 * "the last one wins" somewhere unpredictable — in the FHIR export, in the PDF, in a
 * downstream query. It is caught here, where it can still be attributed to the edit that
 * caused it.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type CdeValueType = 'quantity' | 'coded' | 'boolean' | 'text';

export interface CdePermittedValue {
  code: string;
  display: string;
  /** Set when the code has been retired; still resolvable, no longer selectable. */
  retired?: boolean;
}

export interface CdeElement {
  /** RadElement id, e.g. RDE1301. */
  id: string;
  system: string;
  /** Version of the element definition. Part of its identity. */
  version: string;
  name: string;
  valueType: CdeValueType;
  /** Required for `quantity`. UCUM. */
  unit?: string;
  /** Required for `coded`. */
  permittedValues?: CdePermittedValue[];
  /** Minimum and maximum occurrences. */
  cardinality: { min: number; max: number };
  /** Plausible range for a quantity, if the element defines one. */
  range?: { min?: number; max?: number };
  definition?: string;
}

export interface CdeCatalogue {
  elements: CdeElement[];
}

const text = (v: unknown): string => String(v ?? '').trim();

export function findElement(
  catalogue: CdeCatalogue,
  system: string,
  id: string
): CdeElement | undefined {
  const wantedSystem = text(system).toLowerCase();
  const wantedId = text(id).toLowerCase();
  return (catalogue?.elements ?? []).find(
    e => text(e.system).toLowerCase() === wantedSystem && text(e.id).toLowerCase() === wantedId
  );
}

/**
 * UCUM length conversions this module is willing to perform.
 *
 * Deliberately small. A general unit converter invites a conversion between two units that
 * are not actually the same physical quantity, and the failure looks like a plausible
 * number.
 */
const LENGTH_TO_MM: Record<string, number> = { mm: 1, cm: 10, m: 1000 };
const VOLUME_TO_ML: Record<string, number> = { mL: 1, ml: 1, L: 1000, l: 1000, cm3: 1, mm3: 0.001 };

export interface ConversionResult {
  value: number;
  /** Factor applied. 1 when the units already matched. */
  factor: number;
  converted: boolean;
  ok: boolean;
  reason?: string;
}

/**
 * Converts a value to the element's unit, reporting what it did.
 *
 * The factor comes back so it can be shown. A silent unit conversion is the same failure as
 * a silent unit mismatch, arrived at from the other direction.
 */
export function convertToElementUnit(
  value: number,
  fromUnit: string,
  element: CdeElement
): ConversionResult {
  const target = text(element?.unit);
  const source = text(fromUnit);
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return { value: 0, factor: 1, converted: false, ok: false, reason: 'Valor não numérico.' };
  }
  if (!target) {
    return { value: numeric, factor: 1, converted: false, ok: false, reason: 'Elemento sem unidade.' };
  }
  if (source === target) {
    return { value: numeric, factor: 1, converted: false, ok: true };
  }

  for (const table of [LENGTH_TO_MM, VOLUME_TO_ML]) {
    const from = table[source];
    const to = table[target];
    if (from !== undefined && to !== undefined) {
      const factor = from / to;
      return { value: numeric * factor, factor, converted: true, ok: true };
    }
  }

  return {
    value: numeric,
    factor: 1,
    converted: false,
    ok: false,
    reason: `Não há conversão conhecida de "${source}" para "${target}" — as duas podem nem ser a mesma grandeza física.`,
  };
}

export type CdeIssueCode =
  | 'unknownElement'
  | 'versionMismatch'
  | 'wrongValueType'
  | 'unitMismatch'
  | 'valueNotPermitted'
  | 'retiredValue'
  | 'outOfRange'
  | 'cardinalityBelowMin'
  | 'cardinalityAboveMax';

export interface CdeIssue {
  code: CdeIssueCode;
  severity: 'error' | 'warning';
  message: string;
  elementId?: string;
}

export interface ObservationLike {
  concept: { system: string; code: string; systemVersion?: string };
  value:
    | { kind: 'quantity'; value: number; unit: string }
    | { kind: 'coded'; value: { system: string; code: string } }
    | { kind: 'boolean'; value: boolean }
    | { kind: 'text'; value: string };
}

/**
 * Validates one observation against its element definition.
 *
 * Unit mismatch is an **error**, not an automatic conversion — see the module note. The
 * caller that wants the conversion asks for it explicitly and gets the factor back.
 */
export function validateObservation(
  observation: ObservationLike,
  catalogue: CdeCatalogue
): CdeIssue[] {
  const issues: CdeIssue[] = [];
  const system = text(observation?.concept?.system);
  const code = text(observation?.concept?.code);
  const element = findElement(catalogue, system, code);

  if (!element) {
    return [
      {
        code: 'unknownElement',
        severity: 'error',
        message: `Elemento ${system}#${code} não está no catálogo.`,
        elementId: code,
      },
    ];
  }

  const recordedVersion = text(observation?.concept?.systemVersion);
  if (recordedVersion && recordedVersion !== text(element.version)) {
    // Accepts something that will be rejected downstream, months later, by a system with
    // the current release.
    issues.push({
      code: 'versionMismatch',
      severity: 'warning',
      message: `Observação gravada contra a versão ${recordedVersion} do elemento; o catálogo tem ${element.version}. Valores permitidos podem ter mudado.`,
      elementId: element.id,
    });
  }

  const value = observation?.value;
  if (value?.kind !== element.valueType) {
    issues.push({
      code: 'wrongValueType',
      severity: 'error',
      message: `Elemento ${element.id} espera "${element.valueType}" e recebeu "${value?.kind ?? 'nada'}".`,
      elementId: element.id,
    });
    return issues;
  }

  if (value.kind === 'quantity') {
    const unit = text(value.unit);
    if (unit !== text(element.unit)) {
      issues.push({
        code: 'unitMismatch',
        severity: 'error',
        message: `Elemento ${element.id} é definido em "${element.unit}" e o valor veio em "${unit}" — diferença de fator, não de formatação.`,
        elementId: element.id,
      });
    }
    const range = element.range;
    const numeric = Number(value.value);
    if (
      range &&
      ((Number.isFinite(Number(range.min)) && numeric < (range.min as number)) ||
        (Number.isFinite(Number(range.max)) && numeric > (range.max as number)))
    ) {
      issues.push({
        code: 'outOfRange',
        severity: 'warning',
        message: `Valor ${numeric} fora da faixa plausível do elemento ${element.id} (${range.min ?? '-inf'}–${range.max ?? '+inf'}).`,
        elementId: element.id,
      });
    }
  }

  if (value.kind === 'coded') {
    const permitted = element.permittedValues ?? [];
    const match = permitted.find(p => text(p.code) === text(value.value?.code));
    if (!match) {
      issues.push({
        code: 'valueNotPermitted',
        severity: 'error',
        message: `"${text(value.value?.code)}" não está entre os valores permitidos de ${element.id}.`,
        elementId: element.id,
      });
    } else if (match.retired) {
      issues.push({
        code: 'retiredValue',
        severity: 'warning',
        message: `"${match.display}" foi aposentado em ${element.id} — continua resolvível, não deve ser selecionado em laudo novo.`,
        elementId: element.id,
      });
    }
  }

  return issues;
}

/**
 * Checks how many times each element appears.
 *
 * A single-valued element with two observations surfaces as "the last one wins" somewhere
 * unpredictable — the FHIR export, the PDF, a downstream query. Catching it here is what
 * lets it be attributed to the edit that caused it.
 */
export function validateCardinality(
  observations: ObservationLike[],
  catalogue: CdeCatalogue,
  requiredElementIds: string[] = []
): CdeIssue[] {
  const issues: CdeIssue[] = [];
  const counts = new Map<string, number>();

  for (const observation of observations ?? []) {
    const key = `${text(observation?.concept?.system)}#${text(observation?.concept?.code)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const [key, count] of counts) {
    const [system, code] = key.split('#');
    const element = findElement(catalogue, system, code);
    if (!element) {
      continue;
    }
    if (count > element.cardinality.max) {
      issues.push({
        code: 'cardinalityAboveMax',
        severity: 'error',
        message: `Elemento ${element.id} aceita no máximo ${element.cardinality.max} ocorrência(s) e tem ${count} — em algum ponto do fluxo "a última vence" em silêncio.`,
        elementId: element.id,
      });
    }
  }

  for (const id of requiredElementIds) {
    const element = (catalogue?.elements ?? []).find(e => text(e.id) === text(id));
    if (!element) {
      continue;
    }
    const key = `${text(element.system)}#${text(element.id)}`;
    const count = counts.get(key) ?? 0;
    if (count < Math.max(element.cardinality.min, 1)) {
      issues.push({
        code: 'cardinalityBelowMin',
        severity: 'error',
        message: `Elemento obrigatório ${element.id} (${element.name}) não foi preenchido.`,
        elementId: element.id,
      });
    }
  }

  return issues;
}

export interface CatalogueIssue {
  elementId: string;
  message: string;
}

/**
 * Sanity-checks a catalogue before it is used.
 *
 * A quantity element with no unit or a coded element with no permitted values cannot
 * validate anything, and it fails **open** — every observation against it passes. That is
 * worse than a missing element, which at least fails loudly.
 */
export function validateCatalogue(catalogue: CdeCatalogue): CatalogueIssue[] {
  const issues: CatalogueIssue[] = [];
  const seen = new Set<string>();

  for (const element of catalogue?.elements ?? []) {
    const id = text(element?.id);
    const key = `${text(element?.system)}#${id}`;
    if (seen.has(key)) {
      issues.push({ elementId: id, message: 'Elemento duplicado no catálogo.' });
    }
    seen.add(key);

    if (!id || !text(element?.system) || !text(element?.version)) {
      issues.push({ elementId: id, message: 'Elemento sem id, system ou versão.' });
    }
    if (element?.valueType === 'quantity' && !text(element?.unit)) {
      issues.push({
        elementId: id,
        message: 'Elemento de quantidade sem unidade — validaria qualquer número.',
      });
    }
    if (element?.valueType === 'coded' && !(element?.permittedValues ?? []).length) {
      issues.push({
        elementId: id,
        message: 'Elemento codificado sem valores permitidos — validaria qualquer código.',
      });
    }
    const { min, max } = element?.cardinality ?? { min: 0, max: 0 };
    if (!(Number.isFinite(min) && Number.isFinite(max)) || min < 0 || max < 1 || min > max) {
      issues.push({ elementId: id, message: 'Cardinalidade inválida.' });
    }
  }

  return issues;
}

/** One line per issue for the validation panel. */
export function describeIssues(issues: CdeIssue[]): string {
  const errors = (issues ?? []).filter(i => i.severity === 'error');
  const warnings = (issues ?? []).filter(i => i.severity === 'warning');
  if (!errors.length && !warnings.length) {
    return 'Sem problemas de validação CDE.';
  }
  const parts: string[] = [];
  if (errors.length) {
    parts.push(`${errors.length} erro(s): ${errors.map(e => e.message).join(' ')}`);
  }
  if (warnings.length) {
    parts.push(`${warnings.length} aviso(s): ${warnings.map(w => w.message).join(' ')}`);
  }
  return parts.join(' ');
}
