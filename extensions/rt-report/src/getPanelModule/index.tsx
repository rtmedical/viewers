/**
 * getPanelModule da rt-report (RTV-222) — primeiro painel desta extensao.
 *
 * O painel e opt-in pelo modo, via
 * '@ohif/extension-rt-report.panelModule.reportingHub'.
 *
 * As props de dados (`queue`, `filter`) sao injetadas pelo modo ou por um wrapper: este
 * modulo NAO busca a fila. Manter o fetch fora daqui e o que deixa o painel testavel sem
 * rede e o que permite ao chamador dizer explicitamente se a fila esta carregando, falhou
 * ou carregou vazia -- a distincao que o nucleo existe para proteger.
 */
import React from 'react';
import ReportingHubPanel, { type HubPanelQueue } from './ReportingHubPanel';
import type { HubFilterContext } from '../hubQueue';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

/**
 * Estado inicial quando nenhum provedor injetou a fila.
 *
 * `loading` e nao uma lista vazia, de proposito: um painel montado sem provedor nao sabe se
 * ha estudos, e "nenhum estudo pendente" seria uma afirmacao que ninguem verificou.
 */
const UNPROVIDED_QUEUE: HubPanelQueue = { status: 'loading' };

const DEPARTMENT_FILTER: HubFilterContext = {
  label: 'todos os estudos do departamento',
};

function getPanelModule({ servicesManager }: PanelModuleParams) {
  return [
    {
      name: 'reportingHub',
      iconName: 'tab-studies',
      iconLabel: 'Laudos',
      label: 'Fila de laudos',
      component: (props: Record<string, unknown>) => (
        <ReportingHubPanel
          queue={(props.queue as HubPanelQueue) ?? UNPROVIDED_QUEUE}
          filter={(props.filter as HubFilterContext) ?? DEPARTMENT_FILTER}
          slaReference={props.slaReference as never}
          nowMs={props.nowMs as number | undefined}
          onRefresh={props.onRefresh as (() => void) | undefined}
          onOpenStudy={props.onOpenStudy as never}
          servicesManager={servicesManager}
        />
      ),
    },
  ];
}

export default getPanelModule;
