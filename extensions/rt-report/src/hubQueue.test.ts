import {
  HUB_CLOCK_SKEW_TOLERANCE_MS,
  HUB_PRIORITY_RANK,
  hubCompareRows,
  hubComputeSla,
  hubCountFlags,
  hubDescribeRow,
  hubDescribeSummary,
  hubEffectiveRank,
  hubFindUnassignedUrgent,
  hubFormatMinutes,
  hubIsFiltered,
  hubSortQueue,
  hubSummarizeQueue,
  hubValidateRow,
  type HubFilterContext,
  type HubOutcome,
  type HubPriority,
  type HubQueueRow,
  type HubSlaOptions,
  type HubSlaReference,
} from './hubQueue';

const T0 = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function makeRow(overrides: Partial<HubQueueRow> & { studyKey: string }): HubQueueRow {
  return {
    queueKey: 'neuro',
    modality: 'CT',
    priority: 'routine',
    flags: [],
    clocks: { orderPlacedAt: T0 - 10 * MIN },
    slaTargetMinutes: 60,
    assignedTo: 'dra.souza',
    patientLabel: 'PAC-1',
    ...overrides,
  };
}

const ORDER_CLOCK: HubSlaOptions = { nowMs: T0, reference: 'orderPlaced' };

function unwrap<T>(outcome: HubOutcome<T>): T {
  const loose = outcome as { ok: boolean; value?: T; reason?: string };
  if (!loose.ok) {
    throw new Error(`expected ok outcome, got refusal: ${String(loose.reason)}`);
  }
  return loose.value as T;
}

/** Reads the message off a refusal without relying on narrowing in the test tsconfig. */
function reasonOf(outcome: { ok: boolean; reason?: string }): string {
  if (outcome.ok) {
    throw new Error('expected a refusal outcome, got an ok outcome');
  }
  return String(outcome.reason);
}

describe('hubValidateRow', () => {
  it('accepts a well-formed row and normalises trimmed fields', () => {
    const outcome = hubValidateRow(makeRow({ studyKey: '  ST-1  ', assignedTo: '  dr.lima ' }));
    const row = unwrap(outcome);
    expect(row.studyKey).toBe('ST-1');
    expect(row.assignedTo).toBe('dr.lima');
  });

  // Two rows with an empty key collapse into one another and one study leaves the list.
  it('refuses a row without a study identifier', () => {
    const outcome = hubValidateRow(makeRow({ studyKey: '   ' }));
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toContain('sem identificador');
  });

  // An HL7 order missing the priority field must not be silently demoted to routine.
  it('refuses an unknown priority instead of coercing it to routine', () => {
    const outcome = hubValidateRow(
      makeRow({ studyKey: 'ST-2', priority: 'whatever' as unknown as HubPriority })
    );
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toContain('Prioridade desconhecida');
  });

  // A zero SLA target makes every row breach at once and the badge stops being believed.
  it('refuses a non-positive SLA target', () => {
    const outcome = hubValidateRow(makeRow({ studyKey: 'ST-3', slaTargetMinutes: 0 }));
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toContain('Meta de SLA inválida');
  });

  // A NaN timestamp poisons every comparison without producing any visible error.
  it('refuses a non-finite timestamp', () => {
    const outcome = hubValidateRow(makeRow({ studyKey: 'ST-4', clocks: { orderPlacedAt: Number.NaN } }));
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toContain('Marca de tempo inválida');
  });

  // A repeated flag would count one single study twice in the per-flag badges.
  it('de-duplicates known flags and keeps unknown flags visible', () => {
    const row = unwrap(
      hubValidateRow(
        makeRow({
          studyKey: 'ST-5',
          flags: ['awaitingSignature', 'awaitingSignature', 'somethingNewFromBackend'],
        })
      )
    );
    expect(row.flags).toEqual(['awaitingSignature']);
    expect(row.unknownFlags).toEqual(['somethingNewFromBackend']);
  });
});

describe('hubComputeSla', () => {
  it('computes elapsed, remaining and breach from the chosen clock', () => {
    const sla = unwrap(
      hubComputeSla(
        makeRow({ studyKey: 'ST-6', clocks: { orderPlacedAt: T0 - 90 * MIN }, slaTargetMinutes: 60 }),
        ORDER_CLOCK
      )
    );
    expect(sla.elapsedMinutes).toBe(90);
    expect(sla.remainingMinutes).toBe(-30);
    expect(sla.overdueMinutes).toBe(30);
    expect(sla.breached).toBe(true);
  });

  // The divergence that matters: an urgent order whose images landed an hour later reads as
  // 4 minutes on the images clock and 64 minutes on the order clock. Same row, same instant.
  it('gives different numbers for the same row depending on the reference clock', () => {
    const row = makeRow({
      studyKey: 'ST-7',
      priority: 'urgent',
      clocks: { orderPlacedAt: T0 - 64 * MIN, imagesArrivedAt: T0 - 4 * MIN },
      slaTargetMinutes: 30,
    });
    const onOrder = unwrap(hubComputeSla(row, { nowMs: T0, reference: 'orderPlaced' }));
    const onImages = unwrap(hubComputeSla(row, { nowMs: T0, reference: 'imagesArrived' }));
    expect(onOrder.elapsedMinutes).toBe(64);
    expect(onOrder.breached).toBe(true);
    expect(onImages.elapsedMinutes).toBe(4);
    expect(onImages.breached).toBe(false);
  });

  // No silent fallback clock: substituting another timestamp under-reports the breach.
  it('refuses when the chosen reference timestamp is absent on the row', () => {
    const outcome = hubComputeSla(
      makeRow({ studyKey: 'ST-8', clocks: { orderPlacedAt: T0 - 5 * HOUR } }),
      { nowMs: T0, reference: 'assigned' }
    );
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toContain('assignedAt');
    expect(reasonOf(outcome)).toContain('não será substituído por outro relógio');
  });

  it('refuses when the reference clock is not stated at all', () => {
    const outcome = hubComputeSla(makeRow({ studyKey: 'ST-9' }), {
      nowMs: T0,
      reference: undefined as unknown as HubSlaReference,
    });
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toContain('Relógio de referência do SLA não informado');
  });

  // A zero epoch from an uninitialised field would show decades of delay on every row.
  it('refuses a non-positive or non-finite current instant', () => {
    const zeroNow = hubComputeSla(makeRow({ studyKey: 'ST-10' }), { nowMs: 0, reference: 'orderPlaced' });
    const nanNow = hubComputeSla(makeRow({ studyKey: 'ST-10' }), {
      nowMs: Number.NaN,
      reference: 'orderPlaced',
    });
    expect(zeroNow.ok).toBe(false);
    expect(nanNow.ok).toBe(false);
    expect(reasonOf(nanNow)).toContain('Instante atual inválido');
  });

  // Seconds of drift between modality and workstation are skew, not a data defect.
  it('clamps a small clock skew to zero elapsed and flags it', () => {
    const sla = unwrap(
      hubComputeSla(
        makeRow({ studyKey: 'ST-11', clocks: { orderPlacedAt: T0 + HUB_CLOCK_SKEW_TOLERANCE_MS } }),
        ORDER_CLOCK
      )
    );
    expect(sla.elapsedMinutes).toBe(0);
    expect(sla.skewClamped).toBe(true);
    expect(sla.breached).toBe(false);
  });

  // Beyond tolerance a future stamp would leave the row permanently "within target".
  it('refuses a reference instant far in the future', () => {
    const outcome = hubComputeSla(
      makeRow({ studyKey: 'ST-12', clocks: { orderPlacedAt: T0 + 2 * HOUR } }),
      ORDER_CLOCK
    );
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toContain('no futuro');
  });

  // Exactly at the target is not yet a breach; one minute past it is.
  it('treats the target boundary as not breached and the next minute as breached', () => {
    const atTarget = unwrap(
      hubComputeSla(
        makeRow({ studyKey: 'ST-13', clocks: { orderPlacedAt: T0 - 60 * MIN }, slaTargetMinutes: 60 }),
        ORDER_CLOCK
      )
    );
    const pastTarget = unwrap(
      hubComputeSla(
        makeRow({ studyKey: 'ST-14', clocks: { orderPlacedAt: T0 - 61 * MIN }, slaTargetMinutes: 60 }),
        ORDER_CLOCK
      )
    );
    expect(atTarget.breached).toBe(false);
    expect(atTarget.remainingMinutes).toBe(0);
    expect(pastTarget.breached).toBe(true);
    expect(pastTarget.overdueMinutes).toBe(1);
  });
});

describe('hubSortQueue ordering', () => {
  const statCt = makeRow({
    studyKey: 'CT-STAT',
    modality: 'CT',
    priority: 'stat',
    clocks: { orderPlacedAt: T0 - 4 * MIN },
    slaTargetMinutes: 30,
  });
  const routineMr = makeRow({
    studyKey: 'MR-ROUTINE',
    modality: 'MR',
    priority: 'routine',
    clocks: { orderPlacedAt: T0 - 3 * DAY },
    slaTargetMinutes: 24 * 60,
  });

  // THE inversion: sorting by "most overdue first" puts a three-day routine MRI above a
  // four-minute emergency CT, and both rows look perfectly reasonable on screen.
  it('puts the four-minute emergency above the three-day routine study', () => {
    const sorted = unwrap(hubSortQueue([routineMr, statCt], ORDER_CLOCK));
    expect(sorted.rows.map(r => r.studyKey)).toEqual(['CT-STAT', 'MR-ROUTINE']);
  });

  // Pins the wrong order explicitly, so nobody "fixes" the comparator back into it.
  it('produces the opposite order from a naive most-overdue-first sort', () => {
    const naive = [routineMr, statCt].slice().sort((a, b) => {
      const slaA = unwrap(hubComputeSla(a, ORDER_CLOCK));
      const slaB = unwrap(hubComputeSla(b, ORDER_CLOCK));
      return slaB.overdueMinutes - slaA.overdueMinutes;
    });
    const correct = unwrap(hubSortQueue([routineMr, statCt], ORDER_CLOCK));
    expect(naive.map(r => r.studyKey)).toEqual(['MR-ROUTINE', 'CT-STAT']);
    expect(correct.rows.map(r => r.studyKey)).toEqual(['CT-STAT', 'MR-ROUTINE']);
  });

  it('orders by depth of SLA breach only inside the same priority band', () => {
    const mildlyLate = makeRow({
      studyKey: 'U-MILD',
      priority: 'urgent',
      clocks: { orderPlacedAt: T0 - 70 * MIN },
      slaTargetMinutes: 60,
    });
    const badlyLate = makeRow({
      studyKey: 'U-BAD',
      priority: 'urgent',
      clocks: { orderPlacedAt: T0 - 300 * MIN },
      slaTargetMinutes: 60,
    });
    const onTime = makeRow({
      studyKey: 'U-OK',
      priority: 'urgent',
      clocks: { orderPlacedAt: T0 - 5 * MIN },
      slaTargetMinutes: 60,
    });
    const sorted = unwrap(hubSortQueue([onTime, mildlyLate, badlyLate], ORDER_CLOCK));
    expect(sorted.rows.map(r => r.studyKey)).toEqual(['U-BAD', 'U-MILD', 'U-OK']);
  });

  // A missing priority field must not sink below routine work.
  it('keeps an unspecified priority above routine and below urgent', () => {
    expect(HUB_PRIORITY_RANK.urgent).toBeLessThan(HUB_PRIORITY_RANK.unspecified);
    expect(HUB_PRIORITY_RANK.unspecified).toBeLessThan(HUB_PRIORITY_RANK.routine);
    const unspecified = makeRow({
      studyKey: 'X-UNSPEC',
      priority: 'unspecified',
      clocks: { orderPlacedAt: T0 - MIN },
      slaTargetMinutes: 600,
    });
    const routineVeryLate = makeRow({
      studyKey: 'X-ROUTINE',
      priority: 'routine',
      clocks: { orderPlacedAt: T0 - 5 * DAY },
      slaTargetMinutes: 60,
    });
    const sorted = unwrap(hubSortQueue([routineVeryLate, unspecified], ORDER_CLOCK));
    expect(sorted.rows.map(r => r.studyKey)).toEqual(['X-UNSPEC', 'X-ROUTINE']);
  });

  // The order priority describes what was suspected before the images existed; an
  // uncommunicated critical finding is what was actually seen.
  it('promotes a routine row with an unacknowledged critical finding to the emergency band', () => {
    const routineCritical = makeRow({
      studyKey: 'R-CRIT',
      priority: 'routine',
      flags: ['criticalFindingUnacknowledged'],
      clocks: { orderPlacedAt: T0 - MIN },
      slaTargetMinutes: 1440,
    });
    expect(hubEffectiveRank(routineCritical)).toBe(HUB_PRIORITY_RANK.stat);
    const urgentLate = makeRow({
      studyKey: 'U-LATE',
      priority: 'urgent',
      clocks: { orderPlacedAt: T0 - 10 * HOUR },
      slaTargetMinutes: 60,
    });
    const sorted = unwrap(hubSortQueue([urgentLate, routineCritical], ORDER_CLOCK));
    expect(sorted.rows.map(r => r.studyKey)).toEqual(['R-CRIT', 'U-LATE']);
  });

  // An unmeasurable SLA may be arbitrarily overdue; hiding it at the bottom of the band is
  // the same as never triaging it. It still must not jump a higher priority band.
  it('places rows with unmeasurable SLA at the top of their own band only', () => {
    const urgentNoClock = makeRow({
      studyKey: 'U-NOCLOCK',
      priority: 'urgent',
      clocks: { imagesArrivedAt: T0 - 3 * HOUR },
      slaTargetMinutes: 60,
    });
    const urgentLate = makeRow({
      studyKey: 'U-LATE2',
      priority: 'urgent',
      clocks: { orderPlacedAt: T0 - 10 * HOUR },
      slaTargetMinutes: 60,
    });
    const statOnTime = makeRow({
      studyKey: 'S-OK',
      priority: 'stat',
      clocks: { orderPlacedAt: T0 - MIN },
      slaTargetMinutes: 30,
    });
    const sorted = unwrap(hubSortQueue([urgentLate, statOnTime, urgentNoClock], ORDER_CLOCK));
    expect(sorted.rows.map(r => r.studyKey)).toEqual(['S-OK', 'U-NOCLOCK', 'U-LATE2']);
    expect(sorted.unmeasurableKeys).toEqual(['U-NOCLOCK']);
    expect(sorted.unmeasurableNote).toContain('sem SLA calculável');
  });

  it('breaks full ties deterministically by study key', () => {
    const a = makeRow({ studyKey: 'AAA', priority: 'urgent' });
    const b = makeRow({ studyKey: 'BBB', priority: 'urgent' });
    const sorted = unwrap(hubSortQueue([b, a], ORDER_CLOCK));
    expect(sorted.rows.map(r => r.studyKey)).toEqual(['AAA', 'BBB']);
  });

  // Equal remaining time with different targets: the older study goes first.
  it('prefers the longer-waiting row when the remaining time is equal', () => {
    const older = makeRow({
      studyKey: 'OLDER',
      priority: 'urgent',
      clocks: { orderPlacedAt: T0 - 90 * MIN },
      slaTargetMinutes: 120,
    });
    const newer = makeRow({
      studyKey: 'NEWER',
      priority: 'urgent',
      clocks: { orderPlacedAt: T0 - 30 * MIN },
      slaTargetMinutes: 60,
    });
    const sorted = unwrap(hubSortQueue([newer, older], ORDER_CLOCK));
    expect(sorted.rows.map(r => r.studyKey)).toEqual(['OLDER', 'NEWER']);
  });

  // An inconsistent comparator leaves an arbitrary order that still looks plausible.
  it('never returns NaN from the comparator even with a broken clock', () => {
    const a = makeRow({ studyKey: 'N-A', priority: 'urgent' });
    const b = makeRow({ studyKey: 'N-B', priority: 'urgent' });
    const result = hubCompareRows(a, b, { nowMs: Number.NaN, reference: 'orderPlaced' });
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBeLessThan(0);
  });

  it('refuses to sort with an invalid current instant', () => {
    const outcome = hubSortQueue([makeRow({ studyKey: 'ST-15' })], {
      nowMs: Number.NaN,
      reference: 'orderPlaced',
    });
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toContain('Instante atual inválido');
  });

  it('refuses the whole queue and names the offending position when a row is invalid', () => {
    const outcome = hubSortQueue(
      [makeRow({ studyKey: 'GOOD' }), makeRow({ studyKey: 'BAD', slaTargetMinutes: -5 })],
      ORDER_CLOCK
    );
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toContain('posição 1');
    expect(reasonOf(outcome)).toContain('Meta de SLA inválida');
  });
});

describe('hubCountFlags', () => {
  const rows: HubQueueRow[] = [
    makeRow({
      studyKey: 'F-1',
      flags: ['awaitingSignature', 'criticalFindingUnacknowledged', 'priorStudyMissing'],
    }),
    makeRow({ studyKey: 'F-2', flags: ['awaitingSignature'] }),
    makeRow({ studyKey: 'F-3', flags: [] }),
  ];

  // A single-status column would have to pick one state per row, and every other state
  // would vanish from the counts without anything on screen looking wrong.
  it('counts each concurrent flag independently, so the counts do not sum to the row count', () => {
    const counts = unwrap(hubCountFlags(rows));
    expect(counts.rowCount).toBe(3);
    expect(counts.flagCounts.awaitingSignature).toBe(2);
    expect(counts.flagCounts.criticalFindingUnacknowledged).toBe(1);
    expect(counts.flagCounts.priorStudyMissing).toBe(1);
    expect(counts.flagTotal).toBe(4);
    expect(counts.flagTotal).not.toBe(counts.rowCount);
    expect(counts.rowsWithMultipleFlags).toBe(1);
    expect(counts.rowsWithoutFlags).toBe(1);
  });

  it('states in words that the per-flag counts are not a partition of the list', () => {
    const counts = unwrap(hubCountFlags(rows));
    expect(counts.countsSumNote).toContain('não é o total de exames');
    expect(counts.countsSumNote).toContain('Soma dos marcadores: 4');
    expect(counts.countsSumNote).toContain('exames na lista: 3');
  });

  it('counts a duplicated flag once for the same study', () => {
    const counts = unwrap(
      hubCountFlags([makeRow({ studyKey: 'F-4', flags: ['awaitingPeerReview', 'awaitingPeerReview'] })])
    );
    expect(counts.flagCounts.awaitingPeerReview).toBe(1);
    expect(counts.flagTotal).toBe(1);
  });

  // A flag from a newer backend must not disappear into a silent else-branch.
  it('reports unknown flags received from the server instead of dropping them', () => {
    const counts = unwrap(
      hubCountFlags([makeRow({ studyKey: 'F-5', flags: ['awaitingSignature', 'awaitingCosignature'] })])
    );
    expect(counts.unknownFlags).toEqual(['awaitingCosignature']);
    expect(counts.unknownFlagsNote).toContain('awaitingCosignature');
  });
});

describe('hubFindUnassignedUrgent', () => {
  const rows: HubQueueRow[] = [
    makeRow({ studyKey: 'A-STAT', priority: 'stat', assignedTo: null }),
    makeRow({ studyKey: 'A-URGENT-ASSIGNED', priority: 'urgent', assignedTo: 'dr.lima' }),
    makeRow({ studyKey: 'A-UNSPEC', priority: 'unspecified', assignedTo: '   ' }),
    makeRow({ studyKey: 'A-ROUTINE', priority: 'routine', assignedTo: null }),
    makeRow({
      studyKey: 'A-ROUTINE-CRIT',
      priority: 'routine',
      flags: ['criticalFindingUnacknowledged'],
      assignedTo: null,
    }),
  ];

  // These rows are invisible by construction: every per-user queue filters on
  // "assignedTo === me", and an unowned study matches no such filter.
  it('finds urgent and unspecified studies with no owner, including whitespace-only owners', () => {
    const report = unwrap(hubFindUnassignedUrgent(rows));
    expect(report.keys).toEqual(['A-STAT', 'A-UNSPEC', 'A-ROUTINE-CRIT']);
    expect(report.count).toBe(3);
  });

  it('states why a per-user queue structurally cannot surface these studies', () => {
    const report = unwrap(hubFindUnassignedUrgent(rows));
    expect(report.reason).toContain('não aparecem em nenhuma fila pessoal');
    expect(report.reason).toContain('fila do departamento');
  });

  it('refuses when any row in the list is invalid', () => {
    const outcome = hubFindUnassignedUrgent([makeRow({ studyKey: '  ' })]);
    expect(outcome.ok).toBe(false);
  });
});

describe('hubSummarizeQueue', () => {
  const rows: HubQueueRow[] = [
    makeRow({
      studyKey: 'S-1',
      modality: 'CT',
      priority: 'urgent',
      flags: ['awaitingSignature', 'criticalFindingUnacknowledged'],
      clocks: { orderPlacedAt: T0 - 5 * HOUR },
      slaTargetMinutes: 60,
      assignedTo: null,
    }),
    makeRow({
      studyKey: 'S-2',
      modality: 'CT',
      priority: 'routine',
      clocks: { orderPlacedAt: T0 - 10 * MIN },
      slaTargetMinutes: 240,
    }),
    makeRow({
      studyKey: 'S-3',
      modality: 'CT',
      priority: 'routine',
      clocks: { imagesArrivedAt: T0 - 10 * DAY },
      slaTargetMinutes: 240,
    }),
  ];

  const noFilter: HubFilterContext = { label: '' };
  const modalityFilter: HubFilterContext = { label: 'Modalidade CT', modality: 'CT' };

  // "12 atrasados" spoken in a huddle becomes a department number and staffing follows it.
  it('refuses to produce a count with no filter context attached', () => {
    const outcome = hubSummarizeQueue(rows, {
      nowMs: T0,
      reference: 'orderPlaced',
      filter: undefined as unknown as HubFilterContext,
    });
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toContain('sem contexto de filtro');
  });

  it('refuses an active filter with no readable label', () => {
    const outcome = hubSummarizeQueue(rows, {
      nowMs: T0,
      reference: 'orderPlaced',
      filter: { label: '  ', modality: 'CT' },
    });
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toContain('sem descrição legível');
  });

  it('carries the filter into the scope message and the overdue badge', () => {
    const summary = unwrap(
      hubSummarizeQueue(rows, { nowMs: T0, reference: 'orderPlaced', filter: modalityFilter })
    );
    expect(hubIsFiltered(modalityFilter)).toBe(true);
    expect(summary.scope).toBe('filtered');
    expect(summary.scopeMessage).toContain('Modalidade CT');
    expect(summary.scopeMessage).toContain('não ao departamento');
    expect(summary.breachedBadge).toContain('Modalidade CT');
  });

  it('marks an unfiltered summary as a department count', () => {
    const summary = unwrap(
      hubSummarizeQueue(rows, { nowMs: T0, reference: 'orderPlaced', filter: noFilter })
    );
    expect(hubIsFiltered(noFilter)).toBe(false);
    expect(summary.scope).toBe('department');
    expect(summary.scopeMessage).toContain('departamento');
    expect(summary.filterLabel).toBe('sem filtro');
  });

  // A row with no order timestamp is not "within target", it is unknown; counting it as
  // compliant is how a ten-day-old study stays off the overdue badge forever.
  it('excludes unmeasurable rows from the overdue count and reports them separately', () => {
    const summary = unwrap(
      hubSummarizeQueue(rows, { nowMs: T0, reference: 'orderPlaced', filter: modalityFilter })
    );
    expect(summary.rowCount).toBe(3);
    expect(summary.breachedCount).toBe(1);
    expect(summary.unmeasurableCount).toBe(1);
    expect(summary.unmeasurableNote).toContain('não são "dentro da meta"');
  });

  it('reports unassigned urgent studies and the concurrent-flag buckets together', () => {
    const summary = unwrap(
      hubSummarizeQueue(rows, { nowMs: T0, reference: 'orderPlaced', filter: modalityFilter })
    );
    expect(summary.unassignedUrgentCount).toBe(1);
    expect(summary.escalationCount).toBe(1);
    expect(summary.buckets.flagCounts.awaitingSignature).toBe(1);
    expect(summary.buckets.flagCounts.criticalFindingUnacknowledged).toBe(1);
    expect(summary.buckets.flagTotal).toBe(2);
    expect(summary.buckets.flagTotal).not.toBe(summary.rowCount);
  });

  it('names the reference clock used, since another clock yields other numbers', () => {
    const summary = unwrap(
      hubSummarizeQueue(rows, { nowMs: T0, reference: 'imagesArrived', filter: modalityFilter })
    );
    expect(summary.slaReference).toBe('imagesArrived');
    expect(summary.referenceNote).toContain('desde a chegada das imagens');
    // S-3 has only an images timestamp, so switching the clock changes who is overdue.
    expect(summary.breachedCount).toBe(1);
    expect(summary.unmeasurableCount).toBe(2);
  });

  it('refuses the summary when the reference clock is missing from the options', () => {
    const outcome = hubSummarizeQueue(rows, {
      nowMs: T0,
      reference: 'sinceLunch' as unknown as HubSlaReference,
      filter: modalityFilter,
    });
    expect(outcome.ok).toBe(false);
    expect(reasonOf(outcome)).toContain('Relógio de referência do SLA não informado');
  });
});

describe('readouts', () => {
  it('renders one line with priority, SLA, concurrent flags and ownership', () => {
    const line = hubDescribeRow(
      makeRow({
        studyKey: 'D-1',
        modality: 'CT',
        priority: 'stat',
        flags: ['awaitingSignature', 'criticalFindingUnacknowledged'],
        clocks: { orderPlacedAt: T0 - 90 * MIN },
        slaTargetMinutes: 30,
        assignedTo: null,
      }),
      ORDER_CLOCK
    );
    expect(line).toContain('D-1');
    expect(line).toContain('Emergência (STAT)');
    expect(line).toContain('SLA estourado em 1h');
    expect(line).toContain('Aguardando assinatura + Achado crítico não comunicado');
    expect(line).toContain('sem responsável');
  });

  // A blank or zero SLA cell reads as "dentro da meta"; the row must say it is unknown.
  it('says in words when the SLA cannot be computed for the chosen clock', () => {
    const line = hubDescribeRow(
      makeRow({ studyKey: 'D-2', clocks: { imagesArrivedAt: T0 - HOUR } }),
      ORDER_CLOCK
    );
    expect(line).toContain('SLA não calculável');
    expect(line).toContain('orderPlacedAt');
  });

  it('renders an invalid row as a non-displayable line instead of throwing', () => {
    const line = hubDescribeRow(makeRow({ studyKey: 'D-3', slaTargetMinutes: 0 }), ORDER_CLOCK);
    expect(line).toContain('Linha não exibível');
  });

  it('keeps the filter scope and the non-summing counts in the summary readout', () => {
    const summary = unwrap(
      hubSummarizeQueue([makeRow({ studyKey: 'D-4', flags: ['awaitingSignature', 'priorStudyMissing'] })], {
        nowMs: T0,
        reference: 'orderPlaced',
        filter: { label: 'Fila neuro', queueKey: 'neuro' },
      })
    );
    const line = hubDescribeSummary(summary);
    expect(line).toContain('Fila neuro');
    expect(line).toContain('não é o total de exames');
  });

  it('formats durations in minutes, hours and days', () => {
    expect(hubFormatMinutes(0)).toBe('0min');
    expect(hubFormatMinutes(45)).toBe('45min');
    expect(hubFormatMinutes(60)).toBe('1h');
    expect(hubFormatMinutes(95)).toBe('1h 35min');
    expect(hubFormatMinutes(1440)).toBe('1d');
    expect(hubFormatMinutes(4320)).toBe('3d');
    expect(hubFormatMinutes(4380)).toBe('3d 1h');
    expect(hubFormatMinutes(Number.NaN)).toBe('tempo indisponível');
  });
});
