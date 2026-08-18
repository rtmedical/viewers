/**
 * Reporting workspace: panel geometry, tab state, measurement handoff and evidence
 * navigation -- pure core (RTV-223).
 *
 * The ticket's stated goal is "manter os olhos do radiologista na imagem e reduzir troca de
 * contexto". Every rule here follows from that, and the useful ones are the places where the
 * obvious implementation quietly works against it.
 *
 * ## A squeezed viewer is worse than a refused layout
 *
 * The report panel is specified as 440-560 px. On a 1920 px display that leaves plenty. On a
 * 1366 px laptop -- which is what a resident on call actually has -- a 440 px panel plus
 * chrome leaves the viewer 830 px, and for a mammogram acquired at 4096 x 3328 that is a
 * display scale where a cluster of microcalcifications is **sub-pixel**.
 *
 * So the constraint is not expressed as a panel width. It is expressed as a **minimum viewer
 * width, per modality**, and when the viewport cannot satisfy both,
 * {@link wsPlanLayout} **refuses the side-by-side arrangement** and says to detach. Silently
 * shrinking the viewer is the one outcome that must not happen, because nothing on screen
 * tells the radiologist they are now reading at a scale that hides findings.
 *
 * ## Losing a cursor is annoying; losing a half-typed measurement is clinical
 *
 * Tab state is kept per tab, including scroll and selection, because the criterion asks for
 * it. But the part that matters more is the **uncommitted edit**: a field with "1,5" typed and
 * not yet committed, abandoned by a tab switch, silently reverts -- and the radiologist saw
 * themselves type it. {@link wsSwitchTab} reports pending edits rather than discarding them,
 * and the caller has to resolve them.
 *
 * ## A measurement inserted as a finding must arrive whole
 *
 * "Sem reeditar manualmente" is the criterion, and the failure it invites is a finding that
 * carries the number and loses the unit -- the same family this codebase keeps hitting, where
 * a plausible value in the wrong unit does not look wrong. {@link wsMeasurementToFinding}
 * therefore **refuses** a measurement with no declared unit instead of assuming millimetres,
 * and refuses one with no image reference, because a finding whose evidence cannot be
 * reopened is not traceable (RTV-226).
 *
 * It also refuses a measurement that has changed or been deleted in the viewport since the
 * insertion was requested. A finding asserting a number that no longer exists on the image is
 * a confident wrong answer, and the viewer is the authority for what is on the image.
 *
 * ## Clicking a finding must land on the right image or land nowhere
 *
 * Partial navigation context resolves to *an* image, not *the* image -- and the radiologist
 * then verifies a different slice and confirms a finding they never looked at.
 * {@link wsNavigateToEvidence} requires study, series, instance and frame together, and
 * refuses when the series is not available rather than landing on a blank viewport that reads
 * as "nothing there".
 *
 * ## Two windows drift
 *
 * The detached viewer and the editor are separate windows with separate lifecycles. The
 * viewer showing study A while the editor edits study B's report is not exotic: it is what
 * happens when someone opens the next case in the main window. The two are bound and
 * {@link wsAssertBinding} refuses on mismatch.
 *
 * Framework-free, no `@ohif/*`, no DOM, no clock, no randomness, no `throw`. Zero-fork per
 * RTV-114.
 */

/* ------------------------------------------------------------------ */
/* Result type                                                         */
/* ------------------------------------------------------------------ */

export type WsRefusalCode =
  | 'viewport-too-narrow'
  | 'invalid-viewport'
  | 'unknown-tab'
  | 'pending-edits'
  | 'measurement-missing-unit'
  | 'measurement-missing-evidence'
  | 'measurement-stale'
  | 'measurement-not-found'
  | 'evidence-incomplete'
  | 'evidence-unavailable'
  | 'window-binding-mismatch'
  | 'invalid-binding';

/**
 * Refusals travel as values. `value?: undefined` / `reason?: undefined` are required because
 * `strictNullChecks` is off in this repo.
 */
export type WsResult<T> =
  | { ok: true; value: T; code?: undefined; reason?: undefined }
  | { ok: false; code: WsRefusalCode; reason: string; value?: undefined };

function wsOk<T>(value: T): WsResult<T> {
  return { ok: true, value };
}

function wsRefuse<T>(code: WsRefusalCode, reason: string): WsResult<T> {
  return { ok: false, code, reason };
}

function wsText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function wsIsPositive(value: unknown): boolean {
  return typeof value === 'number' && isFinite(value) && value > 0;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                           */
/* ------------------------------------------------------------------ */

/** Report panel bounds from the ticket. */
export const WS_PANEL_MIN_PX = 440;
export const WS_PANEL_MAX_PX = 560;

/** Chrome the layout cannot give to either panel: toolbars, gutters, the bottom bar. */
export const WS_CHROME_PX = 96;

/**
 * Minimum viewer width per modality, in CSS px.
 *
 * These are not aesthetic. They are the width below which a finding this modality exists to
 * detect stops being visible at a usable display scale -- and the display scale is not
 * something the radiologist is told about.
 *
 * The numbers are derived from the acquisition matrix, which is the only thing this core
 * knows. Cross-sectional imaging is 512 x 512, so 768 px is 1.5x and comfortable. Projection
 * radiography is 2048 and up. Mammography is the strict one: a microcalcification cluster is
 * a few acquisition pixels wide on a 4096 x 3328 detector, so a heavily downscaled view
 * simply does not contain it.
 *
 * These values interact with {@link WS_PANEL_MIN_PX} in a way worth stating, because it is a
 * finding about the ticket rather than about the code. On a 1366 px laptop the usable width
 * after chrome is 1270 px, so the narrowest allowed panel leaves 830 px of viewer:
 *
 * - cross-sectional (CT, MR, PT) fits, with the panel squeezed to about 500 px;
 * - **mammography does not fit at all**, and no panel width makes it fit.
 *
 * That is the correct outcome rather than a limitation to work around: a 1366 px laptop is
 * not a display for reading mammography beside a report panel, and the refusal says so
 * instead of quietly halving the magnification.
 */
export const WS_MIN_VIEWER_PX: Record<string, number> = {
  MG: 1280,
  DBT: 1280,
  CR: 1024,
  DX: 1024,
  RTIMAGE: 1024,
  CT: 768,
  MR: 768,
  PT: 768,
  NM: 640,
  US: 640,
  DEFAULT: 768,
};

export function wsMinViewerPx(modality: string): number {
  const key = wsText(modality).toUpperCase();
  const value = WS_MIN_VIEWER_PX[key];
  return typeof value === 'number' ? value : WS_MIN_VIEWER_PX.DEFAULT;
}

export type WsArrangement = 'side-by-side' | 'detached';

export const WS_ARRANGEMENT_LABELS: Record<WsArrangement, string> = {
  'side-by-side': 'viewer e laudo na mesma tela',
  detached: 'viewer desacoplado em janela separada',
};

export interface WsLayout {
  arrangement: WsArrangement;
  panelPx: number;
  viewerPx: number;
  modality: string;
  minViewerPx: number;
  /** Present when the layout is valid but something is worth saying. */
  advisory?: string;
}

/**
 * Computes the panel geometry, or refuses the side-by-side arrangement.
 *
 * The refusal is the feature. A viewport that cannot hold both a usable viewer and the
 * narrowest allowed panel has two honest answers -- detach the viewer to a second window, or
 * use the fullscreen reporting mode -- and one dishonest one, which is to shrink the viewer
 * and say nothing. The dishonest one is what a `Math.max(0, ...)` produces by default.
 */
export function wsPlanLayout(input: {
  viewportPx: number;
  modality: string;
  /** Panel width the user dragged to, if any. */
  preferredPanelPx?: number;
  /** True when a second window is available, which changes the advice text. */
  secondScreenAvailable?: boolean;
}): WsResult<WsLayout> {
  if (!input || !wsIsPositive(input.viewportPx)) {
    return wsRefuse('invalid-viewport', 'Largura da area de trabalho invalida.');
  }
  const modality = wsText(input.modality).toUpperCase() || 'DEFAULT';
  const minViewerPx = wsMinViewerPx(modality);
  const available = input.viewportPx - WS_CHROME_PX;

  if (available < minViewerPx + WS_PANEL_MIN_PX) {
    const missing = minViewerPx + WS_PANEL_MIN_PX - available;
    return wsRefuse(
      'viewport-too-narrow',
      'Faltam ' +
        Math.ceil(missing) +
        ' px para o viewer manter ' +
        minViewerPx +
        ' px em ' +
        modality +
        ' com o painel de laudo no minimo de ' +
        WS_PANEL_MIN_PX +
        ' px. ' +
        (input.secondScreenAvailable
          ? 'Desacople o viewer para a segunda tela.'
          : 'Use o modo de laudo em tela cheia ou desacople o viewer.') +
        ' Encolher o viewer nao e opcao: nada na tela diria ao radiologista que ele passou a ler numa escala que esconde achados.'
    );
  }

  const requested = wsIsPositive(input.preferredPanelPx)
    ? (input.preferredPanelPx as number)
    : WS_PANEL_MAX_PX;
  const clampedToBounds = Math.min(WS_PANEL_MAX_PX, Math.max(WS_PANEL_MIN_PX, requested));
  const panelPx = Math.min(clampedToBounds, available - minViewerPx);
  const viewerPx = available - panelPx;

  const advisory =
    panelPx < clampedToBounds
      ? 'Painel reduzido a ' +
        panelPx +
        ' px para preservar ' +
        minViewerPx +
        ' px de viewer em ' +
        modality +
        '.'
      : undefined;

  return wsOk({ arrangement: 'side-by-side', panelPx, viewerPx, modality, minViewerPx, advisory });
}

/** Geometry for the detached arrangement, where the panel is not competing for width. */
export function wsDetachedLayout(input: {
  editorWindowPx: number;
  modality: string;
}): WsResult<WsLayout> {
  if (!input || !wsIsPositive(input.editorWindowPx)) {
    return wsRefuse('invalid-viewport', 'Largura da janela do editor invalida.');
  }
  const modality = wsText(input.modality).toUpperCase() || 'DEFAULT';
  const panelPx = Math.min(
    WS_PANEL_MAX_PX,
    Math.max(WS_PANEL_MIN_PX, input.editorWindowPx - WS_CHROME_PX)
  );
  return wsOk({
    arrangement: 'detached',
    panelPx,
    viewerPx: 0,
    modality,
    minViewerPx: wsMinViewerPx(modality),
  });
}

/* ------------------------------------------------------------------ */
/* Tabs                                                              */
/* ------------------------------------------------------------------ */

export type WsTab = 'report' | 'findings' | 'evidence' | 'ai' | 'history';

export const WS_TABS: WsTab[] = ['report', 'findings', 'evidence', 'ai', 'history'];

export const WS_TAB_LABELS: Record<WsTab, string> = {
  report: 'Laudo',
  findings: 'Achados',
  evidence: 'Evidencia',
  ai: 'IA',
  history: 'Historico',
};

export interface WsTabState {
  scrollTop: number;
  /** Selection offsets inside the tab's text, when it has text. */
  selectionStart?: number;
  selectionEnd?: number;
  /** Field the caret was in, so focus returns to the same place. */
  focusedFieldId?: string;
}

/** A field whose typed value has not been committed to the document yet. */
export interface WsPendingEdit {
  fieldId: string;
  tab: WsTab;
  draftValue: string;
  committedValue?: string;
}

export interface WsWorkspaceState {
  activeTab: WsTab;
  tabState: Partial<Record<WsTab, WsTabState>>;
  pendingEdits?: WsPendingEdit[];
}

export interface WsTabSwitch {
  state: WsWorkspaceState;
  /** Edits that would be lost. Empty when the switch is clean. */
  pending: WsPendingEdit[];
  restored: WsTabState;
}

/**
 * Switches tabs, preserving per-tab scroll and selection, and reporting pending edits.
 *
 * Losing the scroll position is annoying. Losing a field with "1,5" typed into it is
 * clinical: the value silently reverts and the radiologist watched themselves type it, so
 * they have no reason to check. The switch is refused until the caller resolves the pending
 * edits, which it does by committing or discarding them deliberately.
 */
export function wsSwitchTab(input: {
  state: WsWorkspaceState;
  to: WsTab;
  /** Scroll and selection of the tab being left. */
  currentTabState?: WsTabState;
  /** Set once the caller has committed or discarded the pending edits. */
  pendingResolved?: boolean;
}): WsResult<WsTabSwitch> {
  if (!input || !input.state) {
    return wsRefuse('unknown-tab', 'Estado do painel de laudo ausente.');
  }
  const state = input.state;
  if (WS_TABS.indexOf(input.to) < 0) {
    return wsRefuse('unknown-tab', 'Aba desconhecida: ' + String(input.to) + '.');
  }

  const pending = (state.pendingEdits ?? []).filter(
    e => e && wsText(e.fieldId) && e.draftValue !== e.committedValue
  );
  if (pending.length && input.pendingResolved !== true) {
    return wsRefuse(
      'pending-edits',
      pending.length +
        ' campo(s) com valor digitado e nao confirmado (' +
        pending.map(e => e.fieldId).join(', ') +
        ') -- trocar de aba agora os reverteria em silencio, e o radiologista viu a si mesmo digitar.'
    );
  }

  const tabState: Partial<Record<WsTab, WsTabState>> = { ...(state.tabState ?? {}) };
  if (input.currentTabState) {
    tabState[state.activeTab] = input.currentTabState;
  }
  const restored = tabState[input.to] ?? { scrollTop: 0 };

  return wsOk({
    state: {
      activeTab: input.to,
      tabState,
      pendingEdits: input.pendingResolved === true ? [] : state.pendingEdits,
    },
    pending: [],
    restored,
  });
}

/* ------------------------------------------------------------------ */
/* Evidence reference                                                 */
/* ------------------------------------------------------------------ */

/** Everything needed to reopen exactly one image. */
export interface WsEvidenceRef {
  studyInstanceUid: string;
  seriesInstanceUid: string;
  sopInstanceUid: string;
  /** 1-based, as DICOM counts frames. */
  frameNumber: number;
  /** Image coordinates of the finding, when it has them. */
  coordinates?: number[];
}

export const WS_EVIDENCE_FIELDS = [
  'studyInstanceUid',
  'seriesInstanceUid',
  'sopInstanceUid',
  'frameNumber',
] as const;

export function wsEvidenceGaps(ref: WsEvidenceRef): string[] {
  const gaps: string[] = [];
  if (!ref) {
    return WS_EVIDENCE_FIELDS.slice();
  }
  if (!wsText(ref.studyInstanceUid)) {
    gaps.push('studyInstanceUid');
  }
  if (!wsText(ref.seriesInstanceUid)) {
    gaps.push('seriesInstanceUid');
  }
  if (!wsText(ref.sopInstanceUid)) {
    gaps.push('sopInstanceUid');
  }
  if (
    typeof ref.frameNumber !== 'number' ||
    !isFinite(ref.frameNumber) ||
    ref.frameNumber < 1 ||
    Math.floor(ref.frameNumber) !== ref.frameNumber
  ) {
    gaps.push('frameNumber');
  }
  return gaps;
}

/* ------------------------------------------------------------------ */
/* Measurement handoff                                                */
/* ------------------------------------------------------------------ */

export interface WsMeasurement {
  measurementId: string;
  /** Tool that produced it: length, bidirectional, ellipse, angle. */
  tool: string;
  value: number;
  /** Required. There is no default. */
  unit?: string;
  /** Second dimension for a bidirectional measurement. */
  secondValue?: number;
  evidence: WsEvidenceRef;
  /** Revision of the measurement in the viewport, so staleness is detectable. */
  revision: number;
  label?: string;
}

export interface WsFindingDraft {
  measurementId: string;
  tool: string;
  value: number;
  unit: string;
  secondValue?: number;
  evidence: WsEvidenceRef;
  sourceRevision: number;
  /** Text the finding block starts from, assembled from the measurement. */
  suggestedText: string;
}

/**
 * Turns a viewport measurement into a finding draft.
 *
 * Refuses a measurement with no unit rather than assuming millimetres. This is the failure
 * family that shows up in every module here: the same number in cm and in mm differs by ten,
 * and a plausible value in the wrong unit does not look wrong to anyone. "Sem reeditar
 * manualmente" cannot be bought by guessing the unit.
 *
 * Refuses a measurement whose revision has moved: the viewport is the authority for what is
 * on the image, and a finding asserting a number the image no longer carries is a confident
 * wrong answer.
 */
export function wsMeasurementToFinding(input: {
  measurement: WsMeasurement;
  /** Revision the viewport currently reports for this measurement. */
  currentRevision: number;
  /** False when the measurement has been deleted in the viewport. */
  stillPresent?: boolean;
}): WsResult<WsFindingDraft> {
  if (!input || !input.measurement) {
    return wsRefuse('measurement-not-found', 'Medida ausente.');
  }
  const measurement = input.measurement;

  if (input.stillPresent === false) {
    return wsRefuse(
      'measurement-not-found',
      'A medida foi apagada no viewer -- inserir agora criaria um achado que afirma um numero que nao esta mais na imagem.'
    );
  }
  if (!wsText(measurement.measurementId)) {
    return wsRefuse('measurement-not-found', 'Medida sem identificador.');
  }
  if (typeof measurement.value !== 'number' || !isFinite(measurement.value)) {
    return wsRefuse('measurement-not-found', 'Medida sem valor numerico.');
  }
  if (!wsText(measurement.unit)) {
    return wsRefuse(
      'measurement-missing-unit',
      'Medida sem unidade declarada -- inserir assumindo milimetro poe no laudo um valor plausivel na unidade errada, que nao parece errado para ninguem.'
    );
  }

  const gaps = wsEvidenceGaps(measurement.evidence);
  if (gaps.length) {
    return wsRefuse(
      'measurement-missing-evidence',
      'Medida sem referencia de imagem completa (falta: ' +
        gaps.join(', ') +
        ') -- um achado cuja evidencia nao pode ser reaberta nao e rastreavel.'
    );
  }

  if (
    typeof measurement.revision === 'number' &&
    typeof input.currentRevision === 'number' &&
    measurement.revision !== input.currentRevision
  ) {
    return wsRefuse(
      'measurement-stale',
      'A medida mudou no viewer desde o pedido de insercao (revisao ' +
        measurement.revision +
        ' contra ' +
        input.currentRevision +
        ') -- o viewer e a autoridade sobre o que esta na imagem.'
    );
  }

  const unit = wsText(measurement.unit);
  const primary = String(measurement.value).replace('.', ',');
  const secondary =
    typeof measurement.secondValue === 'number' && isFinite(measurement.secondValue)
      ? ' x ' + String(measurement.secondValue).replace('.', ',')
      : '';
  const label = wsText(measurement.label);

  return wsOk({
    measurementId: wsText(measurement.measurementId),
    tool: wsText(measurement.tool),
    value: measurement.value,
    unit,
    secondValue: measurement.secondValue,
    evidence: measurement.evidence,
    sourceRevision: measurement.revision,
    suggestedText: (label ? label + ': ' : '') + primary + secondary + ' ' + unit,
  });
}

/* ------------------------------------------------------------------ */
/* Evidence navigation                                                */
/* ------------------------------------------------------------------ */

export interface WsSeriesAvailability {
  seriesInstanceUid: string;
  loaded: boolean;
  /** False when the series is not in the study at all, e.g. a prior that was unloaded. */
  present: boolean;
}

export interface WsNavigationTarget {
  evidence: WsEvidenceRef;
  /** True when the finding carried coordinates to highlight. */
  hasCoordinates: boolean;
  message: string;
}

/**
 * Resolves a click on a finding into a navigation target.
 *
 * Requires the four identity fields together. Partial context resolves to *an* image rather
 * than *the* image, and the radiologist then verifies a different slice and confirms a finding
 * they never looked at -- which is worse than the click doing nothing.
 *
 * An unavailable series refuses too, rather than navigating to a blank viewport: a blank
 * viewport reads as "nada aqui", which is a statement about the patient rather than about the
 * loading.
 */
export function wsNavigateToEvidence(input: {
  evidence: WsEvidenceRef;
  availability?: WsSeriesAvailability[];
}): WsResult<WsNavigationTarget> {
  const gaps = wsEvidenceGaps(input?.evidence);
  if (gaps.length) {
    return wsRefuse(
      'evidence-incomplete',
      'Referencia de imagem incompleta (falta: ' +
        gaps.join(', ') +
        ') -- navegar com contexto parcial abre uma imagem, nao a imagem, e o radiologista confirmaria um achado que nao olhou.'
    );
  }
  const evidence = input.evidence;
  const availability = (input.availability ?? []).filter(Boolean);
  const series = availability.filter(
    a => wsText(a.seriesInstanceUid) === wsText(evidence.seriesInstanceUid)
  )[0];

  if (series && series.present === false) {
    return wsRefuse(
      'evidence-unavailable',
      'A serie da evidencia nao esta neste estudo -- um viewport vazio seria lido como "nada aqui", que e uma afirmacao sobre o paciente e nao sobre o carregamento.'
    );
  }
  if (series && series.loaded === false) {
    return wsRefuse(
      'evidence-unavailable',
      'A serie da evidencia ainda nao foi carregada -- aguarde o carregamento em vez de abrir um viewport vazio.'
    );
  }

  const hasCoordinates = Array.isArray(evidence.coordinates) && evidence.coordinates.length > 0;

  return wsOk({
    evidence,
    hasCoordinates,
    message: hasCoordinates
      ? 'Navegando para o quadro ' + evidence.frameNumber + ' com a marcacao do achado.'
      : 'Navegando para o quadro ' +
        evidence.frameNumber +
        ' -- o achado nao carrega coordenadas, entao nao havera marcacao.',
  });
}

/* ------------------------------------------------------------------ */
/* Two-window binding                                                */
/* ------------------------------------------------------------------ */

export interface WsWindowBinding {
  patientId: string;
  studyInstanceUid: string;
  reportId: string;
}

/**
 * Checks that the detached viewer and the editor are on the same case.
 *
 * Not exotic: it is what happens when somebody opens the next case in the main window while
 * the editor still holds the previous report. The viewer then shows study A, the editor edits
 * study B's report, and a measurement handed from one to the other lands on the wrong
 * patient.
 */
export function wsAssertBinding(
  viewer: WsWindowBinding,
  editor: WsWindowBinding
): WsResult<WsWindowBinding> {
  if (!viewer || !editor) {
    return wsRefuse('invalid-binding', 'Vinculo entre as janelas ausente.');
  }
  const fields: Array<keyof WsWindowBinding> = ['patientId', 'studyInstanceUid', 'reportId'];
  for (const field of fields) {
    if (!wsText(viewer[field]) || !wsText(editor[field])) {
      return wsRefuse('invalid-binding', 'Vinculo entre as janelas sem ' + field + '.');
    }
  }
  const differing = fields.filter(field => wsText(viewer[field]) !== wsText(editor[field]));
  if (differing.length) {
    return wsRefuse(
      'window-binding-mismatch',
      'O viewer desacoplado e o editor estao em casos diferentes (' +
        differing.join(', ') +
        ') -- uma medida passada de um para o outro cairia no paciente errado.'
    );
  }
  return wsOk({
    patientId: wsText(editor.patientId),
    studyInstanceUid: wsText(editor.studyInstanceUid),
    reportId: wsText(editor.reportId),
  });
}

/* ------------------------------------------------------------------ */
/* Readouts                                                           */
/* ------------------------------------------------------------------ */

/** One line for the layout debug chip. */
export function wsDescribeLayout(layout: WsLayout): string {
  if (!layout) {
    return '';
  }
  const base =
    WS_ARRANGEMENT_LABELS[layout.arrangement] +
    ': painel ' +
    layout.panelPx +
    ' px, viewer ' +
    layout.viewerPx +
    ' px (minimo ' +
    layout.minViewerPx +
    ' px em ' +
    layout.modality +
    ')';
  return layout.advisory ? base + '. ' + layout.advisory : base + '.';
}
