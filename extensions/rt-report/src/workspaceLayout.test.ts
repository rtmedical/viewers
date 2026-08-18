import {
  WS_CHROME_PX,
  WS_PANEL_MAX_PX,
  WS_PANEL_MIN_PX,
  WS_TABS,
  wsAssertBinding,
  wsDescribeLayout,
  wsDetachedLayout,
  wsEvidenceGaps,
  wsMeasurementToFinding,
  wsMinViewerPx,
  wsNavigateToEvidence,
  wsPlanLayout,
  wsSwitchTab,
  type WsEvidenceRef,
  type WsMeasurement,
  type WsWorkspaceState,
} from './workspaceLayout';

const EVIDENCE: WsEvidenceRef = {
  studyInstanceUid: '1.2.840.113619.2.55.3',
  seriesInstanceUid: '1.2.840.113619.2.55.3.1',
  sopInstanceUid: '1.2.840.113619.2.55.3.1.7',
  frameNumber: 42,
};

function measurement(over: Partial<WsMeasurement> = {}): WsMeasurement {
  return {
    measurementId: 'M1',
    tool: 'length',
    value: 1.5,
    unit: 'cm',
    evidence: EVIDENCE,
    revision: 3,
    ...over,
  };
}

function workspace(over: Partial<WsWorkspaceState> = {}): WsWorkspaceState {
  return {
    activeTab: 'report',
    tabState: {},
    pendingEdits: [],
    ...over,
  };
}

/* ------------------------------------------------------------------ */

describe('wsMinViewerPx', () => {
  it('is strictest for mammography', () => {
    expect(wsMinViewerPx('MG') > wsMinViewerPx('CT')).toBe(true);
  });

  it('treats tomosynthesis like mammography', () => {
    expect(wsMinViewerPx('DBT')).toBe(wsMinViewerPx('MG'));
  });

  it('falls back to the default for an unknown modality', () => {
    expect(wsMinViewerPx('XA')).toBe(wsMinViewerPx('DEFAULT'));
  });

  it('is case-insensitive', () => {
    expect(wsMinViewerPx('mg')).toBe(wsMinViewerPx('MG'));
  });

  it('falls back for an empty modality', () => {
    expect(wsMinViewerPx('')).toBe(wsMinViewerPx('DEFAULT'));
  });
});

describe('wsPlanLayout refuses rather than squeezing the viewer', () => {
  it('gives the panel its maximum on a wide display', () => {
    const result = wsPlanLayout({ viewportPx: 1920, modality: 'CT' });
    expect(result.ok).toBe(true);
    expect(result.value.panelPx).toBe(WS_PANEL_MAX_PX);
    expect(result.value.viewerPx).toBe(1920 - WS_CHROME_PX - WS_PANEL_MAX_PX);
  });

  it('honours a dragged panel width inside the bounds', () => {
    const result = wsPlanLayout({ viewportPx: 1920, modality: 'CT', preferredPanelPx: 480 });
    expect(result.value.panelPx).toBe(480);
  });

  it('clamps a dragged width below the minimum', () => {
    const result = wsPlanLayout({ viewportPx: 1920, modality: 'CT', preferredPanelPx: 200 });
    expect(result.value.panelPx).toBe(WS_PANEL_MIN_PX);
  });

  it('clamps a dragged width above the maximum', () => {
    const result = wsPlanLayout({ viewportPx: 1920, modality: 'CT', preferredPanelPx: 900 });
    expect(result.value.panelPx).toBe(WS_PANEL_MAX_PX);
  });

  it('shrinks the panel, not the viewer, when width is tight', () => {
    const modality = 'CT';
    const min = wsMinViewerPx(modality);
    const viewportPx = WS_CHROME_PX + min + WS_PANEL_MIN_PX + 20;
    const result = wsPlanLayout({ viewportPx, modality });
    expect(result.ok).toBe(true);
    expect(result.value.viewerPx >= min).toBe(true);
    expect(result.value.panelPx < WS_PANEL_MAX_PX).toBe(true);
    expect(result.value.advisory).toContain('preservar');
  });

  it('refuses mammography side by side on a 1366 px laptop', () => {
    const result = wsPlanLayout({ viewportPx: 1366, modality: 'MG' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('viewport-too-narrow');
  });

  it('says how many pixels are missing', () => {
    const result = wsPlanLayout({ viewportPx: 1366, modality: 'MG' });
    expect(result.reason).toContain('Faltam');
    expect(result.reason).toContain('MG');
  });

  it('says out loud that shrinking the viewer is not an option', () => {
    const result = wsPlanLayout({ viewportPx: 1366, modality: 'MG' });
    expect(result.reason).toContain('esconde achados');
  });

  it('advises the second screen when one is available', () => {
    const withScreen = wsPlanLayout({
      viewportPx: 1366,
      modality: 'MG',
      secondScreenAvailable: true,
    });
    const withoutScreen = wsPlanLayout({ viewportPx: 1366, modality: 'MG' });
    expect(withScreen.reason).toContain('segunda tela');
    expect(withoutScreen.reason).toContain('tela cheia');
  });

  // The real-world discriminator, and a finding about the ticket rather than the code: on a
  // 1366 px laptop the usable width after chrome is 1270 px, so the narrowest allowed panel
  // leaves 830 px of viewer. Cross-sectional imaging fits there; mammography cannot, and no
  // panel width makes it fit.
  it('accepts CT side by side on a 1366 px laptop, with the panel squeezed', () => {
    const result = wsPlanLayout({ viewportPx: 1366, modality: 'CT' });
    expect(result.ok).toBe(true);
    expect(result.value.viewerPx >= wsMinViewerPx('CT')).toBe(true);
    expect(result.value.panelPx >= WS_PANEL_MIN_PX).toBe(true);
    expect(result.value.panelPx < WS_PANEL_MAX_PX).toBe(true);
  });

  it('refuses mammography on that same laptop no matter how narrow the panel gets', () => {
    for (const panel of [WS_PANEL_MIN_PX, 500, WS_PANEL_MAX_PX]) {
      const result = wsPlanLayout({ viewportPx: 1366, modality: 'MG', preferredPanelPx: panel });
      expect(result.ok).toBe(false);
    }
  });

  it('fits mammography on a 1920 px display by squeezing the panel, not the viewer', () => {
    const result = wsPlanLayout({ viewportPx: 1920, modality: 'MG' });
    expect(result.ok).toBe(true);
    expect(result.value.viewerPx >= wsMinViewerPx('MG')).toBe(true);
    expect(result.value.panelPx >= WS_PANEL_MIN_PX).toBe(true);
  });

  it('accepts exactly the minimum viable viewport', () => {
    const min = wsMinViewerPx('CT');
    const result = wsPlanLayout({ viewportPx: WS_CHROME_PX + min + WS_PANEL_MIN_PX, modality: 'CT' });
    expect(result.ok).toBe(true);
    expect(result.value.panelPx).toBe(WS_PANEL_MIN_PX);
    expect(result.value.viewerPx).toBe(min);
  });

  it('refuses one pixel below the minimum viable viewport', () => {
    const min = wsMinViewerPx('CT');
    const result = wsPlanLayout({
      viewportPx: WS_CHROME_PX + min + WS_PANEL_MIN_PX - 1,
      modality: 'CT',
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a nonsense viewport', () => {
    expect(wsPlanLayout({ viewportPx: 0, modality: 'CT' }).code).toBe('invalid-viewport');
    expect(wsPlanLayout({ viewportPx: Number.NaN, modality: 'CT' }).code).toBe('invalid-viewport');
  });

  it('gives the detached arrangement a panel without competing for viewer width', () => {
    const result = wsDetachedLayout({ editorWindowPx: 800, modality: 'MG' });
    expect(result.ok).toBe(true);
    expect(result.value.arrangement).toBe('detached');
    expect(result.value.viewerPx).toBe(0);
    expect(result.value.panelPx).toBe(WS_PANEL_MAX_PX);
  });

  it('refuses a detached layout with an invalid window width', () => {
    expect(wsDetachedLayout({ editorWindowPx: -1, modality: 'CT' }).code).toBe('invalid-viewport');
  });
});

describe('wsSwitchTab preserves state and protects pending edits', () => {
  it('switches to a known tab', () => {
    const result = wsSwitchTab({ state: workspace(), to: 'findings' });
    expect(result.ok).toBe(true);
    expect(result.value.state.activeTab).toBe('findings');
  });

  it('stores the scroll and selection of the tab being left', () => {
    const result = wsSwitchTab({
      state: workspace(),
      to: 'findings',
      currentTabState: { scrollTop: 320, selectionStart: 5, selectionEnd: 9 },
    });
    expect(result.value.state.tabState.report.scrollTop).toBe(320);
    expect(result.value.state.tabState.report.selectionStart).toBe(5);
  });

  it('restores the scroll and selection of the tab being entered', () => {
    const state = workspace({
      tabState: { findings: { scrollTop: 640, focusedFieldId: 'f3' } },
    });
    const result = wsSwitchTab({ state, to: 'findings' });
    expect(result.value.restored.scrollTop).toBe(640);
    expect(result.value.restored.focusedFieldId).toBe('f3');
  });

  it('starts a never-visited tab at the top', () => {
    const result = wsSwitchTab({ state: workspace(), to: 'history' });
    expect(result.value.restored.scrollTop).toBe(0);
  });

  it('survives a round trip without losing either tab state', () => {
    const first = wsSwitchTab({
      state: workspace(),
      to: 'findings',
      currentTabState: { scrollTop: 100 },
    });
    const second = wsSwitchTab({
      state: first.value.state,
      to: 'report',
      currentTabState: { scrollTop: 200 },
    });
    expect(second.value.restored.scrollTop).toBe(100);
    expect(second.value.state.tabState.findings.scrollTop).toBe(200);
  });

  it('refuses to abandon a field with an uncommitted value', () => {
    const state = workspace({
      pendingEdits: [
        { fieldId: 'diametro', tab: 'findings', draftValue: '1,5', committedValue: '' },
      ],
    });
    const result = wsSwitchTab({ state, to: 'report' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('pending-edits');
    expect(result.reason).toContain('diametro');
  });

  it('names the reason a silent revert is dangerous', () => {
    const state = workspace({
      pendingEdits: [{ fieldId: 'd', tab: 'findings', draftValue: '1,5' }],
    });
    expect(wsSwitchTab({ state, to: 'report' }).reason).toContain('viu a si mesmo digitar');
  });

  it('allows the switch once the caller resolved the edits', () => {
    const state = workspace({
      pendingEdits: [{ fieldId: 'd', tab: 'findings', draftValue: '1,5' }],
    });
    const result = wsSwitchTab({ state, to: 'report', pendingResolved: true });
    expect(result.ok).toBe(true);
    expect(result.value.state.pendingEdits.length).toBe(0);
  });

  it('does not treat an edit equal to its committed value as pending', () => {
    const state = workspace({
      pendingEdits: [{ fieldId: 'd', tab: 'findings', draftValue: '1,5', committedValue: '1,5' }],
    });
    expect(wsSwitchTab({ state, to: 'report' }).ok).toBe(true);
  });

  it('refuses an unknown tab', () => {
    expect(wsSwitchTab({ state: workspace(), to: 'billing' as never }).code).toBe('unknown-tab');
  });

  it('refuses with no state', () => {
    expect(wsSwitchTab({ state: undefined as never, to: 'report' }).code).toBe('unknown-tab');
  });

  it('lists the five tabs the ticket asks for', () => {
    expect(WS_TABS).toEqual(['report', 'findings', 'evidence', 'ai', 'history']);
  });
});

describe('wsEvidenceGaps', () => {
  it('finds nothing missing in a complete reference', () => {
    expect(wsEvidenceGaps(EVIDENCE)).toEqual([]);
  });

  it('reports every field of a missing reference', () => {
    expect(wsEvidenceGaps(undefined as never).length).toBe(4);
  });

  it('reports a missing sop instance uid', () => {
    expect(wsEvidenceGaps({ ...EVIDENCE, sopInstanceUid: '' })).toEqual(['sopInstanceUid']);
  });

  it('rejects frame zero, because DICOM counts frames from one', () => {
    expect(wsEvidenceGaps({ ...EVIDENCE, frameNumber: 0 })).toEqual(['frameNumber']);
  });

  it('rejects a fractional frame number', () => {
    expect(wsEvidenceGaps({ ...EVIDENCE, frameNumber: 1.5 })).toEqual(['frameNumber']);
  });
});

describe('wsMeasurementToFinding', () => {
  it('carries value, unit and evidence across without re-editing', () => {
    const result = wsMeasurementToFinding({ measurement: measurement(), currentRevision: 3 });
    expect(result.ok).toBe(true);
    expect(result.value.value).toBe(1.5);
    expect(result.value.unit).toBe('cm');
    expect(result.value.evidence.sopInstanceUid).toBe(EVIDENCE.sopInstanceUid);
  });

  it('writes the suggested text with a comma decimal separator', () => {
    const result = wsMeasurementToFinding({ measurement: measurement(), currentRevision: 3 });
    expect(result.value.suggestedText).toBe('1,5 cm');
  });

  it('includes the second dimension of a bidirectional measurement', () => {
    const result = wsMeasurementToFinding({
      measurement: measurement({ tool: 'bidirectional', secondValue: 1.1 }),
      currentRevision: 3,
    });
    expect(result.value.suggestedText).toBe('1,5 x 1,1 cm');
  });

  it('prefixes the label when the measurement has one', () => {
    const result = wsMeasurementToFinding({
      measurement: measurement({ label: 'Nodulo LSD' }),
      currentRevision: 3,
    });
    expect(result.value.suggestedText).toBe('Nodulo LSD: 1,5 cm');
  });

  it('refuses a measurement with no unit rather than assuming millimetres', () => {
    const result = wsMeasurementToFinding({
      measurement: measurement({ unit: undefined }),
      currentRevision: 3,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('measurement-missing-unit');
    expect(result.reason).toContain('nao parece errado');
  });

  it('refuses a measurement with a blank unit', () => {
    expect(
      wsMeasurementToFinding({ measurement: measurement({ unit: '  ' }), currentRevision: 3 }).ok
    ).toBe(false);
  });

  it('refuses a measurement with an incomplete image reference', () => {
    const result = wsMeasurementToFinding({
      measurement: measurement({ evidence: { ...EVIDENCE, sopInstanceUid: '' } }),
      currentRevision: 3,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('measurement-missing-evidence');
    expect(result.reason).toContain('rastreavel');
  });

  it('refuses a measurement that changed in the viewer', () => {
    const result = wsMeasurementToFinding({ measurement: measurement(), currentRevision: 4 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('measurement-stale');
    expect(result.reason).toContain('autoridade');
  });

  it('refuses a measurement that was deleted in the viewer', () => {
    const result = wsMeasurementToFinding({
      measurement: measurement(),
      currentRevision: 3,
      stillPresent: false,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('measurement-not-found');
    expect(result.reason).toContain('nao esta mais na imagem');
  });

  it('refuses a measurement with no numeric value', () => {
    expect(
      wsMeasurementToFinding({
        measurement: measurement({ value: Number.NaN }),
        currentRevision: 3,
      }).ok
    ).toBe(false);
  });

  it('keeps a measurement of zero, which is a value', () => {
    const result = wsMeasurementToFinding({
      measurement: measurement({ value: 0 }),
      currentRevision: 3,
    });
    expect(result.ok).toBe(true);
    expect(result.value.value).toBe(0);
  });

  it('refuses with no measurement at all', () => {
    expect(
      wsMeasurementToFinding({ measurement: undefined as never, currentRevision: 1 }).code
    ).toBe('measurement-not-found');
  });

  it('records the revision it was taken from', () => {
    const result = wsMeasurementToFinding({ measurement: measurement(), currentRevision: 3 });
    expect(result.value.sourceRevision).toBe(3);
  });
});

describe('wsNavigateToEvidence', () => {
  it('navigates to a complete reference', () => {
    const result = wsNavigateToEvidence({ evidence: EVIDENCE });
    expect(result.ok).toBe(true);
    expect(result.value.evidence.frameNumber).toBe(42);
  });

  it('reports whether there are coordinates to highlight', () => {
    const withCoords = wsNavigateToEvidence({
      evidence: { ...EVIDENCE, coordinates: [120, 240] },
    });
    const without = wsNavigateToEvidence({ evidence: EVIDENCE });
    expect(withCoords.value.hasCoordinates).toBe(true);
    expect(without.value.hasCoordinates).toBe(false);
    expect(without.value.message).toContain('nao havera marcacao');
  });

  it('refuses partial context, naming the wrong-slice outcome', () => {
    const result = wsNavigateToEvidence({
      evidence: { ...EVIDENCE, seriesInstanceUid: '' },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('evidence-incomplete');
    expect(result.reason).toContain('nao a imagem');
  });

  it('refuses when the series is not in the study', () => {
    const result = wsNavigateToEvidence({
      evidence: EVIDENCE,
      availability: [
        { seriesInstanceUid: EVIDENCE.seriesInstanceUid, loaded: false, present: false },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('evidence-unavailable');
    expect(result.reason).toContain('nada aqui');
  });

  it('refuses while the series is still loading', () => {
    const result = wsNavigateToEvidence({
      evidence: EVIDENCE,
      availability: [
        { seriesInstanceUid: EVIDENCE.seriesInstanceUid, loaded: false, present: true },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('aguarde');
  });

  it('navigates when the series is loaded', () => {
    const result = wsNavigateToEvidence({
      evidence: EVIDENCE,
      availability: [
        { seriesInstanceUid: EVIDENCE.seriesInstanceUid, loaded: true, present: true },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('ignores availability entries for other series', () => {
    const result = wsNavigateToEvidence({
      evidence: EVIDENCE,
      availability: [{ seriesInstanceUid: 'outra', loaded: false, present: false }],
    });
    expect(result.ok).toBe(true);
  });
});

describe('wsAssertBinding', () => {
  const binding = {
    patientId: 'PAC-1',
    studyInstanceUid: '1.2.3',
    reportId: 'LAU-77',
  };

  it('accepts two windows on the same case', () => {
    expect(wsAssertBinding(binding, { ...binding }).ok).toBe(true);
  });

  it('refuses when the viewer moved to another study', () => {
    const result = wsAssertBinding({ ...binding, studyInstanceUid: '9.9.9' }, binding);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('window-binding-mismatch');
    expect(result.reason).toContain('paciente errado');
  });

  it('names which fields differ', () => {
    const result = wsAssertBinding(
      { ...binding, patientId: 'PAC-9', studyInstanceUid: '9.9.9' },
      binding
    );
    expect(result.reason).toContain('patientId');
    expect(result.reason).toContain('studyInstanceUid');
  });

  it('refuses an incomplete binding', () => {
    expect(wsAssertBinding({ ...binding, reportId: '' }, binding).code).toBe('invalid-binding');
  });

  it('refuses a missing binding', () => {
    expect(wsAssertBinding(undefined as never, binding).code).toBe('invalid-binding');
  });
});

describe('wsDescribeLayout', () => {
  it('states the widths and the modality minimum', () => {
    const layout = wsPlanLayout({ viewportPx: 1920, modality: 'CT' }).value;
    const text = wsDescribeLayout(layout);
    expect(text).toContain('painel 560 px');
    expect(text).toContain('CT');
  });

  it('appends the advisory when the panel was reduced', () => {
    const min = wsMinViewerPx('CT');
    const layout = wsPlanLayout({
      viewportPx: WS_CHROME_PX + min + WS_PANEL_MIN_PX + 20,
      modality: 'CT',
    }).value;
    expect(wsDescribeLayout(layout)).toContain('preservar');
  });

  it('is empty for no layout', () => {
    expect(wsDescribeLayout(undefined as never)).toBe('');
  });
});
