import {
  applyUndo,
  BATCH_CHUNK_SIZE,
  BatchProgress,
  chunk,
  createUndoEntry,
  describeProgress,
  describeReport,
  groupForUndo,
  isUndoable,
  runBatch,
  undoSecondsLeft,
  UNDO_WINDOW_MS,
} from './worklistBatch';

const ids = (n: number, prefix = 's') =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

describe('worklistBatch — chunking', () => {
  it('splits into chunks of the requested size', () => {
    expect(chunk(ids(7), 3).map(c => c.length)).toEqual([3, 3, 1]);
  });

  it('defaults to BATCH_CHUNK_SIZE', () => {
    expect(chunk(ids(60))[0]).toHaveLength(BATCH_CHUNK_SIZE);
  });

  // Clamping a bogus size to 1 would turn a typo into one request per study.
  it('falls back to the default for a bogus size', () => {
    expect(chunk(ids(3), 0).map(c => c.length)).toEqual([3]);
    expect(chunk(ids(3), -5).map(c => c.length)).toEqual([3]);
  });
});

describe('worklistBatch — runBatch', () => {
  it('sends every id exactly once, in order, and reports success', async () => {
    const seen: string[][] = [];
    const report = await runBatch(ids(23), async batch => {
      seen.push(batch);
    }, { chunkSize: 10 });

    expect(seen.map(c => c.length)).toEqual([10, 10, 3]);
    expect(seen.flat()).toEqual(ids(23));
    expect(report.succeeded).toHaveLength(23);
    expect(report.failed).toHaveLength(0);
  });

  it('deduplicates and drops blank ids before counting', async () => {
    const report = await runBatch(['a', 'a', '', '  ', 'b'], async () => undefined);
    expect(report.total).toBe(2);
    expect(report.succeeded).toEqual(['a', 'b']);
  });

  it('reports progress as each chunk lands', async () => {
    const progress: BatchProgress[] = [];
    await runBatch(ids(23), async () => undefined, {
      chunkSize: 10,
      onProgress: p => progress.push({ ...p }),
    });
    expect(progress.map(p => p.done)).toEqual([10, 20, 23]);
    expect(progress.every(p => p.total === 23)).toBe(true);
  });

  it('runs chunks sequentially, never overlapping', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await runBatch(ids(30), async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    }, { chunkSize: 5 });
    expect(maxInFlight).toBe(1);
  });

  // The whole point: 18 assigned and 5 rejected must NOT read as 23 assigned.
  it('keeps partial success partial', async () => {
    const report = await runBatch(ids(23), async batch => ({
      failed: batch.filter(id => ['s3', 's9', 's11', 's20', 's22'].includes(id))
        .map(id => ({ id, message: 'Já atribuído a outro radiologista' })),
    }), { chunkSize: 10 });

    expect(report.succeeded).toHaveLength(18);
    expect(report.failed).toHaveLength(5);
    expect(report.failed[0].message).toMatch(/outro radiologista/);
    expect(describeReport(report, 'atribuídos')).toBe('18 de 23 estudos atribuídos; 5 falharam.');
  });

  it('treats a thrown chunk as every id in it failing, with the thrown message', async () => {
    const report = await runBatch(ids(5), async () => {
      throw new Error('502 Bad Gateway');
    }, { chunkSize: 2 });

    expect(report.succeeded).toHaveLength(0);
    expect(report.failed).toHaveLength(5);
    expect(report.failed.every(f => f.message === '502 Bad Gateway')).toBe(true);
  });

  it('keeps going after a chunk throws, so one bad chunk does not lose the rest', async () => {
    let call = 0;
    const report = await runBatch(ids(6), async () => {
      call += 1;
      if (call === 2) {
        throw new Error('timeout');
      }
    }, { chunkSize: 2 });

    expect(report.succeeded).toEqual(['s1', 's2', 's5', 's6']);
    expect(report.failed.map(f => f.id)).toEqual(['s3', 's4']);
  });

  // A server that enumerates its successes is telling us about the ones it left out.
  it('marks ids a chunk did not list as succeeded as failed', async () => {
    const report = await runBatch(['a', 'b', 'c'], async () => ({ succeeded: ['a', 'c'] }));
    expect(report.succeeded).toEqual(['a', 'c']);
    expect(report.failed.map(f => f.id)).toEqual(['b']);
  });

  it('a silent chunk (204) counts as all-succeeded', async () => {
    const report = await runBatch(['a', 'b'], async () => undefined);
    expect(report.succeeded).toEqual(['a', 'b']);
  });

  it('aborts between chunks and names what was never attempted', async () => {
    let done = 0;
    const report = await runBatch(ids(30), async batch => {
      done += batch.length;
    }, { chunkSize: 10, isAborted: () => done >= 20 });

    expect(report.aborted).toBe(true);
    expect(report.succeeded).toHaveLength(20);
    expect(report.skipped).toHaveLength(10);
    expect(describeReport(report)).toMatch(/Cancelado: 20 estudos atualizados, 10 não processados/);
  });

  it('handles an empty selection without calling the applier', async () => {
    const apply = jest.fn();
    const report = await runBatch([], apply);
    expect(apply).not.toHaveBeenCalled();
    expect(report.total).toBe(0);
  });
});

describe('worklistBatch — report and progress text', () => {
  const report = (succeeded: string[], failed: string[] = []) => ({
    total: succeeded.length + failed.length,
    succeeded,
    failed: failed.map(id => ({ id, message: 'x' })),
    aborted: false,
    skipped: [],
  });

  it('phrases a clean run as a success', () => {
    expect(describeReport(report(ids(23)), 'atribuídos')).toBe('23 estudos atribuídos.');
  });

  // "1 estudo atribuídos" is the kind of wrongness that makes a supervisor stop
  // reading the toast — including the failure count in it.
  it('agrees in number for one study', () => {
    expect(describeReport(report(['a']), 'atribuídos')).toBe('1 estudo atribuído.');
    expect(describeReport(report([], ['a']), 'atribuídos')).toBe(
      'Nenhum estudo atribuído — 1 estudo falhou.'
    );
  });

  it('says nothing succeeded when nothing did', () => {
    expect(describeReport(report([], ids(4)), 'atribuídos')).toBe(
      'Nenhum estudo atribuído — 4 estudos falharam.'
    );
  });

  it('never phrases a partial run as a plain success', () => {
    const text = describeReport(report(ids(18), ids(5, 'f')), 'atribuídos');
    expect(text).toMatch(/falharam/);
    expect(text).not.toBe('23 estudos atribuídos.');
  });

  it('renders progress as N/total', () => {
    expect(describeProgress({ done: 18, total: 23, failed: 0 }, 'Atribuindo')).toBe(
      'Atribuindo 23 estudos... 18/23'
    );
  });

  it('clamps nonsense progress instead of rendering 47/23', () => {
    expect(describeProgress({ done: 47, total: 23, failed: 0 })).toMatch(/23\/23$/);
    expect(describeProgress({ done: -3, total: 23, failed: 0 })).toMatch(/0\/23$/);
  });
});

describe('worklistBatch — undo', () => {
  const T0 = 1_700_000_000_000;

  it('captures the previous value per study', () => {
    const entry = createUndoEntry({
      token: 'b1',
      label: 'Desfazer',
      ids: ['a', 'b'],
      previous: { a: 'dr-ana', b: null },
      now: T0,
    });
    expect(entry).not.toBeNull();
    expect(entry!.previous).toEqual({ a: 'dr-ana', b: null });
    expect(entry!.expiresAt).toBe(T0 + UNDO_WINDOW_MS);
  });

  // No button beats a button that writes a state that never existed.
  it('refuses to offer undo when a prior value is missing', () => {
    const entry = createUndoEntry({
      token: 'b1',
      label: 'Desfazer',
      ids: ['a', 'b', 'c'],
      previous: { a: 'dr-ana', b: null },
      now: T0,
    });
    expect(entry).toBeNull();
  });

  it('treats an explicit undefined prior value as recorded, not missing', () => {
    const entry = createUndoEntry({
      token: 'b1',
      label: 'Desfazer',
      ids: ['a'],
      previous: { a: undefined },
      now: T0,
    });
    expect(entry).not.toBeNull();
  });

  it('offers nothing when the batch changed nothing', () => {
    expect(
      createUndoEntry({ token: 'b1', label: 'x', ids: [], previous: {}, now: T0 })
    ).toBeNull();
  });

  it('narrows the recorded values to the ids that actually changed', () => {
    const entry = createUndoEntry({
      token: 'b1',
      label: 'x',
      ids: ['a'],
      previous: { a: '1', b: '2' },
      now: T0,
    });
    expect(Object.keys(entry!.previous)).toEqual(['a']);
  });

  it('expires after the 5s window', () => {
    const entry = createUndoEntry({
      token: 'b1', label: 'x', ids: ['a'], previous: { a: null }, now: T0,
    })!;
    expect(isUndoable(entry, T0 + 4999)).toBe(true);
    expect(isUndoable(entry, T0 + 5000)).toBe(false);
    expect(undoSecondsLeft(entry, T0 + 1200)).toBe(4);
    expect(undoSecondsLeft(entry, T0 + 9000)).toBe(0);
  });

  it('groups the restore by distinct previous value', () => {
    const entry = createUndoEntry({
      token: 'b1',
      label: 'x',
      ids: ['a', 'b', 'c', 'd'],
      previous: { a: 'ana', b: null, c: 'ana', d: 'bruno' },
      now: T0,
    })!;
    const groups = groupForUndo(entry);
    expect(groups).toHaveLength(3);
    expect(groups.find(g => g.value === 'ana')!.ids.sort()).toEqual(['a', 'c']);
    expect(groups.find(g => g.value === null)!.ids).toEqual(['b']);
  });

  // The failure this guards: restoring 23 studies to one value instead of their own.
  it('restores each study to ITS OWN previous value', async () => {
    const entry = createUndoEntry({
      token: 'b1',
      label: 'x',
      ids: ['a', 'b', 'c'],
      previous: { a: 'ana', b: null, c: 'bruno' },
      now: T0,
    })!;

    const written: Record<string, unknown> = {};
    const report = await applyUndo(entry, (value, batch) => {
      for (const id of batch) {
        written[id] = value;
      }
    }, T0 + 1000);

    expect(written).toEqual({ a: 'ana', b: null, c: 'bruno' });
    expect(report!.succeeded.sort()).toEqual(['a', 'b', 'c']);
  });

  it('is one-shot: a double click on Desfazer does not restore twice', async () => {
    const entry = createUndoEntry({
      token: 'b1', label: 'x', ids: ['a'], previous: { a: 'ana' }, now: T0,
    })!;
    const restore = jest.fn();

    await applyUndo(entry, restore, T0 + 100);
    const second = await applyUndo(entry, restore, T0 + 200);

    expect(restore).toHaveBeenCalledTimes(1);
    expect(second).toBeNull();
  });

  it('resolves null rather than throwing when the window already closed', async () => {
    const entry = createUndoEntry({
      token: 'b1', label: 'x', ids: ['a'], previous: { a: 'ana' }, now: T0,
    })!;
    const restore = jest.fn();
    expect(await applyUndo(entry, restore, T0 + UNDO_WINDOW_MS + 1)).toBeNull();
    expect(restore).not.toHaveBeenCalled();
  });

  it('reports a failed restore instead of claiming the undo worked', async () => {
    const entry = createUndoEntry({
      token: 'b1', label: 'x', ids: ['a', 'b'], previous: { a: 'ana', b: 'ana' }, now: T0,
    })!;
    const report = await applyUndo(entry, () => {
      throw new Error('409 Conflict');
    }, T0 + 100);

    expect(report!.succeeded).toHaveLength(0);
    expect(report!.failed).toHaveLength(2);
    expect(describeReport(report!, 'restaurados')).toMatch(/^Nenhum estudo restaurado/);
  });
});
