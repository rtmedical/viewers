/**
 * Painel de detalhes da imagem e troca para Revisao Offline (RTV-172).
 *
 * O nucleo `../imageDetails` decide quais linhas existem, em que estado cada valor esta,
 * qual sessao a imagem pertence e se a troca de workspace pode acontecer. A UI tem tres
 * maneiras de estragar isso, e cada uma tem uma regra aqui.
 *
 * ## A string exibida vem do nucleo, sempre
 *
 * Este e o ponto. Se o painel formatasse os numeros por conta propria, um `kvp` ausente
 * renderizaria como `0`, ou como `-`, ou como celula vazia — e um traco numa coluna de dose
 * e lido como "nao aplicavel" por metade dos leitores e como "zero" pela outra metade. O
 * nucleo ja produz `display` com as tres strings distintas, e o painel **nao tem
 * formatacao propria de valor**: ele imprime `row.display`.
 *
 * ## `rawValue` nunca aparece sozinho
 *
 * Quando a unidade nao foi declarada, o nucleo deixa `numericValue` vazio de proposito, para
 * que tendencia e comparacao nao peguem um numero de escala desconhecida — e mantem
 * `rawValue` para exibicao. A tentacao da UI e "mas temos o numero": mostrar `rawValue` como
 * se fosse a medida reintroduz exatamente o que o nucleo evitou. Aqui o `rawValue` so
 * aparece dentro do `display` do nucleo, que carrega a ressalva de unidade colada nele.
 *
 * ## As setas nao dao a volta, e dizem dentro de que lista andam
 *
 * Nas pontas o nucleo recusa. O painel mostra a recusa em vez de voltar para o comeco: dar
 * a volta da ultima para a primeira, com o fisico olhando a imagem e nao o contador, faz ele
 * re-revisar o comeco acreditando que e o fim. E o escopo da navegacao fica visivel ao lado
 * das setas, senao quem deixou um filtro de modalidade ligado acredita que percorreu o curso
 * inteiro.
 *
 * ## Previa e metadados juntos exigem emparelhamento verificado
 *
 * Previa de cache ao lado de numeros de uma aquisicao mais nova e uma resposta errada com
 * aparencia de confianca: o fisico confere a imagem contra o kV/mAs mostrado ao lado e
 * aprova um par que nunca existiu junto. Sem emparelhamento verificado o painel **nao
 * desenha os dois**.
 *
 * Sem import de outra extensao (RTV-114). O viewport Cornerstone fica no hospedeiro; este
 * painel recebe a referencia da previa e o veredicto do emparelhamento.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  IMG_NAVIGATION_BACKWARD,
  IMG_NAVIGATION_FORWARD,
  imgBuildDetailRows,
  imgFilterEvents,
  imgNavigate,
  imgPrepareOfflineReview,
  imgResolveSession,
  imgVerifyPreviewPairing,
  type ImgDetailRow,
  type ImgImagingEvent,
  type ImgListFilter,
  type ImgNavigationDirection,
  type ImgTreatmentSession,
  type ImgUnsavedReviewState,
} from '../imageDetails';

/* ------------------------------------------------------------------ */
/* Props                                                              */
/* ------------------------------------------------------------------ */

export interface ImageDetailsPanelProps {
  /** Eventos de imagem do curso. */
  events: readonly ImgImagingEvent[];
  /** Evento em foco. */
  currentEventId: string;
  /** Sessoes de tratamento, para resolver a fracao. */
  sessions: readonly ImgTreatmentSession[];
  /** Recorte ativo da lista. */
  filter?: ImgListFilter;
  /** Tolerancia da janela da sessao, quando a instalacao a declara. */
  sessionToleranceMs?: number;
  /** Estado de revisao nao salva, para a troca de workspace. */
  unsavedReview?: ImgUnsavedReviewState;
  /** Reconhecimento humano de fracao inferida. */
  acknowledgedInferredSession?: boolean;
  /** Instante, injetado. */
  nowMs: number;
  onNavigate?: (eventId: string) => void;
  onSwitchToOfflineReview?: (outcome: ReturnType<typeof imgPrepareOfflineReview>) => void;
  servicesManager?: { services: Record<string, unknown> };
}

/* ------------------------------------------------------------------ */
/* Componente                                                         */
/* ------------------------------------------------------------------ */

export default function ImageDetailsPanel({
  events,
  currentEventId,
  sessions,
  filter,
  sessionToleranceMs,
  unsavedReview,
  acknowledgedInferredSession,
  nowMs,
  onNavigate,
  onSwitchToOfflineReview,
}: ImageDetailsPanelProps): JSX.Element {
  const [navRefusal, setNavRefusal] = useState<string | null>(null);
  const [switchRefusal, setSwitchRefusal] = useState<string | null>(null);

  const list = useMemo(
    () => imgFilterEvents(events as ImgImagingEvent[], filter),
    [events, filter]
  );

  const current = useMemo(
    () => (events as ImgImagingEvent[]).filter(e => e && e.eventId === currentEventId)[0],
    [events, currentEventId]
  );

  const rows = useMemo(
    () => (current ? imgBuildDetailRows(current) : null),
    [current]
  );

  const session = useMemo(
    () =>
      current
        ? imgResolveSession(current, sessions as ImgTreatmentSession[], {
            toleranceMs: sessionToleranceMs,
            peers: events as ImgImagingEvent[],
          })
        : null,
    [current, sessions, sessionToleranceMs, events]
  );

  const pairing = useMemo(
    () =>
      current
        ? imgVerifyPreviewPairing(current.preview, current.metadata, { now: nowMs })
        : null,
    [current, nowMs]
  );

  const navigate = useCallback(
    (direction: ImgNavigationDirection) => {
      if (!list.ok) {
        return;
      }
      const outcome = imgNavigate(list.value, currentEventId, direction);
      if (!outcome.ok) {
        // NAO da a volta. Ver o cabecalho.
        setNavRefusal(outcome.reason);
        return;
      }
      setNavRefusal(null);
      if (onNavigate) {
        onNavigate(outcome.value.targetEventId);
      }
    },
    [list, currentEventId, onNavigate]
  );

  const switchWorkspace = useCallback(() => {
    if (!current || !session || !session.ok || !pairing || !pairing.ok) {
      setSwitchRefusal(
        'Contexto incompleto: a fracao e o emparelhamento da previa precisam estar resolvidos.'
      );
      return;
    }
    const outcome = imgPrepareOfflineReview(
      {
        patientId: current.patientId,
        courseId: current.courseId,
        sessionId: session.value.sessionId,
        instanceUid: rows && rows.ok ? rows.value.instanceUid : undefined,
        eventId: current.eventId,
        eventPatientId: current.patientId,
        sessionResolution: session.value,
        acknowledgedInferredSession,
        previewPairing: pairing.value,
        unsavedReview,
        scopeLabel: list.ok ? list.value.scopeLabel : undefined,
      },
      nowMs
    );
    if (!outcome.ok) {
      setSwitchRefusal(outcome.reason);
    } else {
      setSwitchRefusal(null);
    }
    if (onSwitchToOfflineReview) {
      onSwitchToOfflineReview(outcome);
    }
  }, [
    current,
    session,
    pairing,
    rows,
    acknowledgedInferredSession,
    unsavedReview,
    list,
    nowMs,
    onSwitchToOfflineReview,
  ]);

  if (!current) {
    return (
      <div className="rt-image-details" data-testid="rt-image-details">
        <p data-testid="img-no-event">Nenhum evento de imagem em foco.</p>
      </div>
    );
  }

  if (!rows.ok) {
    // Modalidade desconhecida, sem UID, sem metadado: o nucleo recusa a tabela inteira,
    // porque sem a modalidade nao se pode dizer se uma celula vazia de kVp significa
    // "nunca existiu" ou "deveria existir e falta".
    return (
      <div className="rt-image-details" data-testid="rt-image-details">
        <p data-testid="img-rows-refused">Nao e possivel montar a tabela de metadados.</p>
        <p data-testid="img-rows-refused-reason" data-code={rows.code}>
          {rows.reason}
        </p>
      </div>
    );
  }

  const table = rows.value;

  return (
    <div className="rt-image-details" data-testid="rt-image-details">
      <header>
        {/* Fracao: o nucleo recusa quando ambigua, e a recusa aparece em vez de um numero. */}
        {session && session.ok ? (
          <p data-testid="img-session" data-confidence={session.value.confidence}>
            {`Sessao ${session.value.sessionId}` +
              (session.value.fractionNumber !== undefined
                ? `, fracao ${session.value.fractionNumber}`
                : '') +
              ` -- ${session.value.evidence}`}
          </p>
        ) : (
          <p data-testid="img-session-refused" data-code={session ? session.code : undefined}>
            {session ? session.reason : 'Sessao nao resolvida.'}
          </p>
        )}
      </header>

      {/* Previa e metadados juntos SO com emparelhamento verificado. */}
      {pairing && pairing.ok ? (
        <section data-testid="img-preview" data-instance={pairing.value.instanceUid}>
          <p data-testid="img-preview-paired">
            {`Previa e metadados da mesma instancia (${pairing.value.instanceUid}).`}
          </p>
        </section>
      ) : (
        <section data-testid="img-preview-unpaired">
          <p data-testid="img-preview-unpaired-reason" data-code={pairing ? pairing.code : undefined}>
            {pairing ? pairing.reason : 'Emparelhamento da previa nao verificado.'}
          </p>
          <p>
            A previa nao e exibida ao lado destes numeros enquanto nao houver certeza de que
            sao da mesma aquisicao.
          </p>
        </section>
      )}

      <table data-testid="img-table">
        <tbody>
          {table.rows.map((row: ImgDetailRow) => (
            <tr
              key={row.key}
              data-testid={`img-row-${row.key}`}
              data-state={row.state}
              data-unit-state={row.unitState}
            >
              <th scope="row" data-testid={`img-label-${row.key}`}>
                {row.label}
              </th>
              {/* A string vem do nucleo. O painel nao formata valor. */}
              <td data-testid={`img-value-${row.key}`}>{row.display}</td>
              {row.note ? <td data-testid={`img-note-${row.key}`}>{row.note}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>

      <p data-testid="img-state-counts">
        {`${table.presentCount} informado(s), ${table.absentCount} nao informado(s), ` +
          `${table.notApplicableCount} nao aplicavel(is).`}
      </p>
      {table.unitWarningCount > 0 ? (
        <p data-testid="img-unit-warnings">
          {`${table.unitWarningCount} valor(es) sem unidade confiavel -- nao comparaveis com outra fracao.`}
        </p>
      ) : null}

      <nav data-testid="img-nav">
        {/* O escopo ao lado das setas. */}
        <p data-testid="img-scope">{list.ok ? list.value.scopeLabel : ''}</p>
        {list.ok && list.value.filtered ? (
          <p data-testid="img-hidden-count">
            {`${list.value.hiddenCount} imagem(ns) fora deste recorte e nao alcancavel(is) pelas setas.`}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => navigate(IMG_NAVIGATION_BACKWARD)}
          data-testid="img-prev"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={() => navigate(IMG_NAVIGATION_FORWARD)}
          data-testid="img-next"
        >
          Proxima
        </button>
        {navRefusal ? <p data-testid="img-nav-refusal">{navRefusal}</p> : null}
      </nav>

      <footer>
        <button
          type="button"
          onClick={switchWorkspace}
          data-testid="img-switch-offline"
        >
          Ir para Revisao Offline
        </button>
        {switchRefusal ? <p data-testid="img-switch-refusal">{switchRefusal}</p> : null}
      </footer>
    </div>
  );
}
