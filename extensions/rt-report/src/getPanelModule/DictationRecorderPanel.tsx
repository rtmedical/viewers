/**
 * Painel do gravador de ditado (RTV-111).
 *
 * O nucleo `../audioCapture` decide readiness, sinal, durabilidade e retencao. Aqui a UI
 * tem um problema que o nucleo nao pode resolver por ela, e e o mais grave de todo o
 * modulo:
 *
 * ## O ponto vermelho e, ele mesmo, a mentira
 *
 * Um indicador de gravacao que mostra apenas "gravando" e uma afirmacao sobre o software,
 * nao sobre o microfone. O radiologista fala quatro minutos vendo aquele ponto e o
 * microfone estava mudo — e o ponto estava tecnicamente correto o tempo inteiro, porque o
 * `MediaRecorder` **estava** gravando. Gravando silencio.
 *
 * O nucleo detecta isso, mas so **no fim**, quando a captura e encerrada e o resumo de
 * sinal chega. Nesse ponto os quatro minutos ja foram perdidos. A unica correcao possivel
 * e da camada de UI, e e esta: **o indicador mostra o nivel observado, nao o estado do
 * gravador**. Enquanto o pico fica abaixo do piso do nucleo, o painel avisa DURANTE a
 * gravacao, com as mesmas palavras que usaria depois.
 *
 * Se `signal` nao chega, o painel diz que **nao esta medindo** — nunca desenha um medidor
 * em repouso, porque um medidor parado e indistinguivel de silencio e os dois pedem acoes
 * diferentes (um e bug de integracao, o outro e microfone mudo).
 *
 * ## Tres remedios diferentes nao podem ter uma mensagem
 *
 * Permissao negada, nenhum dispositivo, e dispositivo presente porem mudo pelo sistema sao
 * tres estados com tres consertos: um clique na barra de endereco, conectar o headset,
 * tirar o mudo. O nucleo os separa; o painel mostra o texto do nucleo em vez de
 * "nao foi possivel gravar".
 *
 * ## "Gravado" e uma afirmacao sobre o servidor
 *
 * O chip de estado usa {@link audioIsDurable}, que e verdadeiro somente para `stored`.
 * `local-only` aparece como cifrado nesta estacao e ainda nao sincronizado — porque um
 * laudo assinado com base em audio que so existe num disco perde a evidencia no dia em que
 * a estacao e reinstalada.
 *
 * ## Anexar captura defeituosa exige um nome, nao um clique
 *
 * Captura silenciosa, nao medida ou truncada pode ser anexada, e o nucleo exige
 * reconhecimento explicito de quem assume. O painel pede o identificador antes de habilitar
 * o anexo: um "confirmar" anonimo nao e reconhecimento, e o nucleo o recusaria de todo
 * jeito.
 *
 * Sem import de outra extensao (RTV-114). O `MediaRecorder` e o `AudioContext` ficam no
 * hospedeiro: este painel recebe o resumo de sinal e devolve intencoes.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  AUDIO_SIGNAL_SILENT,
  AUDIO_SIGNAL_UNKNOWN,
  AUDIO_SIGNAL_VOICED,
  AUDIO_SILENCE_PEAK_FLOOR,
  AUDIO_STORAGE_LABELS,
  audioAssessSignal,
  audioAttachToReport,
  audioDescribeCapture,
  audioDescribeStorage,
  audioEvaluateReadiness,
  audioIsDurable,
  type AudioBinding,
  type AudioCapture,
  type AudioEnvironment,
  type AudioRefusalCode,
  type AudioSignalSummary,
} from '../audioCapture';

/* ------------------------------------------------------------------ */
/* Props                                                              */
/* ------------------------------------------------------------------ */

export interface DictationRecorderPanelProps {
  /** Ambiente de captura observado pelo hospedeiro. */
  environment: AudioEnvironment;
  /** Vinculo do laudo em foco. */
  binding: AudioBinding;
  /** True enquanto o gravador do hospedeiro esta ativo. */
  recording: boolean;
  /**
   * Resumo de sinal observado AO VIVO. Ausente enquanto grava significa que ninguem esta
   * medindo, e o painel diz isso em vez de desenhar um medidor em repouso.
   */
  liveSignal?: AudioSignalSummary;
  /** Captura encerrada, quando existe. */
  capture?: AudioCapture | null;
  /** Instante, injetado. */
  nowMs: number;
  /** Laudo ja assinado: muda o que o nucleo exige de retencao. */
  reportSigned?: boolean;
  onStart?: () => void;
  onStop?: () => void;
  onAttach?: (attachment: ReturnType<typeof audioAttachToReport>) => void;
  servicesManager?: { services: Record<string, unknown> };
}

/* ------------------------------------------------------------------ */
/* Componente                                                         */
/* ------------------------------------------------------------------ */

export default function DictationRecorderPanel({
  environment,
  binding,
  recording,
  liveSignal,
  capture,
  nowMs,
  reportSigned,
  onStart,
  onStop,
  onAttach,
}: DictationRecorderPanelProps): JSX.Element {
  const [acknowledgedBy, setAcknowledgedBy] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);

  const readiness = useMemo(() => audioEvaluateReadiness(environment), [environment]);

  /**
   * Avaliacao do sinal AO VIVO, com o mesmo nucleo que julga a captura no fim. Usar o mesmo
   * julgamento nos dois momentos e o ponto: o aviso que aparece durante a gravacao e
   * exatamente o que apareceria depois, entao nao existe caso em que o painel calou durante
   * e reclamou no fim.
   */
  const live = useMemo(
    () => (liveSignal ? audioAssessSignal(liveSignal) : null),
    [liveSignal]
  );

  const attemptAttach = useCallback(
    (defect?: AudioRefusalCode) => {
      if (!capture) {
        return;
      }
      const outcome = audioAttachToReport({
        capture,
        currentBinding: binding,
        attachedAt: nowMs,
        reportSigned,
        acknowledgeDefect: defect,
        acknowledgedBy: acknowledgedBy || undefined,
      });
      if (!outcome.ok) {
        setRefusal(outcome.reason);
      } else {
        setRefusal(null);
      }
      if (onAttach) {
        onAttach(outcome);
      }
    },
    [capture, binding, nowMs, reportSigned, acknowledgedBy, onAttach]
  );

  /* ---- nao esta pronto para gravar ---- */

  if (!readiness.ok) {
    return (
      <div className="rt-dictation" data-testid="rt-dictation">
        <p data-testid="rec-not-ready">Nao e possivel gravar agora.</p>
        {/* O texto do nucleo, porque os tres estados tem tres consertos diferentes. */}
        <p data-testid="rec-not-ready-reason" data-code={readiness.code}>
          {readiness.reason}
        </p>
      </div>
    );
  }

  const defectCode: AudioRefusalCode | undefined = capture
    ? capture.signal.verdict === AUDIO_SIGNAL_SILENT ||
      capture.signal.verdict === AUDIO_SIGNAL_UNKNOWN
      ? 'silent-capture'
      : capture.duration.truncated
        ? 'truncated-capture'
        : undefined
    : undefined;

  return (
    <div className="rt-dictation" data-testid="rt-dictation">
      <header>
        <p data-testid="rec-device">{`Microfone: ${readiness.value.device.label}`}</p>
        {readiness.value.advisory ? (
          <p data-testid="rec-advisory">{readiness.value.advisory}</p>
        ) : null}
      </header>

      {recording ? (
        <section data-testid="rec-live">
          {/* O indicador NAO diz apenas "gravando". Ver o cabecalho. */}
          {live === null ? (
            <p data-testid="rec-live-unmeasured">
              Gravando, mas o nivel do sinal nao esta sendo medido. Isto nao e o mesmo que
              silencio, e nao da para afirmar que ha captacao.
            </p>
          ) : (
            <>
              <div
                data-testid="rec-level"
                data-peak={String(live.peakLevel)}
                data-verdict={live.verdict}
                role="meter"
                aria-label="Nivel de captacao do microfone"
                aria-valuenow={Math.round(live.peakLevel * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              />
              {live.verdict === AUDIO_SIGNAL_VOICED ? (
                <p data-testid="rec-live-ok">{live.message}</p>
              ) : (
                // O aviso DURANTE a gravacao, com as mesmas palavras do fim.
                <p data-testid="rec-live-warning">{live.message}</p>
              )}
              <p data-testid="rec-floor">
                {`Piso de silencio: pico abaixo de ${AUDIO_SILENCE_PEAK_FLOOR}.`}
              </p>
            </>
          )}
          <button type="button" onClick={onStop} data-testid="rec-stop">
            Parar
          </button>
        </section>
      ) : (
        <button type="button" onClick={onStart} data-testid="rec-start">
          Gravar
        </button>
      )}

      {capture && !recording ? (
        <section data-testid="rec-capture">
          <p data-testid="rec-capture-summary">{audioDescribeCapture(capture)}</p>
          {/* "Gravado" e afirmacao sobre o servidor: usa audioIsDurable. */}
          <p data-testid="rec-storage" data-durable={audioIsDurable(capture.storage) ? 'true' : 'false'}>
            {audioDescribeStorage(capture)}
          </p>
          {!audioIsDurable(capture.storage) ? (
            <p data-testid="rec-not-durable">
              {`Ainda nao e evidencia do laudo: ${AUDIO_STORAGE_LABELS[capture.storage]}.`}
            </p>
          ) : null}

          {capture.duration.truncated ? (
            <p data-testid="rec-truncated">{capture.duration.message}</p>
          ) : null}

          {defectCode ? (
            <div data-testid="rec-defect">
              <p data-testid="rec-defect-message">{capture.signal.message}</p>
              {/* Reconhecimento exige um nome. Um "confirmar" anonimo nao e
                  reconhecimento, e o nucleo o recusaria de todo jeito. */}
              <label htmlFor="rec-ack" data-testid="rec-ack-label">
                Quem assume que a gravacao e assim mesmo (identificador profissional)
              </label>
              <input
                id="rec-ack"
                data-testid="rec-ack"
                value={acknowledgedBy}
                onChange={event => setAcknowledgedBy(event.target.value)}
              />
              <button
                type="button"
                onClick={() => attemptAttach(defectCode)}
                aria-disabled={acknowledgedBy.trim().length === 0}
                data-testid="rec-attach-with-defect"
              >
                Anexar assumindo o defeito
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => attemptAttach()} data-testid="rec-attach">
              Anexar ao laudo
            </button>
          )}

          {refusal ? <p data-testid="rec-refusal">{refusal}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
