import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ImageDetailsPanel from './ImageDetailsPanel';
import {
  IMG_DISPLAY_ABSENT,
  IMG_DISPLAY_NOT_APPLICABLE,
  IMG_VALUE_STATE_ABSENT,
  IMG_VALUE_STATE_NOT_APPLICABLE,
  IMG_VALUE_STATE_PRESENT,
  imgBuildDetailRows,
  type ImgImagingEvent,
  type ImgTreatmentSession,
} from '../imageDetails';

const T0 = 1_760_000_000_000;
const MIN = 60_000;

function event(over: Partial<ImgImagingEvent> = {}): ImgImagingEvent {
  return {
    eventId: 'EV-1',
    patientId: 'PAC-1',
    courseId: 'CUR-1',
    metadata: {
      instanceUid: '1.2.840.1.1',
      modality: 'KV',
      acquiredAtMs: T0 + 5 * MIN,
      machineName: 'TrueBeam-1',
      sessionRef: 'SES-12',
      fractionNumber: 12,
      kvp: { value: 120, unit: 'kV' },
      tubeCurrent: { value: 80, unit: 'mA' },
      sid: { value: 1000, unit: 'mm' },
      revision: 3,
    },
    preview: { instanceUid: '1.2.840.1.1', revision: 3, renderedAtMs: T0 + 6 * MIN },
    ...over,
  };
}

function session(over: Partial<ImgTreatmentSession> = {}): ImgTreatmentSession {
  return {
    sessionId: 'SES-12',
    patientId: 'PAC-1',
    courseId: 'CUR-1',
    fractionNumber: 12,
    startedAtMs: T0,
    endedAtMs: T0 + 20 * MIN,
    ...over,
  };
}

function renderPanel(over: Record<string, unknown> = {}) {
  return render(
    <ImageDetailsPanel
      events={[event()]}
      currentEventId="EV-1"
      sessions={[session()]}
      nowMs={T0 + 10 * MIN}
      {...(over as never)}
    />
  );
}

function threeEvents(): ImgImagingEvent[] {
  const a = event({ eventId: 'A' });
  const b = event({ eventId: 'B' });
  const c = event({ eventId: 'C' });
  a.metadata.acquiredAtMs = T0 + 1 * MIN;
  b.metadata.acquiredAtMs = T0 + 2 * MIN;
  c.metadata.acquiredAtMs = T0 + 3 * MIN;
  b.metadata.instanceUid = '1.2.840.1.2';
  c.metadata.instanceUid = '1.2.840.1.3';
  b.preview = { instanceUid: '1.2.840.1.2', revision: 3, renderedAtMs: T0 + 2 * MIN };
  c.preview = { instanceUid: '1.2.840.1.3', revision: 3, renderedAtMs: T0 + 3 * MIN };
  c.metadata.modality = 'MV';
  return [a, b, c];
}

/* ------------------------------------------------------------------ */

describe('ImageDetailsPanel: a string exibida vem do nucleo', () => {
  it('ausente aparece com a string do nucleo, nunca como 0 nem como traco', () => {
    const e = event();
    e.metadata.tubeCurrent = undefined;
    renderPanel({ events: [e] });
    const cell = screen.getByTestId('img-value-tubeCurrent');
    expect(cell.textContent).toBe(IMG_DISPLAY_ABSENT);
    expect(cell.textContent).not.toBe('0');
    expect(cell.textContent).not.toBe('-');
    expect(cell.textContent).not.toBe('');
  });

  it('nao aplicavel tem string propria, distinta de ausente', () => {
    const e = event();
    e.metadata.beamEnergy = { notApplicable: true };
    renderPanel({ events: [e] });
    // Em KV, beamEnergy nao se aplica: o nucleo emite a linha como nao aplicavel.
    const cell = screen.getByTestId('img-value-beamEnergy');
    expect(cell.textContent).toBe(IMG_DISPLAY_NOT_APPLICABLE);
    expect(IMG_DISPLAY_NOT_APPLICABLE).not.toBe(IMG_DISPLAY_ABSENT);
  });

  it('cada celula imprime exatamente o display do nucleo', () => {
    const e = event();
    e.metadata.tubeCurrent = undefined;
    renderPanel({ events: [e] });
    const table = imgBuildDetailRows(e);
    for (const row of table.value.rows) {
      expect(screen.getByTestId(`img-value-${row.key}`).textContent).toBe(row.display);
    }
  });

  it('marca o estado do valor e da unidade na linha', () => {
    const e = event();
    e.metadata.tubeCurrent = undefined;
    renderPanel({ events: [e] });
    expect(screen.getByTestId('img-row-tubeCurrent').getAttribute('data-state')).toBe(
      IMG_VALUE_STATE_ABSENT
    );
    expect(screen.getByTestId('img-row-kvp').getAttribute('data-state')).toBe(
      IMG_VALUE_STATE_PRESENT
    );
  });

  it('zero real de exposicao aparece como valor presente, nao como ausente', () => {
    const e = event();
    e.metadata.exposure = { value: 0, unit: 'mAs' };
    renderPanel({ events: [e] });
    const row = screen.getByTestId('img-row-exposure');
    expect(row.getAttribute('data-state')).toBe(IMG_VALUE_STATE_PRESENT);
    expect(screen.getByTestId('img-value-exposure').textContent).not.toBe(IMG_DISPLAY_ABSENT);
  });

  it('valor sem unidade declarada carrega a ressalva na propria celula', () => {
    const e = event();
    e.metadata.sid = 1000 as never;
    renderPanel({ events: [e] });
    const cell = screen.getByTestId('img-value-sid');
    expect(cell.textContent).toContain('unidade');
    // O numero cru nao aparece sozinho, sem a ressalva.
    expect(cell.textContent).not.toBe('1000');
  });

  it('conta os tres estados e avisa sobre unidades nao confiaveis', () => {
    const e = event();
    e.metadata.sid = 1000 as never;
    renderPanel({ events: [e] });
    expect(screen.getByTestId('img-state-counts').textContent).toContain('nao informado');
    expect(screen.getByTestId('img-unit-warnings').textContent).toContain('nao comparaveis');
  });

  it('recusa a tabela inteira quando a modalidade e desconhecida', () => {
    const e = event();
    e.metadata.modality = 'RESSONANCIA';
    renderPanel({ events: [e] });
    expect(screen.getByTestId('img-rows-refused')).toBeTruthy();
    expect(screen.getByTestId('img-rows-refused-reason').getAttribute('data-code')).toBe(
      'IMG_MODALITY_UNSUPPORTED'
    );
    expect(screen.queryByTestId('img-table')).toBeNull();
  });
});

describe('ImageDetailsPanel: as setas nao dao a volta', () => {
  it('avanca no meio da lista', () => {
    let target: string | null = null;
    renderPanel({
      events: threeEvents(),
      currentEventId: 'A',
      onNavigate: (id: string) => { target = id; },
    });
    fireEvent.click(screen.getByTestId('img-next'));
    expect(target).toBe('B');
  });

  it('na ultima imagem RECUSA em vez de voltar para a primeira', () => {
    let target: string | null = null;
    renderPanel({
      events: threeEvents(),
      currentEventId: 'C',
      onNavigate: (id: string) => { target = id; },
    });
    fireEvent.click(screen.getByTestId('img-next'));
    expect(target).toBe(null);
    expect(screen.getByTestId('img-nav-refusal').textContent.length > 0).toBe(true);
  });

  it('na primeira imagem RECUSA em vez de ir para a ultima', () => {
    let target: string | null = null;
    renderPanel({
      events: threeEvents(),
      currentEventId: 'A',
      onNavigate: (id: string) => { target = id; },
    });
    fireEvent.click(screen.getByTestId('img-prev'));
    expect(target).toBe(null);
    expect(screen.getByTestId('img-nav-refusal')).toBeTruthy();
  });

  it('a recusa desaparece quando a navegacao seguinte funciona', () => {
    renderPanel({ events: threeEvents(), currentEventId: 'A' });
    fireEvent.click(screen.getByTestId('img-prev'));
    expect(screen.getByTestId('img-nav-refusal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('img-next'));
    expect(screen.queryByTestId('img-nav-refusal')).toBeNull();
  });

  it('diz dentro de que lista as setas andam', () => {
    renderPanel({ events: threeEvents(), currentEventId: 'A' });
    expect(screen.getByTestId('img-scope').textContent.length > 0).toBe(true);
  });

  it('conta as imagens fora do recorte quando ha filtro', () => {
    renderPanel({
      events: threeEvents(),
      currentEventId: 'A',
      filter: { modality: 'KV' },
    });
    expect(screen.getByTestId('img-hidden-count').textContent).toContain('1 imagem');
    expect(screen.getByTestId('img-hidden-count').textContent).toContain('nao alcancavel');
  });

  it('nao mostra contagem de escondidas quando nao ha filtro', () => {
    renderPanel({ events: threeEvents(), currentEventId: 'A' });
    expect(screen.queryByTestId('img-hidden-count')).toBeNull();
  });

  it('navega a lista FILTRADA, nao o curso inteiro', () => {
    let target: string | null = null;
    renderPanel({
      events: threeEvents(),
      currentEventId: 'B',
      filter: { modality: 'KV' },
      onNavigate: (id: string) => { target = id; },
    });
    // Dentro do recorte KV, B e a ultima (C e MV): avancar tem de recusar.
    fireEvent.click(screen.getByTestId('img-next'));
    expect(target).toBe(null);
    expect(screen.getByTestId('img-nav-refusal')).toBeTruthy();
  });
});

describe('ImageDetailsPanel: fracao ambigua nao vira um numero', () => {
  it('mostra a sessao e a evidencia quando resolvida', () => {
    renderPanel();
    const text = screen.getByTestId('img-session').textContent;
    expect(text).toContain('SES-12');
    expect(text).toContain('fracao 12');
  });

  it('marca a confianca da resolucao', () => {
    renderPanel();
    expect(screen.getByTestId('img-session').getAttribute('data-confidence')).toBe('explicit');
  });

  it('mostra a recusa quando a referencia contradiz o horario', () => {
    const e = event();
    e.metadata.acquiredAtMs = T0 + 500 * MIN;
    renderPanel({ events: [e] });
    expect(screen.getByTestId('img-session-refused').getAttribute('data-code')).toBe(
      'IMG_SESSION_REF_TIME_CONFLICT'
    );
    expect(screen.queryByTestId('img-session')).toBeNull();
  });

  it('mostra a recusa quando o horario cai entre duas sessoes', () => {
    const e = event();
    e.metadata.sessionRef = undefined;
    e.metadata.acquiredAtMs = T0 + 30 * MIN;
    renderPanel({
      events: [e],
      sessions: [
        session({ sessionId: 'S1', endedAtMs: T0 + 20 * MIN }),
        session({ sessionId: 'S2', startedAtMs: T0 + 40 * MIN, endedAtMs: T0 + 60 * MIN }),
      ],
    });
    expect(screen.getByTestId('img-session-refused')).toBeTruthy();
  });
});

describe('ImageDetailsPanel: previa e metadados juntos exigem emparelhamento', () => {
  it('confirma o emparelhamento quando UID e revisao coincidem', () => {
    renderPanel();
    expect(screen.getByTestId('img-preview-paired').textContent).toContain('mesma instancia');
  });

  it('nao desenha os dois juntos quando a previa e de outra instancia', () => {
    const e = event();
    e.preview = { instanceUid: '9.9.9', revision: 3, renderedAtMs: T0 };
    renderPanel({ events: [e] });
    expect(screen.getByTestId('img-preview-unpaired-reason').getAttribute('data-code')).toBe(
      'IMG_PREVIEW_MISMATCH'
    );
    expect(screen.queryByTestId('img-preview-paired')).toBeNull();
  });

  it('nao desenha os dois quando a previa e de revisao anterior', () => {
    const e = event();
    e.preview = { instanceUid: '1.2.840.1.1', revision: 2, renderedAtMs: T0 };
    renderPanel({ events: [e] });
    expect(screen.getByTestId('img-preview-unpaired-reason').getAttribute('data-code')).toBe(
      'IMG_PREVIEW_STALE_REVISION'
    );
  });

  it('explica por que a previa nao aparece ao lado dos numeros', () => {
    const e = event();
    e.preview = { instanceUid: '9.9.9', revision: 3, renderedAtMs: T0 };
    renderPanel({ events: [e] });
    expect(screen.getByTestId('img-preview-unpaired').textContent).toContain(
      'mesma aquisicao'
    );
  });
});

describe('ImageDetailsPanel: troca para Revisao Offline', () => {
  it('prepara a troca com contexto completo', () => {
    let ok: boolean | null = null;
    renderPanel({ onSwitchToOfflineReview: (o: { ok: boolean }) => { ok = o.ok; } });
    fireEvent.click(screen.getByTestId('img-switch-offline'));
    expect(ok).toBe(true);
    expect(screen.queryByTestId('img-switch-refusal')).toBeNull();
  });

  it('recusa quando a fracao nao pode ser resolvida', () => {
    const e = event();
    e.metadata.acquiredAtMs = T0 + 500 * MIN;
    renderPanel({ events: [e] });
    fireEvent.click(screen.getByTestId('img-switch-offline'));
    expect(screen.getByTestId('img-switch-refusal').textContent).toContain('Contexto incompleto');
  });

  it('recusa quando a previa nao esta emparelhada', () => {
    const e = event();
    e.preview = { instanceUid: '9.9.9', revision: 3, renderedAtMs: T0 };
    renderPanel({ events: [e] });
    fireEvent.click(screen.getByTestId('img-switch-offline'));
    expect(screen.getByTestId('img-switch-refusal')).toBeTruthy();
  });

  it('recusa fracao inferida sem reconhecimento humano', () => {
    const e = event();
    e.metadata.sessionRef = undefined;
    renderPanel({ events: [e] });
    fireEvent.click(screen.getByTestId('img-switch-offline'));
    expect(screen.getByTestId('img-switch-refusal').textContent.length > 0).toBe(true);
  });

  it('aceita fracao inferida uma vez reconhecida', () => {
    const e = event();
    e.metadata.sessionRef = undefined;
    let ok: boolean | null = null;
    renderPanel({
      events: [e],
      acknowledgedInferredSession: true,
      onSwitchToOfflineReview: (o: { ok: boolean }) => { ok = o.ok; },
    });
    fireEvent.click(screen.getByTestId('img-switch-offline'));
    expect(ok).toBe(true);
  });

  it('reporta revisao nao salva como pendencia, nao a descarta', () => {
    let status: string | null = null;
    renderPanel({
      unsavedReview: { hasUnsavedNote: true },
      onSwitchToOfflineReview: (o: { ok: boolean; value?: { status: string } }) => {
        status = o.ok ? o.value.status : null;
      },
    });
    fireEvent.click(screen.getByTestId('img-switch-offline'));
    expect(status).toBe('unsaved-review-pending');
  });
});

describe('ImageDetailsPanel: sem evento em foco', () => {
  it('diz que nao ha evento em vez de uma tabela vazia', () => {
    renderPanel({ currentEventId: 'NAO-EXISTE' });
    expect(screen.getByTestId('img-no-event')).toBeTruthy();
    expect(screen.queryByTestId('img-table')).toBeNull();
  });
});
