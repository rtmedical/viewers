/**
 * Fonte de dados do painel de detalhes da imagem (RTV-233).
 *
 * Este e o pedaco que faltava entre um painel testado e um painel que alguem abre. Os paineis
 * deste repo nao buscam dado de proposito -- e o que os deixa testaveis sem rede e o que
 * permite distinguir "carregando" de "falhou" de "vazio". A consequencia e que sem um
 * adaptador eles nao tinham como chegar a um modo.
 *
 * A divisao aqui e deliberada: `imageDetailsSource.ts` e puro e decide de onde vem cada
 * numero; este arquivo so assina os servicos e chama aquele. Toda a decisao de mapeamento e
 * testavel sem viewer, PACS ou relogio.
 *
 * ## Lista vazia verificada nao e lista ausente
 *
 * Se `displaySetService` existe e nao ha nenhuma serie de imagem, isso e um fato verificado
 * sobre o estudo, e o painel diz "nenhum evento em foco". Se o servico nao existe, nao sabemos
 * nada, e o texto e outro. Achatar os dois em "sem imagens" seria afirmar sobre o estudo algo
 * que ninguem leu -- e a partir dessa afirmacao alguem conclui que a fracao nao foi imageada.
 *
 * ## Props injetadas ainda vencem
 *
 * Quando o hospedeiro passa `events`, e ele quem manda: o contrato antigo do painel continua
 * valendo, e um modo que resolva os eventos de outra fonte (o Connect, por exemplo) nao precisa
 * competir com este container.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ImageDetailsPanel from './ImageDetailsPanel';
import {
  imgSrcMapDisplaySets,
  imgSrcSoleInstanceUid,
  type ImgSrcDisplaySet,
} from '../imageDetailsSource';
import type { ImgImagingEvent, ImgListFilter, ImgTreatmentSession } from '../imageDetails';

export interface ImageDetailsContainerProps {
  servicesManager: { services: Record<string, any> };
  /** Sessoes de tratamento, quando o hospedeiro as conhece. */
  sessions?: readonly ImgTreatmentSession[];
  filter?: ImgListFilter;
  sessionToleranceMs?: number;
  unsavedReview?: unknown;
  acknowledgedInferredSession?: boolean;
  courseId?: string;
  onSwitchToOfflineReview?: (outcome: unknown) => void;
}

interface Resolved {
  /** Nulo quando nao ha servico para perguntar. Ver o cabecalho. */
  events: ImgImagingEvent[] | null;
  renderedInstanceUid?: string;
  nowMs: number;
}

function activeDisplaySets(services: Record<string, any>): ImgSrcDisplaySet[] {
  const displaySetService = services ? services.displaySetService : undefined;
  if (!displaySetService) {
    return null;
  }
  const all =
    (displaySetService.getActiveDisplaySets && displaySetService.getActiveDisplaySets()) ??
    displaySetService.activeDisplaySets ??
    [];
  return Array.isArray(all) ? (all as ImgSrcDisplaySet[]) : [];
}

/** O display set do viewport ativo, quando da para saber qual e. */
function activeDisplaySet(
  services: Record<string, any>,
  displaySets: ImgSrcDisplaySet[]
): ImgSrcDisplaySet {
  const grid = services ? services.viewportGridService : undefined;
  const displaySetService = services ? services.displaySetService : undefined;
  const viewportId = grid && grid.getActiveViewportId ? grid.getActiveViewportId() : undefined;
  if (!viewportId || !grid.getDisplaySetsUIDsForViewport) {
    return undefined;
  }
  const uids = grid.getDisplaySetsUIDsForViewport(viewportId) ?? [];
  // Mais de um display set no viewport (fusao, overlay) nao identifica uma instancia.
  if (!Array.isArray(uids) || uids.length !== 1) {
    return undefined;
  }
  if (displaySetService && displaySetService.getDisplaySetByUID) {
    return displaySetService.getDisplaySetByUID(uids[0]);
  }
  return (displaySets ?? []).filter(ds => ds && ds.displaySetInstanceUID === uids[0])[0];
}

export default function ImageDetailsContainer({
  servicesManager,
  sessions,
  filter,
  sessionToleranceMs,
  unsavedReview,
  acknowledgedInferredSession,
  courseId,
  onSwitchToOfflineReview,
}: ImageDetailsContainerProps): JSX.Element {
  const services = servicesManager ? servicesManager.services : undefined;

  const resolve = useCallback((): Resolved => {
    const displaySets = activeDisplaySets(services);
    if (displaySets === null) {
      return { events: null, nowMs: Date.now() };
    }
    const active = activeDisplaySet(services, displaySets);
    const renderedInstanceUid = imgSrcSoleInstanceUid(active);
    return {
      events: imgSrcMapDisplaySets(displaySets, { renderedInstanceUid, courseId }),
      renderedInstanceUid,
      nowMs: Date.now(),
    };
  }, [services, courseId]);

  const [resolved, setResolved] = useState<Resolved>(resolve);
  const [selectedEventId, setSelectedEventId] = useState<string>('');

  useEffect(() => {
    const displaySetService = services ? services.displaySetService : undefined;
    const grid = services ? services.viewportGridService : undefined;
    const resync = () => setResolved(resolve());
    resync();

    const subscriptions: any[] = [];
    const listen = (service: any, names: string[]) => {
      if (!service || !service.subscribe) {
        return;
      }
      const events = service.EVENTS ?? {};
      for (const name of names) {
        const token = events[name];
        if (token) {
          subscriptions.push(service.subscribe(token, resync));
        }
      }
    };
    listen(displaySetService, ['DISPLAY_SETS_ADDED', 'DISPLAY_SETS_CHANGED', 'DISPLAY_SETS_REMOVED']);
    listen(grid, ['ACTIVE_VIEWPORT_ID_CHANGED', 'LAYOUT_CHANGED', 'VIEWPORTS_READY']);

    return () => {
      for (const subscription of subscriptions) {
        if (subscription && subscription.unsubscribe) {
          subscription.unsubscribe();
        }
      }
    };
  }, [services, resolve]);

  const events = resolved.events;

  /**
   * O evento em foco.
   *
   * Preferencia para a instancia que o viewport esta renderizando, porque e a imagem que o
   * fisico esta olhando. Sem isso, o mais recente -- e nao o primeiro da lista, que seria a
   * aquisicao mais antiga do curso.
   */
  const currentEventId = useMemo(() => {
    if (!events || events.length === 0) {
      return '';
    }
    if (selectedEventId && events.some(e => e.eventId === selectedEventId)) {
      return selectedEventId;
    }
    const rendered = resolved.renderedInstanceUid;
    if (rendered) {
      const match = events.filter(e => e.metadata && e.metadata.instanceUid === rendered)[0];
      if (match) {
        return match.eventId;
      }
    }
    return events[events.length - 1].eventId;
  }, [events, selectedEventId, resolved.renderedInstanceUid]);

  if (events === null) {
    return (
      <p data-testid="img-no-service">
        Servico de series indisponivel. Isto nao e o mesmo que um curso sem imagens.
      </p>
    );
  }

  return (
    <ImageDetailsPanel
      events={events}
      currentEventId={currentEventId}
      sessions={sessions ?? []}
      filter={filter}
      sessionToleranceMs={sessionToleranceMs}
      unsavedReview={unsavedReview as never}
      acknowledgedInferredSession={acknowledgedInferredSession === true}
      nowMs={resolved.nowMs}
      onNavigate={setSelectedEventId}
      onSwitchToOfflineReview={onSwitchToOfflineReview as never}
      servicesManager={servicesManager}
    />
  );
}
