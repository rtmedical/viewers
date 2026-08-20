/**
 * getPanelModule (RTV-164/165/166) — Course Timeline panel.
 * Opt in via '@ohif/extension-rt-timeline.panelModule.courseTimeline'.
 */
import React from 'react';
import CourseTimelinePanel from './CourseTimelinePanel';
import ImageDetailsPanel from './ImageDetailsPanel';
import ImageDetailsContainer from './ImageDetailsContainer';
import type { ImgImagingEvent, ImgTreatmentSession, ImgListFilter } from '../imageDetails';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager }: PanelModuleParams) {
  return [
    {
      name: 'courseTimeline',
      iconName: 'tab-studies',
      iconLabel: 'Course',
      label: 'Course Timeline',
      component: (props: Record<string, unknown>) => (
        <CourseTimelinePanel {...props} servicesManager={servicesManager} />
      ),
    },
    // RTV-172: detalhes da imagem e troca para Revisao Offline.
    {
      name: 'imageDetails',
      iconName: 'tab-studies',
      iconLabel: 'Imagem',
      label: 'Detalhes da imagem',
      /**
       * Os eventos e as sessoes vem do hospedeiro. Sem eles o painel diz isso em vez de
       * montar uma tabela: uma tabela de metadados sem evento seria feita de celulas
       * "nao informado" sobre uma imagem que nao chegou, o que e uma afirmacao diferente.
       */
      component: (props: Record<string, unknown>) => {
        const events = props.events as readonly ImgImagingEvent[] | undefined;
        if (!events) {
          /*
           * Sem eventos injetados o container os resolve dos servicos (RTV-233). Antes deste
           * caminho o painel so dizia "nao informados" e nao havia como chegar a ele por um
           * modo -- ele estava mesclado, testado e inalcancavel.
           *
           * Quem injeta `events` continua mandando: um modo que os resolva de outra fonte nao
           * precisa competir com o container.
           */
          return (
            <ImageDetailsContainer
              servicesManager={servicesManager}
              sessions={props.sessions as never}
              filter={props.filter as ImgListFilter | undefined}
              sessionToleranceMs={props.sessionToleranceMs as number | undefined}
              unsavedReview={props.unsavedReview}
              acknowledgedInferredSession={props.acknowledgedInferredSession === true}
              courseId={props.courseId as string | undefined}
              onSwitchToOfflineReview={props.onSwitchToOfflineReview as never}
            />
          );
        }
        return (
          <ImageDetailsPanel
            events={events}
            currentEventId={(props.currentEventId as string) ?? ''}
            sessions={(props.sessions as readonly ImgTreatmentSession[]) ?? []}
            filter={props.filter as ImgListFilter | undefined}
            sessionToleranceMs={props.sessionToleranceMs as number | undefined}
            unsavedReview={props.unsavedReview as never}
            acknowledgedInferredSession={props.acknowledgedInferredSession === true}
            nowMs={props.nowMs as number}
            onNavigate={props.onNavigate as never}
            onSwitchToOfflineReview={props.onSwitchToOfflineReview as never}
            servicesManager={servicesManager}
          />
        );
      },
    },
  ];
}

export default getPanelModule;
