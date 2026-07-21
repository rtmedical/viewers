/**
 * RIS-style study list page (RTV-161), served at /worklist-rt through the
 * `routes.customRoutes` customization (see getCustomizationModule.ts). The app
 * router (platform/app/src/routes/index.tsx, RouteWithErrorBoundary) injects
 * `servicesManager` and `extensionManager` as props; the customization module
 * additionally binds them from its own closure as a fallback.
 *
 * Data flow — QIDO is study-centric, so the page:
 *   1. fetches the study list once via `dataSource.query.studies.search`
 *      (same call as platform/app/src/hooks/useStudyListQuery.tsx), capped by
 *      the data source's `queryLimit` (default 101);
 *   2. filters client-side (worklistModel.filterStudies) and groups by
 *      PatientID (worklistModel.groupStudiesByPatient) to produce the
 *      PATIENT → STUDY hierarchy;
 *   3. loads series on demand when a study row is expanded, via
 *      `dataSource.query.series.search(studyInstanceUid)` (the same call
 *      LegacyWorkList uses for its expansion rows);
 *   4. feeds the visible StudyInstanceUIDs to the rtmedical worklist queue
 *      service (extensions/rtmedical-theme WorklistQueueService) best-effort,
 *      so next/previous-study navigation works in the viewer.
 *
 * Import re-uses the `dicomUploadComponent` customization (DicomUpload →
 * STOW-RS), shown in a modal exactly like the stock WorkList toolbar does
 * (platform/app/src/hooks/useWorkListToolbarActions.tsx); it is only enabled
 * when the active data source reports `dicomUploadEnabled`.
 *
 * MERGE is intentionally NOT implemented: merging studies is not expressible
 * in DICOMweb (QIDO/WADO/STOW) — it needs a PACS backend API (e.g. Orthanc
 * REST /modify+/delete). The button ships disabled with an explanatory
 * tooltip; the wiring is a backend follow-up ticket.
 *
 * Promoting this page to '/' (replacing the stock WorkList) is a deployment
 * decision, not code: set `showStudyList: false` in the app config and keep
 * this route as the landing page, or leave both. The route deliberately does
 * not claim '/' so it never competes with the stock list by RRv6 specificity.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  WorklistSeries,
  WorklistStudy,
  filterStudies,
  formatStudyRow,
  groupStudiesByPatient,
} from './worklistModel';
import { studyPath } from './iheInvoke';
import { getActiveDataSource, initializeDataSourceOnce } from './dataSourceUtils';

interface ManagersProps {
  servicesManager?: { services?: Record<string, any> };
  extensionManager?: {
    getActiveDataSources?: () => any[];
    getDataSources?: () => any[];
  };
}

type SeriesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; series: WorklistSeries[] };

const inputClassName =
  'bg-background text-foreground border-input h-8 rounded border px-2 text-sm outline-none focus:border-primary';

const actionButtonClassName =
  'border-input text-foreground hover:bg-popover rounded border px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-40';

// Data-source resolution (?datasources= honored, initialize-once) lives in
// dataSourceUtils.ts and mode-path building (basename-safe, preserved query
// params) in iheInvoke.ts — both shared with the IHE IID page (RTV-157).

function StudyInfoContent({
  study,
  series,
}: {
  study: WorklistStudy;
  series?: WorklistSeries[];
}): React.ReactElement {
  const row = formatStudyRow(study);
  const fields: [string, string][] = [
    ['Patient name', row.patientName || '—'],
    ['Patient ID (MRN)', row.mrn || '—'],
    ['Study date', row.date || '—'],
    ['Description', row.description || '—'],
    ['Modalities', row.modalities || '—'],
    ['Accession number', row.accession || '—'],
    ['Instances', String(row.instances)],
    ['StudyInstanceUID', row.studyInstanceUid],
  ];
  return (
    <div className="text-foreground flex max-h-[70vh] flex-col gap-3 overflow-y-auto text-sm">
      <table className="w-full border-collapse">
        <tbody>
          {fields.map(([label, value]) => (
            <tr key={label} className="border-input border-b">
              <td className="text-muted-foreground w-44 py-1 pr-2 align-top">{label}</td>
              <td className="break-all py-1">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <div className="text-muted-foreground mb-1">Series ({series?.length ?? 0})</div>
        {series && series.length > 0 ? (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="py-1 pr-2">#</th>
                <th className="pr-2">Modality</th>
                <th className="pr-2">Description</th>
                <th className="text-right">Instances</th>
              </tr>
            </thead>
            <tbody>
              {series.map(item => (
                <tr key={item.seriesInstanceUid} className="border-input border-t">
                  <td className="py-1 pr-2">{item.seriesNumber ?? '—'}</td>
                  <td className="pr-2">{item.modality ?? '—'}</td>
                  <td className="pr-2">{item.description || '—'}</td>
                  <td className="text-right">{item.numSeriesInstances ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-muted-foreground">No series information loaded.</div>
        )}
      </div>
    </div>
  );
}

export function RtWorklistPage(props: ManagersProps): React.ReactElement {
  const { servicesManager, extensionManager } = props;
  const navigate = useNavigate();
  const services = servicesManager?.services ?? {};
  const { uiModalService, customizationService, rtmedicalWorklistQueueService } = services as any;

  const dataSource = useMemo(() => getActiveDataSource(extensionManager), [extensionManager]);

  const [studies, setStudies] = useState<WorklistStudy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>('');
  const [reloadToken, setReloadToken] = useState(0);

  const [nameFilter, setNameFilter] = useState('');
  // The MRN filter honors an initial `?mrn=` query param — the IHE Invoke
  // Image Display PATIENT fallback (RTV-157) lands here pre-filtered.
  const [mrnFilter, setMrnFilter] = useState(
    () => new URLSearchParams(window.location.search).get('mrn') ?? ''
  );
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [modalityFilter, setModalityFilter] = useState('');

  const [expandedPatients, setExpandedPatients] = useState<Record<string, boolean>>({});
  const [expandedStudies, setExpandedStudies] = useState<Record<string, boolean>>({});
  const [seriesByStudy, setSeriesByStudy] = useState<Record<string, SeriesState>>({});

  const refresh = useCallback(() => {
    setSeriesByStudy({});
    setReloadToken(token => token + 1);
  }, []);

  // Study fetch — the data source MUST be initialized first: its QIDO client
  // and auth-header getter only exist after initialize() (review B1 — direct
  // entry on /worklist-rt previously threw before this ran). Filters are also
  // pushed server-side (mapParams supports them), because a single limited
  // QIDO page filtered client-side hides matching patients beyond the first
  // `queryLimit` studies (review M1).
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    if (!dataSource?.query?.studies?.search) {
      setIsLoading(false);
      setLoadError('No active data source (or it does not support study search).');
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setLoadError('');
    const run = async () => {
      try {
        await initializeDataSourceOnce(dataSource);
        const limit = dataSource.getConfig?.()?.queryLimit ?? 101;
        const serverFilters: Record<string, unknown> = { offset: 0, limit };
        if (nameFilter.trim()) {
          serverFilters.patientName = nameFilter.trim();
        }
        if (mrnFilter.trim()) {
          serverFilters.patientId = mrnFilter.trim();
        }
        if (dateFrom) {
          serverFilters.startDate = dateFrom.replace(/-/g, '');
        }
        if (dateTo) {
          serverFilters.endDate = dateTo.replace(/-/g, '');
        }
        if (modalityFilter.trim()) {
          serverFilters.modalitiesInStudy = modalityFilter.trim().toUpperCase();
        }
        const result: WorklistStudy[] = await dataSource.query.studies.search(serverFilters);
        if (!cancelled) {
          setStudies(result || []);
          setTruncated((result?.length ?? 0) >= limit);
        }
      } catch (error) {
        if (!cancelled) {
          setStudies([]);
          setTruncated(false);
          setLoadError((error as Error)?.message || 'Failed to query the data source.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    // Debounce so typing in a filter does not fire one QIDO per keystroke.
    const timer = setTimeout(run, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dataSource, reloadToken, nameFilter, mrnFilter, dateFrom, dateTo, modalityFilter]);

  const filteredStudies = useMemo(
    () =>
      filterStudies(studies, {
        patientName: nameFilter,
        patientId: mrnFilter,
        dateFrom,
        dateTo,
        modality: modalityFilter,
      }),
    [studies, nameFilter, mrnFilter, dateFrom, dateTo, modalityFilter]
  );

  const patientGroups = useMemo(() => groupStudiesByPatient(filteredStudies), [filteredStudies]);

  // Feed the viewer's next/prev-study queue with what the worklist currently
  // shows (best-effort — the service ships with the rtmedical-theme extension
  // and may be absent in stripped-down deployments).
  useEffect(() => {
    try {
      rtmedicalWorklistQueueService?.setQueue?.(
        filteredStudies.map(study => study.studyInstanceUid)
      );
    } catch {
      /* queue is an enhancement, never block the worklist on it */
    }
  }, [filteredStudies, rtmedicalWorklistQueueService]);

  const loadSeries = useCallback(
    (studyInstanceUid: string): Promise<WorklistSeries[]> => {
      setSeriesByStudy(prev => ({ ...prev, [studyInstanceUid]: { status: 'loading' } }));
      return Promise.resolve()
        .then(() => dataSource.query.series.search(studyInstanceUid))
        .then((series: WorklistSeries[]) => {
          const ready: SeriesState = { status: 'ready', series: series || [] };
          setSeriesByStudy(prev => ({ ...prev, [studyInstanceUid]: ready }));
          return series || [];
        })
        .catch((error: Error) => {
          setSeriesByStudy(prev => ({
            ...prev,
            [studyInstanceUid]: {
              status: 'error',
              message: error?.message || 'Failed to load series.',
            },
          }));
          return [];
        });
    },
    [dataSource]
  );

  const toggleStudy = useCallback(
    (studyInstanceUid: string) => {
      const willExpand = !expandedStudies[studyInstanceUid];
      setExpandedStudies(prev => ({ ...prev, [studyInstanceUid]: !prev[studyInstanceUid] }));
      // Side effect kept OUTSIDE the state updater — StrictMode double-invokes
      // updaters and would fire the series query twice.
      const seriesState = seriesByStudy[studyInstanceUid];
      // Re-fetch on expand when missing OR when the previous attempt errored
      // (review M3 — an error otherwise blocked retry until a full refresh).
      if (willExpand && (!seriesState || seriesState.status === 'error')) {
        loadSeries(studyInstanceUid);
      }
    },
    [expandedStudies, seriesByStudy, loadSeries]
  );

  const showInfoModal = useCallback(
    async (study: WorklistStudy) => {
      if (!uiModalService) {
        return;
      }
      const cached = seriesByStudy[study.studyInstanceUid];
      // A load in flight (row being expanded) must not trigger a duplicate
      // QIDO — show what we have; the table fills in when the fetch lands.
      const series =
        cached?.status === 'ready'
          ? cached.series
          : cached?.status === 'loading'
            ? undefined
            : await loadSeries(study.studyInstanceUid);
      uiModalService.show({
        title: 'Study information',
        content: StudyInfoContent,
        contentProps: { study, series },
        containerClassName: 'max-w-3xl p-4',
      });
    },
    [uiModalService, seriesByStudy, loadSeries]
  );

  // Import → STOW: reuse the app-wide DicomUpload customization inside a
  // modal, mirroring platform/app/src/hooks/useWorkListToolbarActions.tsx.
  const DicomUploadComponent = customizationService?.getCustomization?.(
    'dicomUploadComponent'
  ) as any;
  const uploadEnabled = Boolean(
    DicomUploadComponent && dataSource?.getConfig?.()?.dicomUploadEnabled
  );

  const showImportModal = useCallback(() => {
    if (!uploadEnabled || !uiModalService) {
      return;
    }
    uiModalService.show({
      title: 'Upload files',
      containerClassName: DicomUploadComponent?.containerClassName,
      shouldCloseOnEsc: false,
      shouldCloseOnOverlayClick: false,
      content: () => (
        <DicomUploadComponent
          dataSource={dataSource}
          onComplete={() => {
            uiModalService.hide();
            refresh();
          }}
          onStarted={() => {
            /* upload started — the modal stays open until onComplete */
          }}
        />
      ),
    });
  }, [uploadEnabled, uiModalService, DicomUploadComponent, dataSource, refresh]);

  const totalStudies = filteredStudies.length;

  return (
    <div
      data-cy="rt-worklist-page"
      className="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden"
    >
      <header className="border-input flex shrink-0 flex-wrap items-end gap-3 border-b p-3">
        <h1 className="mr-4 text-lg font-medium">Worklist</h1>

        <label className="flex flex-col text-xs">
          <span className="text-muted-foreground mb-0.5">Patient name</span>
          <input
            data-cy="rt-worklist-filter-name"
            className={inputClassName}
            placeholder="e.g. Silva"
            value={nameFilter}
            onChange={event => setNameFilter(event.target.value)}
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-muted-foreground mb-0.5">MRN</span>
          <input
            data-cy="rt-worklist-filter-mrn"
            className={inputClassName}
            placeholder="Patient ID"
            value={mrnFilter}
            onChange={event => setMrnFilter(event.target.value)}
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-muted-foreground mb-0.5">From</span>
          <input
            data-cy="rt-worklist-filter-date-from"
            type="date"
            className={inputClassName}
            value={dateFrom}
            onChange={event => setDateFrom(event.target.value)}
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-muted-foreground mb-0.5">To</span>
          <input
            data-cy="rt-worklist-filter-date-to"
            type="date"
            className={inputClassName}
            value={dateTo}
            onChange={event => setDateTo(event.target.value)}
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-muted-foreground mb-0.5">Modality</span>
          <input
            data-cy="rt-worklist-filter-modality"
            className={`${inputClassName} w-20`}
            placeholder="CT"
            value={modalityFilter}
            onChange={event => setModalityFilter(event.target.value)}
          />
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button className={actionButtonClassName} onClick={refresh}>
            Refresh
          </button>
          <button
            data-cy="rt-worklist-import"
            className={actionButtonClassName}
            disabled={!uploadEnabled}
            title={
              uploadEnabled
                ? 'Upload DICOM files to the PACS (STOW-RS)'
                : 'Enable dicomUploadEnabled on the data source to import'
            }
            onClick={showImportModal}
          >
            Import
          </button>
          {/* Study merge is a PACS backend operation (not DICOMweb) — see the
              module doc-comment. Disabled until the backend integration. */}
          <button
            data-cy="rt-worklist-merge"
            className={actionButtonClassName}
            disabled
            title="Requires PACS backend integration"
          >
            Merge
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="text-muted-foreground p-6 text-center text-sm">Loading studies…</div>
        ) : loadError ? (
          <div className="p-6 text-center text-sm">
            <p className="mb-2 text-red-500">{loadError}</p>
            <button className={actionButtonClassName} onClick={refresh}>
              Retry
            </button>
          </div>
        ) : patientGroups.length === 0 ? (
          <div className="text-muted-foreground p-6 text-center text-sm">
            No studies match the current filters.
          </div>
        ) : (
          <div className="border-input overflow-x-auto rounded border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-popover text-muted-foreground text-left text-xs uppercase">
                  <th className="w-8 px-2 py-2"></th>
                  <th className="px-2 py-2">Patient</th>
                  <th className="px-2 py-2">MRN</th>
                  <th className="px-2 py-2">Studies</th>
                  <th className="px-2 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {patientGroups.map(group => {
                  const groupKey = group.patientId || `name:${group.patientName || 'unknown'}`;
                  const patientExpanded = expandedPatients[groupKey] ?? true;
                  return (
                    <React.Fragment key={groupKey}>
                      <tr
                        data-cy="rt-worklist-patient-row"
                        className="border-input bg-popover/50 hover:bg-popover cursor-pointer border-t"
                        onClick={() =>
                          setExpandedPatients(prev => ({ ...prev, [groupKey]: !patientExpanded }))
                        }
                      >
                        <td className="text-muted-foreground px-2 py-1.5">
                          {patientExpanded ? '▾' : '▸'}
                        </td>
                        <td className="px-2 py-1.5 font-medium">{group.patientName || '—'}</td>
                        <td className="px-2 py-1.5">{group.patientId || '—'}</td>
                        <td className="px-2 py-1.5">{group.studies.length}</td>
                        <td className="px-2 py-1.5"></td>
                      </tr>
                      {patientExpanded &&
                        group.studies.map(study => {
                          const row = formatStudyRow(study);
                          const studyExpanded = Boolean(
                            expandedStudies[study.studyInstanceUid]
                          );
                          const seriesState = seriesByStudy[study.studyInstanceUid];
                          const seriesCount =
                            seriesState?.status === 'ready' ? seriesState.series.length : null;
                          return (
                            <React.Fragment key={study.studyInstanceUid}>
                              <tr
                                data-cy="rt-worklist-study-row"
                                className="border-input hover:bg-popover/40 border-t"
                              >
                                <td className="px-2 py-1.5"></td>
                                <td className="px-2 py-1.5" colSpan={3}>
                                  <button
                                    className="text-muted-foreground mr-2"
                                    title={studyExpanded ? 'Collapse series' : 'Expand series'}
                                    onClick={() => toggleStudy(study.studyInstanceUid)}
                                  >
                                    {studyExpanded ? '▾' : '▸'}
                                  </button>
                                  <span className="mr-3">{row.date || 'No date'}</span>
                                  <span className="mr-3">{row.description || '—'}</span>
                                  <span className="text-muted-foreground mr-3">
                                    {row.modalities || '—'}
                                  </span>
                                  <span className="text-muted-foreground mr-3">
                                    {seriesCount != null ? `${seriesCount} series · ` : ''}
                                    {row.instances} instances
                                  </span>
                                  <span className="text-muted-foreground">
                                    {row.accession ? `Acc: ${row.accession}` : ''}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-2 py-1.5 text-right">
                                  <span className="inline-flex gap-1">
                                    <button
                                      data-cy="rt-worklist-open"
                                      className={actionButtonClassName}
                                      title="Open in the radiology viewer"
                                      onClick={() =>
                                        navigate(
                                          studyPath(
                                            'rtmedical-radiology',
                                            study.studyInstanceUid,
                                            window.location.search
                                          )
                                        )
                                      }
                                    >
                                      Open
                                    </button>
                                    <button
                                      data-cy="rt-worklist-open-rt"
                                      className={actionButtonClassName}
                                      title="Open in the radiotherapy viewer"
                                      onClick={() =>
                                        navigate(
                                          studyPath(
                                            'rtmedical-radiotherapy',
                                            study.studyInstanceUid,
                                            window.location.search
                                          )
                                        )
                                      }
                                    >
                                      Open RT
                                    </button>
                                    <button
                                      data-cy="rt-worklist-info"
                                      className={actionButtonClassName}
                                      title="Study details"
                                      onClick={() => showInfoModal(study)}
                                    >
                                      Info
                                    </button>
                                  </span>
                                </td>
                              </tr>
                              {studyExpanded && (
                                <tr className="border-input border-t">
                                  <td className="px-2"></td>
                                  <td className="px-2 py-1" colSpan={4}>
                                    {!seriesState || seriesState.status === 'loading' ? (
                                      <div className="text-muted-foreground py-1 text-xs">
                                        Loading series…
                                      </div>
                                    ) : seriesState.status === 'error' ? (
                                      <div className="py-1 text-xs text-red-500">
                                        {seriesState.message}
                                      </div>
                                    ) : seriesState.series.length === 0 ? (
                                      <div className="text-muted-foreground py-1 text-xs">
                                        No series found for this study.
                                      </div>
                                    ) : (
                                      <table className="w-full border-collapse text-xs">
                                        <thead>
                                          <tr className="text-muted-foreground text-left">
                                            <th className="w-16 py-1 pr-2">Series #</th>
                                            <th className="w-20 pr-2">Modality</th>
                                            <th className="pr-2">Description</th>
                                            <th className="w-24 text-right">Instances</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {seriesState.series.map(item => (
                                            <tr
                                              key={item.seriesInstanceUid}
                                              data-cy="rt-worklist-series-row"
                                              className="border-input border-t"
                                            >
                                              <td className="py-1 pr-2">
                                                {item.seriesNumber ?? '—'}
                                              </td>
                                              <td className="pr-2">{item.modality ?? '—'}</td>
                                              <td className="pr-2">{item.description || '—'}</td>
                                              <td className="text-right">
                                                {item.numSeriesInstances ?? '—'}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <footer className="border-input text-muted-foreground shrink-0 border-t p-2 text-xs">
        {isLoading
          ? ''
          : `${totalStudies} stud${totalStudies === 1 ? 'y' : 'ies'} · ${patientGroups.length} patient${patientGroups.length === 1 ? '' : 's'}`}
      </footer>
    </div>
  );
}

export default RtWorklistPage;
