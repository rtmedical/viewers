/**
 * Data-source resolution shared by the rt-worklist pages (RTV-161 worklist,
 * RTV-157 IHE Invoke Image Display) — extracted from RtWorklistPage so both
 * entry points follow the exact same rules:
 *
 *   1. an explicit `?datasources=` query param wins (same contract as the
 *      stock DataSourceWrapper);
 *   2. otherwise the extension manager's active data source;
 *   3. the data source is initialize()d exactly once per SPA session before
 *      any QIDO query — on DIRECT entry (deep link, IHE invocation) nothing
 *      else has initialized it, and its QIDO client/auth-header getter only
 *      exist afterwards.
 */

export interface WorklistExtensionManager {
  getActiveDataSource?: () => any[];
  getDataSources?: (name?: string) => any[];
}

/** Data sources already initialize()d by these pages (per SPA session). */
const initializedSources = new WeakSet<object>();

/**
 * Resolve the data source, honoring an explicit `?datasources=` param like
 * the stock DataSourceWrapper (getActiveDataSource is the singular
 * ExtensionManager method; getDataSources(name) resolves named sources).
 */
export function getActiveDataSource(extensionManager?: WorklistExtensionManager) {
  try {
    const named = new URLSearchParams(window.location.search).get('datasources');
    if (named) {
      const byName = extensionManager?.getDataSources?.(named)?.[0];
      if (byName) {
        return byName;
      }
    }
  } catch (e) {
    /* fall through to the active source */
  }
  return (
    extensionManager?.getActiveDataSource?.()?.[0] ?? extensionManager?.getDataSources?.()?.[0]
  );
}

/**
 * initialize() the data source once per SPA session (WeakSet-guarded).
 * Passing the current query lets `dicomweb-proxy`-style sources read their
 * per-request configuration exactly like the stock route wrapper does.
 */
export async function initializeDataSourceOnce(dataSource: any): Promise<void> {
  if (!dataSource || initializedSources.has(dataSource)) {
    return;
  }
  await dataSource.initialize?.({
    params: {},
    query: new URLSearchParams(window.location.search),
  });
  initializedSources.add(dataSource);
}
