/**
 * IHE Invoke Image Display (IID) entry point (RTV-157), served at
 * /ihe-invoke — plus the conformance alias /IHEInvokeImageDisplay, the URL
 * component the profile itself uses — through the `routes.customRoutes`
 * customization (see getCustomizationModule.ts). The app router injects
 * `servicesManager`/`extensionManager` props; the customization module binds
 * them from its closure as a fallback (same contract as RtWorklistPage).
 *
 * Flow (all parsing lives in the PURE iheInvoke.ts):
 *   - requestType=STUDY / STUDYBASE64 → one QIDO study query per Study
 *     Instance UID to learn ModalitiesInStudy; if ANY study contains a
 *     radiotherapy modality (RTPLAN/RTDOSE/RTSTRUCT/RTIMAGE) the set opens in
 *     the 'rtmedical-radiotherapy' mode, otherwise 'rtmedical-radiology'
 *     (mode auto-selection, RTV-157 acceptance). QIDO failures are tolerated
 *     best-effort: the study still opens, defaulting to radiology.
 *   - requestType=PATIENT (best-effort per the profile) → QIDO studies by
 *     PatientID (exact match, wildcards disabled): exactly one study opens
 *     directly (mode auto-selected the same way); zero or many navigate to
 *     /worklist-rt pre-filtered by that MRN so the user picks.
 *   - invalid request → error panel with the reason and a link to the
 *     worklist.
 *
 * Navigation uses react-router navigate() with app-relative paths (the app
 * mounts under a basename — production serves at /viewer — so location.href
 * would 404) and `replace: true` so Back does not re-trigger the invocation.
 */
import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  modeRouteForStudy,
  parseIheRequest,
  studyPath,
  worklistPathForPatient,
} from './iheInvoke';
import { WorklistStudy, splitModalities } from './worklistModel';
import { getActiveDataSource, initializeDataSourceOnce } from './dataSourceUtils';

interface ManagersProps {
  servicesManager?: { services?: Record<string, any> };
  extensionManager?: {
    getActiveDataSource?: () => any[];
    getDataSources?: (name?: string) => any[];
  };
}

export function IheInvokePage(props: ManagersProps): React.ReactElement {
  const { extensionManager } = props;
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const fail = (reason: string) => {
      if (!cancelled) {
        setError(reason);
      }
    };

    const run = async () => {
      const request = parseIheRequest(location.search);
      if (request.kind === 'invalid') {
        fail(request.reason);
        return;
      }

      const dataSource = getActiveDataSource(extensionManager);
      if (!dataSource?.query?.studies?.search) {
        fail('No active data source (or it does not support study search).');
        return;
      }
      // Direct entry: the QIDO client and auth-header getter only exist
      // after initialize() (same gotcha as /worklist-rt direct entry).
      await initializeDataSourceOnce(dataSource);

      if (request.kind === 'study') {
        // One QIDO per UID to learn ModalitiesInStudy. Failures/empty results
        // are tolerated (best-effort) — the viewer mode re-queries anyway;
        // with no modality information the set defaults to radiology.
        const results: WorklistStudy[][] = await Promise.all(
          request.studyUids.map(uid =>
            Promise.resolve()
              .then(() => dataSource.query.studies.search({ studyInstanceUid: uid }))
              .catch(() => [] as WorklistStudy[])
          )
        );
        if (cancelled) {
          return;
        }
        const modalities = results
          .flat()
          .flatMap(study => splitModalities(study?.modalities));
        const mode = modeRouteForStudy(modalities);
        navigate(studyPath(mode, request.studyUids, location.search), { replace: true });
        return;
      }

      // kind === 'patient' (best-effort): exact PatientID match.
      let studies: WorklistStudy[] = [];
      try {
        studies =
          (await dataSource.query.studies.search({
            patientId: request.patientId,
            disableWildcard: true,
          })) || [];
      } catch (queryError) {
        studies = [];
      }
      if (cancelled) {
        return;
      }
      if (studies.length === 1) {
        const mode = modeRouteForStudy(splitModalities(studies[0].modalities));
        navigate(studyPath(mode, studies[0].studyInstanceUid, location.search), {
          replace: true,
        });
      } else {
        // Zero or many studies: let the user pick on the MRN-filtered
        // worklist (zero shows an empty, clearly-filtered list there).
        navigate(worklistPathForPatient(request.patientId, location.search), { replace: true });
      }
    };

    run().catch(runError =>
      fail((runError as Error)?.message || 'Failed to resolve the IHE Invoke Image Display request.')
    );
    return () => {
      cancelled = true;
    };
    // The invocation is resolved once per URL — location.search is the input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  return (
    <div
      data-cy="rt-ihe-page"
      className="bg-background text-foreground flex h-screen w-screen flex-col items-center justify-center p-6"
    >
      {error ? (
        <div
          data-cy="rt-ihe-error"
          className="border-input max-w-xl rounded border p-6 text-center text-sm"
        >
          <h1 className="mb-2 text-lg font-medium">Invalid Invoke Image Display request</h1>
          <p className="mb-4 text-red-500">{error}</p>
          <Link
            to="/worklist-rt"
            className="border-input text-foreground hover:bg-popover rounded border px-3 py-1 text-xs"
          >
            Go to the worklist
          </Link>
        </div>
      ) : (
        <div className="text-muted-foreground text-sm">Resolving study…</div>
      )}
    </div>
  );
}

export default IheInvokePage;
