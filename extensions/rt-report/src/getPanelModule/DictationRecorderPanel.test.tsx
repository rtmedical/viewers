import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DictationRecorderPanel from './DictationRecorderPanel';
import {
  AUDIO_PREFERRED_MIME,
  AUDIO_SIGNAL_SILENT,
  AUDIO_SIGNAL_VOICED,
  AUDIO_STORAGE_LOCAL_ONLY,
  AUDIO_STORAGE_STORED,
  audioAssessSignal,
  audioEvaluateReadiness,
  audioFinishSession,
  audioStartSession,
  type AudioBinding,
  type AudioCapture,
  type AudioEnvironment,
} from '../audioCapture';

const T0 = 1_760_000_000_000;

const BINDING: AudioBinding = {
  patientId: 'PAC-1',
  studyInstanceUid: '1.2.840.1',
  reportId: 'LAU-1',
  reportVersion: 1,
};

function environment(over: Partial<AudioEnvironment> = {}): AudioEnvironment {
  return {
    permission: 'granted',
    devices: [{ deviceId: 'mic-1', label: 'Headset Jabra', enabled: true }],
    platform: 'web',
    supportedMimeTypes: [AUDIO_PREFERRED_MIME],
    ...over,
  };
}

function makeCapture(over: {
  peakLevel?: number;
  voicedFraction?: number;
  samples?: number;
  recordedMs?: number;
  stoppedAt?: number;
  storage?: typeof AUDIO_STORAGE_STORED | typeof AUDIO_STORAGE_LOCAL_ONLY;
} = {}): AudioCapture {
  const ready = audioEvaluateReadiness(environment());
  if (!ready.ok) {
    throw new Error('fixture broken');
  }
  const started = audioStartSession({
    sessionId: 'SES-1',
    binding: BINDING,
    readiness: ready.value,
    startedAt: T0,
  });
  if (!started.ok) {
    throw new Error('fixture broken');
  }
  const recordedMs = over.recordedMs ?? 60_000;
  const finished = audioFinishSession({
    session: started.value,
    stoppedAt: over.stoppedAt ?? T0 + recordedMs,
    recordedMs,
    byteSize: 200_000,
    signal: {
      peakLevel: over.peakLevel ?? 0.5,
      voicedFraction: over.voicedFraction ?? 0.6,
      samples: over.samples ?? 100,
    },
  });
  if (!finished.ok) {
    throw new Error('fixture broken: ' + finished.reason);
  }
  return { ...finished.value, storage: over.storage ?? AUDIO_STORAGE_STORED };
}

function renderPanel(over: Record<string, unknown> = {}) {
  return render(
    <DictationRecorderPanel
      environment={environment()}
      binding={BINDING}
      recording={false}
      nowMs={T0 + 90_000}
      {...(over as never)}
    />
  );
}

/* ------------------------------------------------------------------ */

describe('DictationRecorderPanel: o indicador mostra o nivel, nao o gravador', () => {
  it('avisa DURANTE a gravacao quando o pico esta abaixo do piso', () => {
    renderPanel({
      recording: true,
      liveSignal: { peakLevel: 0.001, voicedFraction: 0, samples: 40 },
    });
    expect(screen.getByTestId('rec-live-warning')).toBeTruthy();
    expect(screen.queryByTestId('rec-live-ok')).toBeNull();
  });

  it('o aviso ao vivo usa as MESMAS palavras que o nucleo usaria no fim', () => {
    const summary = { peakLevel: 0.001, voicedFraction: 0, samples: 40 };
    renderPanel({ recording: true, liveSignal: summary });
    const shown = screen.getByTestId('rec-live-warning').textContent;
    expect(shown).toBe(audioAssessSignal(summary).message);
  });

  it('mostra sinal presente quando ha voz', () => {
    renderPanel({
      recording: true,
      liveSignal: { peakLevel: 0.5, voicedFraction: 0.6, samples: 100 },
    });
    expect(screen.getByTestId('rec-live-ok')).toBeTruthy();
    expect(screen.queryByTestId('rec-live-warning')).toBeNull();
  });

  it('o medidor carrega o pico e o veredicto, para nao ser decorativo', () => {
    renderPanel({
      recording: true,
      liveSignal: { peakLevel: 0.42, voicedFraction: 0.6, samples: 100 },
    });
    const meter = screen.getByTestId('rec-level');
    expect(meter.getAttribute('data-peak')).toBe('0.42');
    expect(meter.getAttribute('data-verdict')).toBe(AUDIO_SIGNAL_VOICED);
    expect(meter.getAttribute('aria-valuenow')).toBe('42');
  });

  it('nao medido e distinto de silencio, porque os consertos sao diferentes', () => {
    renderPanel({ recording: true });
    const text = screen.getByTestId('rec-live-unmeasured').textContent;
    expect(text).toContain('nao esta sendo medido');
    expect(text).toContain('nao e o mesmo que');
    expect(screen.queryByTestId('rec-level')).toBeNull();
  });

  it('marca o veredicto silencioso no medidor', () => {
    renderPanel({
      recording: true,
      liveSignal: { peakLevel: 0.001, voicedFraction: 0, samples: 40 },
    });
    expect(screen.getByTestId('rec-level').getAttribute('data-verdict')).toBe(
      AUDIO_SIGNAL_SILENT
    );
  });

  it('mostra o piso de silencio em numeros', () => {
    renderPanel({
      recording: true,
      liveSignal: { peakLevel: 0.5, voicedFraction: 0.6, samples: 100 },
    });
    expect(screen.getByTestId('rec-floor').textContent).toContain('0.02');
  });

  it('oferece parar durante a gravacao e gravar quando parado', () => {
    const { unmount } = renderPanel({ recording: true });
    expect(screen.getByTestId('rec-stop')).toBeTruthy();
    expect(screen.queryByTestId('rec-start')).toBeNull();
    unmount();
    renderPanel();
    expect(screen.getByTestId('rec-start')).toBeTruthy();
  });

  it('chama onStart e onStop', () => {
    let started = 0;
    let stopped = 0;
    const { unmount } = renderPanel({ onStart: () => { started += 1; } });
    fireEvent.click(screen.getByTestId('rec-start'));
    unmount();
    renderPanel({ recording: true, onStop: () => { stopped += 1; } });
    fireEvent.click(screen.getByTestId('rec-stop'));
    expect(started).toBe(1);
    expect(stopped).toBe(1);
  });
});

describe('DictationRecorderPanel: tres remedios, tres mensagens', () => {
  it('permissao negada mostra o texto do nucleo', () => {
    renderPanel({ environment: environment({ permission: 'denied' }) });
    expect(screen.getByTestId('rec-not-ready-reason').textContent).toContain('navegador');
    expect(screen.getByTestId('rec-not-ready-reason').getAttribute('data-code')).toBe(
      'permission-denied'
    );
  });

  it('nenhum dispositivo tem mensagem propria', () => {
    renderPanel({ environment: environment({ devices: [] }) });
    const reason = screen.getByTestId('rec-not-ready-reason');
    expect(reason.textContent).toContain('headset');
    expect(reason.getAttribute('data-code')).toBe('no-input-device');
  });

  it('microfone mudo pelo sistema diz o que aconteceria', () => {
    renderPanel({
      environment: environment({
        devices: [{ deviceId: 'mic-1', label: 'Headset', enabled: false }],
      }),
    });
    expect(screen.getByTestId('rec-not-ready-reason').textContent).toContain('silencio');
  });

  it('as tres mensagens sao diferentes entre si', () => {
    const texts: string[] = [];
    for (const env of [
      environment({ permission: 'denied' }),
      environment({ devices: [] }),
      environment({ devices: [{ deviceId: 'm', label: 'H', enabled: false }] }),
    ]) {
      const { unmount } = renderPanel({ environment: env });
      texts.push(screen.getByTestId('rec-not-ready-reason').textContent ?? '');
      unmount();
    }
    expect(new Set(texts).size).toBe(3);
  });

  it('nao oferece gravar quando nao esta pronto', () => {
    renderPanel({ environment: environment({ permission: 'denied' }) });
    expect(screen.queryByTestId('rec-start')).toBeNull();
  });

  it('mostra o dispositivo e o aviso de codec quando pronto', () => {
    renderPanel({ environment: environment({ supportedMimeTypes: ['audio/mp4'] }) });
    expect(screen.getByTestId('rec-device').textContent).toContain('Headset Jabra');
    expect(screen.getByTestId('rec-advisory').textContent).toContain('Opus');
  });
});

describe('DictationRecorderPanel: "gravado" e afirmacao sobre o servidor', () => {
  it('marca duravel somente quando esta no servidor', () => {
    renderPanel({ capture: makeCapture({ storage: AUDIO_STORAGE_STORED }) });
    expect(screen.getByTestId('rec-storage').getAttribute('data-durable')).toBe('true');
    expect(screen.queryByTestId('rec-not-durable')).toBeNull();
  });

  it('local-only nao e duravel e diz por que', () => {
    renderPanel({ capture: makeCapture({ storage: AUDIO_STORAGE_LOCAL_ONLY }) });
    expect(screen.getByTestId('rec-storage').getAttribute('data-durable')).toBe('false');
    expect(screen.getByTestId('rec-not-durable').textContent).toContain('nao e evidencia');
  });

  it('mostra o resumo da captura', () => {
    renderPanel({ capture: makeCapture() });
    expect(screen.getByTestId('rec-capture-summary').textContent).toContain('60s');
  });

  it('nao mostra a captura enquanto grava', () => {
    renderPanel({ recording: true, capture: makeCapture() });
    expect(screen.queryByTestId('rec-capture')).toBeNull();
  });
});

describe('DictationRecorderPanel: anexar defeito exige um nome', () => {
  it('captura silenciosa pede quem assume', () => {
    renderPanel({ capture: makeCapture({ peakLevel: 0.001, voicedFraction: 0, samples: 50 }) });
    expect(screen.getByTestId('rec-defect')).toBeTruthy();
    expect(screen.getByTestId('rec-ack-label').textContent).toContain('assume');
  });

  it('o botao anuncia indisponivel enquanto nao ha nome', () => {
    renderPanel({ capture: makeCapture({ peakLevel: 0.001, voicedFraction: 0, samples: 50 }) });
    expect(
      screen.getByTestId('rec-attach-with-defect').getAttribute('aria-disabled')
    ).toBe('true');
  });

  it('o nucleo recusa o anexo sem nome, e a recusa aparece', () => {
    renderPanel({ capture: makeCapture({ peakLevel: 0.001, voicedFraction: 0, samples: 50 }) });
    fireEvent.click(screen.getByTestId('rec-attach-with-defect'));
    expect(screen.getByTestId('rec-refusal').textContent).toContain('confirmacao');
  });

  it('anexa com nome informado', () => {
    let ok: boolean | null = null;
    renderPanel({
      capture: makeCapture({ peakLevel: 0.001, voicedFraction: 0, samples: 50 }),
      onAttach: (o: { ok: boolean }) => { ok = o.ok; },
    });
    fireEvent.change(screen.getByTestId('rec-ack'), { target: { value: 'CRM-SP-1' } });
    fireEvent.click(screen.getByTestId('rec-attach-with-defect'));
    expect(ok).toBe(true);
    expect(screen.queryByTestId('rec-refusal')).toBeNull();
  });

  it('captura truncada mostra o buraco e pede reconhecimento', () => {
    renderPanel({
      capture: makeCapture({ recordedMs: 10_000, stoppedAt: T0 + 240_000 }),
    });
    expect(screen.getByTestId('rec-truncated').textContent).toContain('impressao');
    expect(screen.getByTestId('rec-attach-with-defect')).toBeTruthy();
  });

  it('captura sem defeito anexa direto', () => {
    let ok: boolean | null = null;
    renderPanel({ capture: makeCapture(), onAttach: (o: { ok: boolean }) => { ok = o.ok; } });
    expect(screen.queryByTestId('rec-defect')).toBeNull();
    fireEvent.click(screen.getByTestId('rec-attach'));
    expect(ok).toBe(true);
  });

  it('recusa anexar audio nao duravel, nomeando a maquina unica', () => {
    renderPanel({ capture: makeCapture({ storage: AUDIO_STORAGE_LOCAL_ONLY }) });
    fireEvent.click(screen.getByTestId('rec-attach'));
    expect(screen.getByTestId('rec-refusal').textContent).toContain('uma unica maquina');
  });

  it('recusa anexar em laudo assinado sem decisao de retencao', () => {
    renderPanel({ capture: makeCapture(), reportSigned: true });
    fireEvent.click(screen.getByTestId('rec-attach'));
    expect(screen.getByTestId('rec-refusal').textContent).toContain('retencao');
  });

  it('recusa quando o laudo em foco mudou desde a gravacao', () => {
    renderPanel({
      capture: makeCapture(),
      binding: { ...BINDING, reportId: 'LAU-9', patientId: 'PAC-9' },
    });
    fireEvent.click(screen.getByTestId('rec-attach'));
    expect(screen.getByTestId('rec-refusal').textContent).toContain('outro');
  });
});
