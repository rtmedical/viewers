/**
 * Bulk worklist operations: chunking, progress, partial failure and undo — pure core
 * (RTV-191).
 *
 * Assigning 80 studies is not "one request with 80 ids". Three things go wrong if it is.
 *
 * ## Partial success is the normal case, not the error case
 *
 * Out of 23 studies, 18 assign and 5 come back 409 because another supervisor took them
 * thirty seconds ago. The toast that says "23 estudos atribuídos" is the dangerous
 * outcome here: the supervisor moves on believing the shift is distributed, and five
 * exams sit unassigned with an SLA running. {@link runBatch} always reports succeeded
 * and failed separately, and {@link describeReport} refuses to phrase a partial run as a
 * success.
 *
 * ## Chunking, and why order is preserved
 *
 * One request per study floods the connection pool; one request with everything times
 * out on a slow RIS and gives no progress to show. Chunks of
 * {@link BATCH_CHUNK_SIZE} split the difference and are what makes "18/23" possible.
 * Chunks run **sequentially**: a bulk write against a RIS is not something to parallelise
 * behind the user's back, and sequential execution means an abort stops at a known point
 * instead of leaving an unknown number of requests in flight.
 *
 * ## Undo is a compensating write, and it needs the *previous* value per study
 *
 * "23 estudos atribuídos. Desfazer?" cannot be a local rollback — the server already
 * changed. Undo has to write the old value back, and the old value is **different for
 * each study**: some were unassigned, some belonged to another radiologist. An undo that
 * writes one value to all of them does not restore the previous state, it invents a new
 * wrong one, and it does so under a button labelled "Desfazer".
 *
 * So {@link createUndoEntry} demands a prior value for every id and returns `null` when
 * any is missing. No undo button is better than one that corrupts. When the values are
 * there, {@link groupForUndo} batches them by distinct previous value, so restoring 23
 * studies to three different radiologists is three requests, not 23.
 *
 * Time is injected everywhere; nothing here reads the clock. Framework-free, no `@ohif/*`.
 * Zero-fork per RTV-114.
 */

export const BATCH_CHUNK_SIZE = 25;

/** How long "Desfazer" stays offered, per the acceptance criterion. */
export const UNDO_WINDOW_MS = 5000;

export interface BatchFailure {
  id: string;
  message: string;
}

export interface BatchReport {
  /** Ids the batch was asked to change. */
  total: number;
  succeeded: string[];
  failed: BatchFailure[];
  /** True when the caller aborted partway; the remaining ids were never attempted. */
  aborted: boolean;
  /** Ids never attempted because of an abort. */
  skipped: string[];
}

export interface BatchProgress {
  done: number;
  total: number;
  failed: number;
}

/**
 * Applies one chunk.
 *
 * Resolving with a partial list is how per-study failure is reported; throwing means the
 * whole chunk failed (a 500, a dropped connection) and every id in it is marked failed
 * with the thrown message. Both happen in practice and the runner handles them the same
 * way downstream.
 */
export type ChunkApplier = (ids: string[]) => Promise<ChunkOutcome | void> | ChunkOutcome | void;

export interface ChunkOutcome {
  succeeded?: string[];
  failed?: BatchFailure[];
}

export interface RunBatchOptions {
  chunkSize?: number;
  onProgress?: (progress: BatchProgress) => void;
  /** Polled between chunks. Returning true stops the run without starting more work. */
  isAborted?: () => boolean;
}

const cleanIds = (list: unknown): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of (list as unknown[]) ?? []) {
    const id = String(value ?? '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
};

export function chunk<T>(items: T[], size: number = BATCH_CHUNK_SIZE): T[][] {
  // A nonsense size falls back to the default rather than clamping to 1: clamping would
  // turn a caller's typo into one HTTP request per study against the RIS.
  const raw = Number(size);
  const step = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : BATCH_CHUNK_SIZE;
  const out: T[][] = [];
  for (let i = 0; i < (items ?? []).length; i += step) {
    out.push(items.slice(i, i + step));
  }
  return out;
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  const text = String(error ?? '').trim();
  return text || 'Falha desconhecida';
};

/**
 * Runs a bulk operation in sequential chunks, reporting progress as it goes.
 *
 * A chunk that resolves without naming any ids is taken as "all of them succeeded" —
 * that is what a 204 from a batch endpoint means. A chunk that names some succeeded
 * marks the rest of that chunk failed, because a server that bothered to enumerate
 * successes is telling us about the ones it left out.
 */
export async function runBatch(
  ids: string[],
  apply: ChunkApplier,
  options: RunBatchOptions = {}
): Promise<BatchReport> {
  const targets = cleanIds(ids);
  const chunks = chunk(targets, options.chunkSize);
  const succeeded: string[] = [];
  const failed: BatchFailure[] = [];
  let aborted = false;
  let index = 0;

  // Exit through the loop condition rather than `break`: the regenerator transform in
  // this toolchain miscompiles a `break` out of a loop containing `await`.
  for (; index < chunks.length && !aborted; index++) {
    if (options.isAborted && options.isAborted()) {
      aborted = true;
    } else {
      const batch = chunks[index];
      // `undefined` e nao `void`: TypeScript nao estreita `void` fora de uma uniao com
      // `??`, e uma funcao declarada `=> void` devolve `undefined` em runtime -- que e o
      // que o `?? {}` abaixo trata.
      let outcome: ChunkOutcome | undefined;
      let threw: string | null = null;
      try {
        outcome = (await apply(batch)) as ChunkOutcome | undefined;
      } catch (error) {
        // Named binding on purpose — optional catch binding inside an async function
        // breaks @babel/plugin-transform-regenerator here.
        threw = errorMessage(error);
      }

      if (threw !== null) {
        for (const id of batch) {
          failed.push({ id, message: threw });
        }
      } else {
        // Partial: um chunk que resolve sem nomear ids devolve void, e `outcome ?? {}`
        // produz um objeto sem as propriedades. Em runtime o `?? []` abaixo trata; o
        // tipo precisa dizer que os campos podem faltar.
        const reported: Partial<ChunkOutcome> = outcome ?? {};
        const chunkFailed = (reported.failed ?? []).filter(f => f && f.id);
        const failedIds = chunkFailed.map(f => String(f.id));
        const chunkSucceeded = reported.succeeded
          ? cleanIds(reported.succeeded)
          : batch.filter(id => !failedIds.includes(id));

        for (const id of batch) {
          if (chunkSucceeded.includes(id)) {
            succeeded.push(id);
          } else {
            const named = chunkFailed.find(f => String(f.id) === id);
            failed.push({ id, message: named ? String(named.message ?? 'Falhou') : 'Falhou' });
          }
        }
      }

      if (options.onProgress) {
        options.onProgress({
          done: succeeded.length + failed.length,
          total: targets.length,
          failed: failed.length,
        });
      }
    }
  }

  const attempted = new Set([...succeeded, ...failed.map(f => f.id)]);
  return {
    total: targets.length,
    succeeded,
    failed,
    aborted,
    skipped: targets.filter(id => !attempted.has(id)),
  };
}

/**
 * The toast text for a finished batch.
 *
 * Deliberately never phrases a partial run as a plain success — see the module note.
 *
 * `action` is the masculine plural participle ("atribuídos"); the singular is the same
 * word without its final `s`, which holds for every participle this is used with. A
 * toast reading "1 estudo atribuídos" makes the whole thing look machine-generated, and
 * a supervisor who stops trusting the toast stops reading the failure counts in it.
 */
export function describeReport(report: BatchReport, action = 'atualizados'): string {
  if (!report) {
    return '';
  }
  const ok = report.succeeded.length;
  const bad = report.failed.length;
  const noun = (n: number) => (n === 1 ? 'estudo' : 'estudos');
  const plural = String(action ?? '').trim() || 'atualizados';
  const singular = plural.endsWith('s') ? plural.slice(0, -1) : plural;
  const agrees = (n: number) => (n === 1 ? singular : plural);

  if (report.aborted) {
    return `Cancelado: ${ok} ${noun(ok)} ${agrees(ok)}, ${report.skipped.length} não processados.`;
  }
  if (bad === 0) {
    return `${ok} ${noun(ok)} ${agrees(ok)}.`;
  }
  if (ok === 0) {
    return `Nenhum estudo ${singular} — ${bad} ${noun(bad)} ${bad === 1 ? 'falhou' : 'falharam'}.`;
  }
  return `${ok} de ${report.total} ${noun(report.total)} ${agrees(ok)}; ${bad} ${
    bad === 1 ? 'falhou' : 'falharam'
  }.`;
}

/** Progress text while it runs: "Atribuindo 23 estudos... 18/23". */
export function describeProgress(progress: BatchProgress, verb = 'Processando'): string {
  const total = Math.max(0, Math.floor(Number(progress?.total) || 0));
  const done = Math.min(total, Math.max(0, Math.floor(Number(progress?.done) || 0)));
  const noun = total === 1 ? 'estudo' : 'estudos';
  return `${verb} ${total} ${noun}... ${done}/${total}`;
}

export interface UndoEntry<V = unknown> {
  /** Identifies the entry so a stale toast cannot undo a newer batch. */
  token: string;
  label: string;
  /** Previous value per study id — the whole reason undo can be correct. */
  previous: Record<string, V>;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

export interface CreateUndoOptions<V> {
  token: string;
  label: string;
  /** Ids that actually changed — never the whole selection. */
  ids: string[];
  /** Value each id held *before* the batch. Must cover every id. */
  previous: Record<string, V>;
  now: number;
  windowMs?: number;
}

/**
 * Builds the undo entry offered by the toast.
 *
 * Returns `null` when the batch changed nothing, or when any changed id has no recorded
 * previous value. That second case is the important one: an undo missing prior values
 * can only guess, and a guessing "Desfazer" writes a state that never existed.
 */
export function createUndoEntry<V>(options: CreateUndoOptions<V>): UndoEntry<V> | null {
  const ids = cleanIds(options?.ids);
  if (!ids.length) {
    return null;
  }
  const previous = options?.previous ?? {};
  const complete = ids.every(id => Object.prototype.hasOwnProperty.call(previous, id));
  if (!complete) {
    return null;
  }

  const now = Number(options?.now);
  const createdAt = Number.isFinite(now) ? now : 0;
  const windowMs = Math.max(0, Number(options?.windowMs ?? UNDO_WINDOW_MS) || 0);
  const scoped: Record<string, V> = {};
  for (const id of ids) {
    scoped[id] = previous[id];
  }

  return {
    token: String(options?.token ?? '').trim() || 'undo',
    label: String(options?.label ?? 'Desfazer'),
    previous: scoped,
    createdAt,
    expiresAt: createdAt + windowMs,
    used: false,
  };
}

/** Whether the toast should still show its "Desfazer" button. */
export function isUndoable(entry: UndoEntry | null | undefined, now: number): boolean {
  if (!entry || entry.used) {
    return false;
  }
  const at = Number(now);
  return Number.isFinite(at) && at < entry.expiresAt;
}

/** Seconds left, for a countdown on the button. */
export function undoSecondsLeft(entry: UndoEntry | null | undefined, now: number): number {
  if (!isUndoable(entry, now)) {
    return 0;
  }
  return Math.max(0, Math.ceil((entry!.expiresAt - Number(now)) / 1000));
}

export interface UndoGroup<V> {
  value: V;
  ids: string[];
}

/**
 * Groups the ids by the value they must be restored to.
 *
 * Restoring 23 studies that came from three different radiologists is three requests.
 * Grouping here rather than in the caller keeps the "one value per request" invariant
 * where the previous values live.
 */
export function groupForUndo<V>(entry: UndoEntry<V>): UndoGroup<V>[] {
  const groups: UndoGroup<V>[] = [];
  for (const [id, value] of Object.entries(entry?.previous ?? {})) {
    const existing = groups.find(g => Object.is(g.value, value));
    if (existing) {
      existing.ids.push(id);
    } else {
      groups.push({ value: value as V, ids: [id] });
    }
  }
  return groups;
}

/**
 * Runs the compensating writes, one batch per distinct previous value.
 *
 * Marks the entry used before doing any work, so a double-click on "Desfazer" cannot
 * fire the restore twice. An expired or spent entry resolves to `null` rather than
 * throwing — the toast racing its own timeout is ordinary, not exceptional.
 */
export async function applyUndo<V>(
  entry: UndoEntry<V>,
  restore: (value: V, ids: string[]) => Promise<ChunkOutcome | void> | ChunkOutcome | void,
  now: number,
  options: RunBatchOptions = {}
): Promise<BatchReport | null> {
  if (!isUndoable(entry, now)) {
    return null;
  }
  entry.used = true;

  const groups = groupForUndo(entry);
  const succeeded: string[] = [];
  const failed: BatchFailure[] = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const report = await runBatch(group.ids, batchIds => restore(group.value, batchIds), options);
    succeeded.push(...report.succeeded);
    failed.push(...report.failed);
  }

  return {
    total: succeeded.length + failed.length,
    succeeded,
    failed,
    aborted: false,
    skipped: [],
  };
}
