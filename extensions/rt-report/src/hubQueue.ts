/**
 * RTV-222 -- Reporting Hub: view-model / decision core for the "studies awaiting a
 * report" worklist (queues, SLA, priority, report status).
 *
 * This module is deliberately pure: no imports, no DOM, no clock of its own. Every
 * function that needs the current time takes `nowMs` (epoch ms) as a parameter, so the
 * screen, the tests and any server-side rendering all agree on the same instant. A
 * module that reads the wall clock internally cannot be tested for the exact orderings
 * below, and "the badge was right when I looked at it" is the single hardest class of
 * reporting-hub bug to reproduce.
 *
 * WHY THE GUARDS EXIST (named failure modes, all observed-in-the-wild shapes):
 *
 * 1. "Atraso manda na fila" -- ordering by SLA breach first.
 *    If the worklist sorts by "most overdue first", a routine outpatient knee MRI that
 *    has been sitting for three days lands above an emergency head CT that arrived four
 *    minutes ago. Both rows look completely reasonable in isolation: the top row really
 *    is the most overdue row, and the CT really is only four minutes old. Nothing on
 *    screen is wrong, and yet the radiologist opening the list top-down reads the wrong
 *    study first. Fix: clinical urgency (priority band) dominates; SLA only orders
 *    *within* a band. See `hubCompareRows` / `hubSortQueue`.
 *
 * 2. "Achado critico silenciado pela prioridade do pedido" -- an unacknowledged critical
 *    finding on a study whose *order* was routine. The order priority reflects what the
 *    referring physician suspected before the images existed; the critical finding is
 *    what was actually seen. A routine-banded row with an uncommunicated critical finding
 *    is a communication failure, not routine work, so `hubEffectiveRank` promotes it to
 *    the emergency band.
 *
 * 3. "Coluna de status unica esconde trabalho" -- a study can be awaiting a signature AND
 *    carrying an unacknowledged critical finding AND missing its prior study, all at the
 *    same time. A single-status column must pick one, and whichever it picks, the other
 *    states vanish from the counts; nobody notices, because the number that is shown is
 *    itself correct. Status is therefore a SET of concurrent flags, and
 *    `hubCountFlags` returns per-flag counts that intentionally do NOT sum to the row
 *    count, plus a message saying exactly that.
 *
 * 4. "SLA fantasma pelo relogio errado" -- the SLA reference clock must be chosen, never
 *    defaulted. Time since the order was placed, time since the images arrived and time
 *    since the study was assigned are three different numbers, and they diverge most for
 *    exactly the studies people care about: an urgent order whose images only landed an
 *    hour later reads as "4 min" on the images clock and "64 min" on the order clock. A
 *    silent fallback to whichever timestamp happens to be present under-reports the
 *    breach on the worst rows. `hubComputeSla` requires an explicit reference and refuses
 *    when that specific timestamp is absent, instead of substituting another one.
 *
 * 5. "Fila pessoal nunca mostra o pior estado" -- an unassigned urgent study appears in
 *    nobody's personal queue by construction: every per-user filter is
 *    `assignedTo === me`, and these rows have no `assignedTo` at all. They are invisible
 *    precisely because they are unowned. `hubFindUnassignedUrgent` runs over the
 *    department queue and returns the reason a per-user queue structurally cannot find
 *    them.
 *
 * 6. "Contagem filtrada lida como numero do departamento" -- with a modality filter
 *    active, the "12 atrasados" badge means 12 in this filter. Spoken out loud in a
 *    huddle it becomes a department number and staffing decisions follow. Every summary
 *    carries its filter context and says which of the two it is; `hubSummarizeQueue`
 *    refuses to produce a count with no filter context attached.
 *
 * 7. "NaN embaralha a fila" -- a NaN in `nowMs` or in a timestamp makes every comparison
 *    false, and a comparator that answers 0 for every pair leaves an arbitrary order that
 *    still looks plausible. Guards refuse non-finite / non-positive clocks up front, and
 *    `hubCompareRows` never returns NaN even if it is called directly with garbage.
 *
 * 8. "Prioridade ausente virando rotina" -- an interface message that omits the priority
 *    field must not be coerced to routine, which is the same as demoting an emergency in
 *    silence. Unknown priority is refused at validation; the modelled `unspecified` band
 *    sorts above routine and is labelled as needing verification.
 *
 * All user-facing strings are Brazilian Portuguese; identifiers, types and comments are
 * English. Refusals are returned as values, never thrown.
 */

/* ------------------------------------------------------------------ *
 * Outcome type: refusals are values.
 * ------------------------------------------------------------------ */

/**
 * Both members declare both keys (one of them always as `undefined`) so that reading
 * `.reason` / `.value` compiles in packages built with `strictNullChecks` disabled, where
 * a boolean-literal discriminant does not narrow the union. Without this, the refusal
 * plumbing would only typecheck under strict settings.
 */
export type HubOutcome<T> =
  | { ok: true; value: T; reason?: undefined }
  | { ok: false; reason: string; value?: undefined };

function accept<T>(value: T): HubOutcome<T> {
  return { ok: true, value };
}

function decline<T>(reason: string): HubOutcome<T> {
  return { ok: false, reason };
}

/* ------------------------------------------------------------------ *
 * Priorities.
 * ------------------------------------------------------------------ */

export type HubPriority = 'stat' | 'urgent' | 'unspecified' | 'routine';

export const HUB_PRIORITIES: readonly HubPriority[] = ['stat', 'urgent', 'unspecified', 'routine'];

/**
 * Lower rank wins. `unspecified` deliberately sits ABOVE `routine`: a missing priority
 * field is an unknown, and treating an unknown as routine is a silent demotion.
 */
export const HUB_PRIORITY_RANK: Readonly<Record<HubPriority, number>> = {
  stat: 0,
  urgent: 1,
  unspecified: 2,
  routine: 3,
};

export const HUB_PRIORITY_LABELS: Readonly<Record<HubPriority, string>> = {
  stat: 'Emergência (STAT)',
  urgent: 'Urgente',
  unspecified: 'Prioridade não informada (verificar pedido)',
  routine: 'Rotina',
};

/** Priorities that must never be treated as routine when hunting for unowned work. */
export const HUB_ESCALATION_PRIORITIES: readonly HubPriority[] = ['stat', 'urgent', 'unspecified'];

/* ------------------------------------------------------------------ *
 * Report status: a SET of concurrent flags, never one column.
 * ------------------------------------------------------------------ */

export type HubReportFlag =
  | 'awaitingAssignment'
  | 'awaitingDictation'
  | 'draftUnsigned'
  | 'awaitingSignature'
  | 'awaitingPeerReview'
  | 'addendumRequested'
  | 'criticalFindingUnacknowledged'
  | 'priorStudyMissing';

export const HUB_REPORT_FLAGS: readonly HubReportFlag[] = [
  'awaitingAssignment',
  'awaitingDictation',
  'draftUnsigned',
  'awaitingSignature',
  'awaitingPeerReview',
  'addendumRequested',
  'criticalFindingUnacknowledged',
  'priorStudyMissing',
];

export const HUB_FLAG_LABELS: Readonly<Record<HubReportFlag, string>> = {
  awaitingAssignment: 'Aguardando atribuição',
  awaitingDictation: 'Aguardando ditado',
  draftUnsigned: 'Rascunho não assinado',
  awaitingSignature: 'Aguardando assinatura',
  awaitingPeerReview: 'Aguardando revisão por pares',
  addendumRequested: 'Adendo solicitado',
  criticalFindingUnacknowledged: 'Achado crítico não comunicado',
  priorStudyMissing: 'Exame anterior indisponível',
};

/** The one flag that overrides the order priority band. */
export const HUB_CRITICAL_FLAG: HubReportFlag = 'criticalFindingUnacknowledged';

/* ------------------------------------------------------------------ *
 * SLA reference clocks.
 * ------------------------------------------------------------------ */

export type HubSlaReference = 'orderPlaced' | 'imagesArrived' | 'assigned';

export const HUB_SLA_REFERENCES: readonly HubSlaReference[] = ['orderPlaced', 'imagesArrived', 'assigned'];

/** Reference labels, written to be readable inside a sentence. */
export const HUB_SLA_LABELS: Readonly<Record<HubSlaReference, string>> = {
  orderPlaced: 'desde o pedido médico',
  imagesArrived: 'desde a chegada das imagens',
  assigned: 'desde a atribuição ao radiologista',
};

export const HUB_SLA_CLOCK_FIELD: Readonly<Record<HubSlaReference, keyof HubRowClocks>> = {
  orderPlaced: 'orderPlacedAt',
  imagesArrived: 'imagesArrivedAt',
  assigned: 'assignedAt',
};

/**
 * Workstation vs modality vs PACS clocks drift by seconds routinely. A reference stamp a
 * few seconds in the future is skew, not a data defect, so it is clamped to zero elapsed;
 * anything beyond this tolerance is refused, because a negative elapsed silently renders
 * as "within target" forever.
 */
export const HUB_CLOCK_SKEW_TOLERANCE_MS = 60_000;

/* ------------------------------------------------------------------ *
 * Row shape.
 * ------------------------------------------------------------------ */

export interface HubRowClocks {
  orderPlacedAt?: number | null;
  imagesArrivedAt?: number | null;
  assignedAt?: number | null;
}

/**
 * `flags` is typed as `readonly string[]` on purpose: it arrives from the backend, and a
 * newer server may send a flag this build does not know about. Dropping such a flag
 * silently would hide work, so unknown values are collected and reported rather than
 * discarded (see `hubCountFlags`, `hubValidateRow`).
 */
export interface HubQueueRow {
  studyKey: string;
  queueKey: string;
  modality: string;
  priority: HubPriority;
  flags: readonly string[];
  clocks: HubRowClocks;
  slaTargetMinutes: number;
  assignedTo?: string | null;
  patientLabel?: string | null;
}

export interface HubNormalizedRow extends HubQueueRow {
  flags: readonly HubReportFlag[];
  /** Flag strings this build does not recognise; surfaced, never dropped. */
  unknownFlags: readonly string[];
}

/* ------------------------------------------------------------------ *
 * Validation.
 * ------------------------------------------------------------------ */

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isUsableInstant(value: unknown): value is number {
  // A zero / negative epoch comes from an uninitialised field and would render as
  // "56 anos de atraso" on every affected row, which reads as a rendering bug and gets
  // ignored -- taking the real breaches with it.
  return isFiniteNumber(value) && value > 0;
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function hubHasFlag(row: HubQueueRow, flag: HubReportFlag): boolean {
  const flags = Array.isArray(row?.flags) ? row.flags : [];
  for (let i = 0; i < flags.length; i += 1) {
    if (flags[i] === flag) {
      return true;
    }
  }
  return false;
}

export function hubIsAssigned(row: HubQueueRow): boolean {
  return trimmed(row?.assignedTo).length > 0;
}

/**
 * Normalises one row, refusing anything that would quietly corrupt an ordering or a
 * count. Nothing here is coerced to a "safe" default: coercion is what turns a broken
 * interface message into a plausible-looking row.
 */
export function hubValidateRow(row: HubQueueRow): HubOutcome<HubNormalizedRow> {
  if (row === null || typeof row !== 'object') {
    return decline('Linha inválida na fila: registro ausente ou fora do formato esperado.');
  }

  // Two rows sharing an empty key collapse into one another in any keyed rendering and in
  // any de-duplication step: one of the studies disappears from the worklist entirely.
  const studyKey = trimmed(row.studyKey);
  if (studyKey.length === 0) {
    return decline('Exame sem identificador: a linha seria confundida com outra e sairia da lista.');
  }

  // Unknown priority is NOT coerced to routine: that demotes an emergency in silence.
  if (HUB_PRIORITIES.indexOf(row.priority) === -1) {
    return decline(
      `Prioridade desconhecida no exame ${studyKey}: sem prioridade válida a linha seria tratada como rotina e perderia a frente da fila.`
    );
  }

  // A non-positive or non-numeric SLA target makes every row breach at once; a badge that
  // says "100% atrasado" stops being read at all (fadiga de alarme).
  if (!isFiniteNumber(row.slaTargetMinutes) || row.slaTargetMinutes <= 0) {
    return decline(
      `Meta de SLA inválida no exame ${studyKey}: com meta ausente ou zero todos os exames apareceriam atrasados e a marcação perderia sentido.`
    );
  }

  const clocks: HubRowClocks = {};
  const clockNames: (keyof HubRowClocks)[] = ['orderPlacedAt', 'imagesArrivedAt', 'assignedAt'];
  for (let i = 0; i < clockNames.length; i += 1) {
    const name = clockNames[i];
    const raw = row.clocks ? row.clocks[name] : undefined;
    if (raw === undefined || raw === null) {
      continue;
    }
    if (!isUsableInstant(raw)) {
      return decline(
        `Marca de tempo inválida (${name}) no exame ${studyKey}: um instante não numérico contamina o cálculo de SLA e embaralha a ordenação sem erro visível.`
      );
    }
    clocks[name] = raw;
  }

  const flags: HubReportFlag[] = [];
  const unknownFlags: string[] = [];
  const rawFlags = Array.isArray(row.flags) ? row.flags : [];
  for (let i = 0; i < rawFlags.length; i += 1) {
    const value = trimmed(rawFlags[i]);
    if (value.length === 0) {
      continue;
    }
    if (HUB_REPORT_FLAGS.indexOf(value as HubReportFlag) === -1) {
      // Unknown flag from a newer backend: kept visible instead of dropped.
      if (unknownFlags.indexOf(value) === -1) {
        unknownFlags.push(value);
      }
      continue;
    }
    // A duplicated flag would double-count one single study in the per-flag badges.
    if (flags.indexOf(value as HubReportFlag) === -1) {
      flags.push(value as HubReportFlag);
    }
  }

  return accept({
    ...row,
    studyKey,
    queueKey: trimmed(row.queueKey),
    modality: trimmed(row.modality),
    assignedTo: trimmed(row.assignedTo).length > 0 ? trimmed(row.assignedTo) : null,
    clocks,
    flags,
    unknownFlags,
  });
}

export function hubValidateRows(rows: readonly HubQueueRow[]): HubOutcome<HubNormalizedRow[]> {
  if (!Array.isArray(rows)) {
    return decline('Fila inválida: era esperada uma lista de exames.');
  }
  const out: HubNormalizedRow[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const outcome = hubValidateRow(rows[i]);
    if (!outcome.ok) {
      return decline(`Fila rejeitada na posição ${i}: ${outcome.reason}`);
    }
    out.push(outcome.value);
  }
  return accept(out);
}

/* ------------------------------------------------------------------ *
 * SLA computation. The reference clock is explicit and required.
 * ------------------------------------------------------------------ */

export interface HubSlaOptions {
  nowMs: number;
  /** Required. There is no default clock: see failure mode 4 in the module header. */
  reference: HubSlaReference;
}

export interface HubSlaState {
  reference: HubSlaReference;
  referenceLabel: string;
  referenceAt: number;
  elapsedMinutes: number;
  targetMinutes: number;
  /** Negative when breached. */
  remainingMinutes: number;
  overdueMinutes: number;
  breached: boolean;
  /** True when a small clock skew was clamped to zero elapsed instead of refused. */
  skewClamped: boolean;
  label: string;
}

export function hubValidateSlaOptions(options: HubSlaOptions): HubOutcome<HubSlaOptions> {
  if (options === null || typeof options !== 'object') {
    return decline('Cálculo de SLA sem parâmetros: informe o instante atual e o relógio de referência.');
  }
  if (!isUsableInstant(options.nowMs)) {
    return decline(
      'Instante atual inválido: sem um "agora" numérico o SLA e a ordenação ficam indefinidos e a fila aparece em ordem arbitrária.'
    );
  }
  // Refusing here is the whole point of failure mode 4: no implicit fallback clock.
  if (HUB_SLA_REFERENCES.indexOf(options.reference) === -1) {
    return decline(
      'Relógio de referência do SLA não informado: tempo desde o pedido, desde a chegada das imagens e desde a atribuição são números diferentes, e escolher um deles por conta própria subestima justamente os exames urgentes cujas imagens demoraram.'
    );
  }
  return accept(options);
}

export function hubComputeSla(row: HubQueueRow, options: HubSlaOptions): HubOutcome<HubSlaState> {
  const validOptions = hubValidateSlaOptions(options);
  if (!validOptions.ok) {
    return decline(validOptions.reason);
  }
  const validRow = hubValidateRow(row);
  if (!validRow.ok) {
    return decline(validRow.reason);
  }

  const normalized = validRow.value;
  const reference = validOptions.value.reference;
  const nowMs = validOptions.value.nowMs;
  const field = HUB_SLA_CLOCK_FIELD[reference];
  const referenceAt = normalized.clocks[field];

  // The chosen clock is missing on THIS row. Substituting another timestamp would report
  // a smaller elapsed time than the truth on exactly the rows that matter.
  if (!isUsableInstant(referenceAt)) {
    return decline(
      `Exame ${normalized.studyKey} sem a marca de tempo "${field}": o SLA ${HUB_SLA_LABELS[reference]} não pode ser calculado e não será substituído por outro relógio.`
    );
  }

  let elapsedMs = nowMs - referenceAt;
  let skewClamped = false;
  if (elapsedMs < 0) {
    if (-elapsedMs <= HUB_CLOCK_SKEW_TOLERANCE_MS) {
      // Small skew between modality/PACS and workstation: clamp, do not hide the row.
      elapsedMs = 0;
      skewClamped = true;
    } else {
      // Beyond tolerance this is a wrong timestamp, and a negative elapsed would leave the
      // row permanently "dentro da meta" no matter how long it actually waits.
      return decline(
        `Exame ${normalized.studyKey} com referência de SLA no futuro (${field}): o tempo decorrido ficaria negativo e a linha apareceria eternamente dentro da meta.`
      );
    }
  }

  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  const targetMinutes = normalized.slaTargetMinutes;
  const remainingMinutes = targetMinutes - elapsedMinutes;
  const breached = remainingMinutes < 0;
  const overdueMinutes = breached ? -remainingMinutes : 0;

  const label = breached
    ? `SLA estourado em ${hubFormatMinutes(overdueMinutes)} (meta de ${hubFormatMinutes(targetMinutes)} ${HUB_SLA_LABELS[reference]})`
    : `${hubFormatMinutes(remainingMinutes)} restantes (meta de ${hubFormatMinutes(targetMinutes)} ${HUB_SLA_LABELS[reference]})`;

  return accept({
    reference,
    referenceLabel: HUB_SLA_LABELS[reference],
    referenceAt,
    elapsedMinutes,
    targetMinutes,
    remainingMinutes,
    overdueMinutes,
    breached,
    skewClamped,
    label,
  });
}

/** Duration formatter for the readouts. Input is whole minutes, never negative here. */
export function hubFormatMinutes(minutes: number): string {
  if (!isFiniteNumber(minutes)) {
    return 'tempo indisponível';
  }
  const total = Math.max(0, Math.floor(minutes));
  if (total < 60) {
    return `${total}min`;
  }
  if (total < 1440) {
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}min`;
  }
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

/* ------------------------------------------------------------------ *
 * Ordering. Clinical urgency dominates; SLA orders only inside a band.
 * ------------------------------------------------------------------ */

/**
 * Band rank actually used for ordering. An unacknowledged critical finding lifts the row
 * into the emergency band regardless of the order priority (failure mode 2).
 */
export function hubEffectiveRank(row: HubQueueRow): number {
  const declared = HUB_PRIORITY_RANK[row?.priority as HubPriority];
  const base = typeof declared === 'number' ? declared : HUB_PRIORITY_RANK.unspecified;
  return hubHasFlag(row, HUB_CRITICAL_FLAG) ? Math.min(base, HUB_PRIORITY_RANK.stat) : base;
}

export type HubOrderOptions = HubSlaOptions;

/**
 * Total order over two rows. Never returns NaN, even when called directly with a broken
 * `nowMs`: an inconsistent comparator makes `Array.prototype.sort` produce an arbitrary
 * order that still looks plausible on screen (failure mode 7). With an unusable clock the
 * comparator degrades to priority-only ordering instead of lying about the SLA.
 */
export function hubCompareRows(a: HubQueueRow, b: HubQueueRow, options: HubOrderOptions): number {
  const rankA = hubEffectiveRank(a);
  const rankB = hubEffectiveRank(b);
  if (rankA !== rankB) {
    return rankA - rankB;
  }

  const slaA = hubComputeSla(a, options);
  const slaB = hubComputeSla(b, options);

  // Rows whose SLA cannot be measured go to the TOP of their band: an unmeasurable SLA
  // may be arbitrarily overdue and nobody can tell, so burying it at the bottom of the
  // band is the same as never triaging it.
  const measurableA = slaA.ok ? 1 : 0;
  const measurableB = slaB.ok ? 1 : 0;
  if (measurableA !== measurableB) {
    return measurableA - measurableB;
  }

  if (slaA.ok && slaB.ok) {
    // Most negative remaining time (deepest breach) first, then closest to the deadline.
    if (slaA.value.remainingMinutes !== slaB.value.remainingMinutes) {
      return slaA.value.remainingMinutes - slaB.value.remainingMinutes;
    }
    if (slaA.value.elapsedMinutes !== slaB.value.elapsedMinutes) {
      return slaB.value.elapsedMinutes - slaA.value.elapsedMinutes;
    }
  }

  const keyA = trimmed(a?.studyKey);
  const keyB = trimmed(b?.studyKey);
  if (keyA < keyB) {
    return -1;
  }
  if (keyA > keyB) {
    return 1;
  }
  return 0;
}

export interface HubSortedQueue {
  rows: HubNormalizedRow[];
  /** Study keys whose SLA could not be measured with the chosen reference clock. */
  unmeasurableKeys: string[];
  unmeasurableNote: string;
  orderingNote: string;
}

export const HUB_ORDERING_NOTE =
  'Ordenação por urgência clínica primeiro; o atraso de SLA ordena apenas dentro da mesma faixa de prioridade. Uma lista ordenada só por "mais atrasado" colocaria uma rotina de três dias acima de uma emergência de quatro minutos.';

export function hubSortQueue(rows: readonly HubQueueRow[], options: HubOrderOptions): HubOutcome<HubSortedQueue> {
  const validOptions = hubValidateSlaOptions(options);
  if (!validOptions.ok) {
    return decline(validOptions.reason);
  }
  const validRows = hubValidateRows(rows);
  if (!validRows.ok) {
    return decline(validRows.reason);
  }

  const normalized = validRows.value;
  const decorated = normalized.map((row, index) => ({ row, index }));
  decorated.sort((left, right) => {
    const byRule = hubCompareRows(left.row, right.row, validOptions.value);
    return byRule !== 0 ? byRule : left.index - right.index;
  });

  const sorted = decorated.map(entry => entry.row);
  const unmeasurableKeys: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (!hubComputeSla(sorted[i], validOptions.value).ok) {
      unmeasurableKeys.push(sorted[i].studyKey);
    }
  }

  const unmeasurableNote =
    unmeasurableKeys.length === 0
      ? 'Todos os exames têm SLA calculável com o relógio escolhido.'
      : `${unmeasurableKeys.length} exame(s) sem SLA calculável ${HUB_SLA_LABELS[validOptions.value.reference]}; aparecem no topo da própria faixa de prioridade porque o atraso real é desconhecido.`;

  return accept({
    rows: sorted,
    unmeasurableKeys,
    unmeasurableNote,
    orderingNote: HUB_ORDERING_NOTE,
  });
}

/* ------------------------------------------------------------------ *
 * Concurrent-flag counts that deliberately do not sum to the row count.
 * ------------------------------------------------------------------ */

export const HUB_COUNTS_DISCLAIMER =
  'Um mesmo exame pode estar em mais de um marcador ao mesmo tempo (por exemplo aguardando assinatura e com achado crítico não comunicado), portanto a soma dos marcadores não é o total de exames.';

export interface HubBucketCounts {
  rowCount: number;
  flagCounts: Readonly<Record<HubReportFlag, number>>;
  /** Sum of `flagCounts`. Almost never equal to `rowCount`; that is intentional. */
  flagTotal: number;
  rowsWithMultipleFlags: number;
  rowsWithoutFlags: number;
  unknownFlags: string[];
  countsSumNote: string;
  unknownFlagsNote: string;
}

export function hubCountFlags(rows: readonly HubQueueRow[]): HubOutcome<HubBucketCounts> {
  const validRows = hubValidateRows(rows);
  if (!validRows.ok) {
    return decline(validRows.reason);
  }
  const normalized = validRows.value;

  const flagCounts: Record<HubReportFlag, number> = {
    awaitingAssignment: 0,
    awaitingDictation: 0,
    draftUnsigned: 0,
    awaitingSignature: 0,
    awaitingPeerReview: 0,
    addendumRequested: 0,
    criticalFindingUnacknowledged: 0,
    priorStudyMissing: 0,
  };

  let rowsWithMultipleFlags = 0;
  let rowsWithoutFlags = 0;
  const unknownFlags: string[] = [];

  for (let i = 0; i < normalized.length; i += 1) {
    const row = normalized[i];
    for (let f = 0; f < row.flags.length; f += 1) {
      flagCounts[row.flags[f]] += 1;
    }
    if (row.flags.length === 0) {
      rowsWithoutFlags += 1;
    }
    if (row.flags.length > 1) {
      rowsWithMultipleFlags += 1;
    }
    for (let u = 0; u < row.unknownFlags.length; u += 1) {
      if (unknownFlags.indexOf(row.unknownFlags[u]) === -1) {
        unknownFlags.push(row.unknownFlags[u]);
      }
    }
  }

  let flagTotal = 0;
  for (let i = 0; i < HUB_REPORT_FLAGS.length; i += 1) {
    flagTotal += flagCounts[HUB_REPORT_FLAGS[i]];
  }

  const countsSumNote = `${HUB_COUNTS_DISCLAIMER} Soma dos marcadores: ${flagTotal}; exames na lista: ${normalized.length}; exames em mais de um marcador: ${rowsWithMultipleFlags}.`;

  const unknownFlagsNote =
    unknownFlags.length === 0
      ? 'Nenhum marcador desconhecido recebido do servidor.'
      : `Marcadores desconhecidos recebidos do servidor e não contabilizados nas colunas: ${unknownFlags.join(', ')}. Atualize a tela antes de usar estas contagens.`;

  return accept({
    rowCount: normalized.length,
    flagCounts,
    flagTotal,
    rowsWithMultipleFlags,
    rowsWithoutFlags,
    unknownFlags,
    countsSumNote,
    unknownFlagsNote,
  });
}

/* ------------------------------------------------------------------ *
 * The worst state: urgent and unassigned.
 * ------------------------------------------------------------------ */

export const HUB_UNASSIGNED_URGENT_NOTE =
  'Exames urgentes sem radiologista atribuído não aparecem em nenhuma fila pessoal: toda fila por responsável filtra por "atribuído a mim" e exclui exatamente os exames que não têm responsável. Esta busca só funciona sobre a fila do departamento, sem filtro de responsável.';

export interface HubEscalationReport {
  rows: HubNormalizedRow[];
  keys: string[];
  count: number;
  reason: string;
  headline: string;
}

export function hubFindUnassignedUrgent(rows: readonly HubQueueRow[]): HubOutcome<HubEscalationReport> {
  const validRows = hubValidateRows(rows);
  if (!validRows.ok) {
    return decline(validRows.reason);
  }

  const found: HubNormalizedRow[] = [];
  for (let i = 0; i < validRows.value.length; i += 1) {
    const row = validRows.value[i];
    const escalated =
      HUB_ESCALATION_PRIORITIES.indexOf(row.priority) !== -1 || hubHasFlag(row, HUB_CRITICAL_FLAG);
    if (escalated && !hubIsAssigned(row)) {
      found.push(row);
    }
  }

  const keys = found.map(row => row.studyKey);
  const headline =
    found.length === 0
      ? 'Nenhum exame urgente sem responsável nesta lista.'
      : `${found.length} exame(s) urgente(s) sem responsável: ${keys.join(', ')}.`;

  return accept({
    rows: found,
    keys,
    count: found.length,
    reason: HUB_UNASSIGNED_URGENT_NOTE,
    headline,
  });
}

/* ------------------------------------------------------------------ *
 * Summary. A count always carries its filter context.
 * ------------------------------------------------------------------ */

export interface HubFilterContext {
  /** Human-readable description of the active filter, in Portuguese. */
  label: string;
  modality?: string | null;
  queueKey?: string | null;
  assignedTo?: string | null;
}

export function hubIsFiltered(filter: HubFilterContext): boolean {
  if (filter === null || typeof filter !== 'object') {
    return false;
  }
  return (
    trimmed(filter.modality).length > 0 ||
    trimmed(filter.queueKey).length > 0 ||
    trimmed(filter.assignedTo).length > 0
  );
}

export interface HubSummaryOptions extends HubSlaOptions {
  /** Required: a count with no filter context is read as a department count. */
  filter: HubFilterContext;
}

export interface HubQueueSummary {
  rowCount: number;
  scope: 'department' | 'filtered';
  scopeMessage: string;
  filterLabel: string;
  slaReference: HubSlaReference;
  referenceNote: string;
  breachedCount: number;
  breachedBadge: string;
  unmeasurableCount: number;
  unmeasurableNote: string;
  escalationCount: number;
  unassignedUrgentCount: number;
  unassignedUrgentNote: string;
  buckets: HubBucketCounts;
}

export function hubSummarizeQueue(
  rows: readonly HubQueueRow[],
  options: HubSummaryOptions
): HubOutcome<HubQueueSummary> {
  const validOptions = hubValidateSlaOptions(options);
  if (!validOptions.ok) {
    return decline(validOptions.reason);
  }

  const filter = options ? options.filter : undefined;
  // Failure mode 6: without the filter context the badge "12 atrasados" leaves the screen
  // as a department number in a verbal handoff, and staffing follows the wrong figure.
  if (filter === null || filter === undefined || typeof filter !== 'object') {
    return decline(
      'Resumo sem contexto de filtro: uma contagem com filtro aplicado não é a contagem do departamento e não pode ser exibida sem dizer a qual recorte se refere.'
    );
  }

  const filtered = hubIsFiltered(filter);
  const label = trimmed(filter.label);
  // A filter with no readable description produces a badge nobody can qualify out loud.
  if (filtered && label.length === 0) {
    return decline(
      'Filtro ativo sem descrição legível: a contagem seria lida como número do departamento. Informe o rótulo do filtro aplicado.'
    );
  }

  const buckets = hubCountFlags(rows);
  if (!buckets.ok) {
    return decline(buckets.reason);
  }
  const validRows = hubValidateRows(rows);
  if (!validRows.ok) {
    return decline(validRows.reason);
  }
  const escalation = hubFindUnassignedUrgent(rows);
  if (!escalation.ok) {
    return decline(escalation.reason);
  }

  let breachedCount = 0;
  let unmeasurableCount = 0;
  let escalationCount = 0;
  for (let i = 0; i < validRows.value.length; i += 1) {
    const row = validRows.value[i];
    if (hubEffectiveRank(row) <= HUB_PRIORITY_RANK.urgent) {
      escalationCount += 1;
    }
    const sla = hubComputeSla(row, validOptions.value);
    if (!sla.ok) {
      unmeasurableCount += 1;
      continue;
    }
    if (sla.value.breached) {
      breachedCount += 1;
    }
  }

  const scopeMessage = filtered
    ? `Contagens referentes ao filtro ativo (${label}), não ao departamento.`
    : 'Contagens referentes a toda a fila do departamento carregada nesta tela.';

  const breachedBadge = filtered
    ? `${breachedCount} atrasado(s) no filtro "${label}"`
    : `${breachedCount} atrasado(s) na fila do departamento`;

  const unmeasurableNote =
    unmeasurableCount === 0
      ? 'Todos os exames desta contagem têm SLA calculável.'
      : `${unmeasurableCount} exame(s) fora da contagem de atraso por falta da marca de tempo ${HUB_SLA_LABELS[validOptions.value.reference]}: não são "dentro da meta", são desconhecidos.`;

  return accept({
    rowCount: validRows.value.length,
    scope: filtered ? 'filtered' : 'department',
    scopeMessage,
    filterLabel: filtered ? label : 'sem filtro',
    slaReference: validOptions.value.reference,
    referenceNote: `SLA medido ${HUB_SLA_LABELS[validOptions.value.reference]}; outro relógio produziria outros números para os mesmos exames.`,
    breachedCount,
    breachedBadge,
    unmeasurableCount,
    unmeasurableNote,
    escalationCount,
    unassignedUrgentCount: escalation.value.count,
    unassignedUrgentNote: escalation.value.reason,
    buckets: buckets.value,
  });
}

/* ------------------------------------------------------------------ *
 * One-line readouts.
 * ------------------------------------------------------------------ */

/**
 * Single-line readout for one row. Never refuses: a row whose SLA cannot be measured must
 * still be readable on screen, and it says so in words instead of showing a blank or a
 * zero that would pass for "dentro da meta".
 */
export function hubDescribeRow(row: HubQueueRow, options: HubSlaOptions): string {
  const validRow = hubValidateRow(row);
  if (!validRow.ok) {
    return `Linha não exibível: ${validRow.reason}`;
  }
  const normalized = validRow.value;
  const parts: string[] = [];

  parts.push(normalized.studyKey);
  if (trimmed(normalized.modality).length > 0) {
    parts.push(normalized.modality);
  }
  parts.push(HUB_PRIORITY_LABELS[normalized.priority]);

  const sla = hubComputeSla(normalized, options);
  parts.push(sla.ok ? sla.value.label : `SLA não calculável: ${sla.reason}`);

  const flagLabels = normalized.flags.map(flag => HUB_FLAG_LABELS[flag]);
  parts.push(flagLabels.length > 0 ? flagLabels.join(' + ') : 'Sem pendências registradas');

  if (normalized.unknownFlags.length > 0) {
    parts.push(`marcadores desconhecidos: ${normalized.unknownFlags.join(', ')}`);
  }

  parts.push(
    hubIsAssigned(normalized)
      ? `responsável: ${normalized.assignedTo}`
      : 'sem responsável (não aparece em fila pessoal)'
  );

  return parts.join(' | ');
}

/** Single-line readout for the summary, always carrying the filter scope. */
export function hubDescribeSummary(summary: HubQueueSummary): string {
  return [
    `${summary.rowCount} exame(s)`,
    summary.breachedBadge,
    `${summary.unassignedUrgentCount} urgente(s) sem responsável`,
    summary.scopeMessage,
    summary.buckets.countsSumNote,
  ].join(' | ');
}
