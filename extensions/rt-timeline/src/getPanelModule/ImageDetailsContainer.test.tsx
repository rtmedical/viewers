import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ImageDetailsContainer from './ImageDetailsContainer';

/* ------------------------------------------------------------------ */
/* Servicos falsos, com a mesma superficie que o container usa         */
/* ------------------------------------------------------------------ */

const DISPLAY_SET_EVENTS = {
  DISPLAY_SETS_ADDED: 'e::added',
  DISPLAY_SETS_CHANGED: 'e::changed',
  DISPLAY_SETS_REMOVED: 'e::removed',
};

const GRID_EVENTS = {
  ACTIVE_VIEWPORT_ID_CHANGED: 'e::activeViewport',
  LAYOUT_CHANGED: 'e::layout',
  VIEWPORTS_READY: 'e::ready',
};

function portalImage(id: string, over: Record<string, unknown> = {}) {
  return {
    Modality: 'RTIMAGE',
    displaySetInstanceUID: id,
    instances: [
      {
        SOPInstanceUID: 'uid-' + id,
        PatientID: 'MRN-1',
        Modality: 'RTIMAGE',
        AcquisitionDate: '20260814',
        AcquisitionTime: '080000',
        NominalBeamEnergy: 6,
        RadiationMachineName: 'TrueBeam-1',
        ...over,
      },
    ],
  };
}

function ctStack(id: string) {
  return {
    Modality: 'CT',
    displaySetInstanceUID: id,
    instances: [
      { SOPInstanceUID: 'uid-' + id + '-1', Modality: 'CT', KVP: 120, AcquisitionDate: '20260813', AcquisitionTime: '070000' },
      { SOPInstanceUID: 'uid-' + id + '-2', Modality: 'CT', KVP: 120 },
    ],
  };
}

function makeServices(options: {
  displaySets?: unknown[] | null;
  activeViewportDisplaySets?: string[];
} = {}) {
  const subscribers: Record<string, Array<() => void>> = {};
  const sets = options.displaySets;

  const displaySetService =
    sets === null
      ? undefined
      : {
          EVENTS: DISPLAY_SET_EVENTS,
          getActiveDisplaySets: () => sets ?? [],
          getDisplaySetByUID: (uid: string) =>
            (sets ?? []).filter((ds: any) => ds.displaySetInstanceUID === uid)[0],
          subscribe: (token: string, handler: () => void) => {
            subscribers[token] = subscribers[token] ?? [];
            subscribers[token].push(handler);
            return { unsubscribe: () => undefined };
          },
        };

  const viewportGridService = {
    EVENTS: GRID_EVENTS,
    getActiveViewportId: () => 'viewport-1',
    getDisplaySetsUIDsForViewport: () => options.activeViewportDisplaySets ?? [],
    subscribe: (token: string, handler: () => void) => {
      subscribers[token] = subscribers[token] ?? [];
      subscribers[token].push(handler);
      return { unsubscribe: () => undefined };
    },
  };

  return {
    servicesManager: { services: { displaySetService, viewportGridService } },
    emit: (token: string) => {
      for (const handler of subscribers[token] ?? []) {
        handler();
      }
    },
    subscribedTo: () => Object.keys(subscribers),
  };
}

/* ------------------------------------------------------------------ */

describe('ImageDetailsContainer: ausencia de servico nao e ausencia de imagem', () => {
  it('sem displaySetService diz que nao sabe, e nao que o curso nao tem imagens', () => {
    render(<ImageDetailsContainer servicesManager={{ services: {} }} />);
    const text = screen.getByTestId('img-no-service').textContent;
    expect(text).toContain('indisponivel');
    expect(text).toContain('nao e o mesmo que um curso sem imagens');
  });

  it('servico presente e estudo sem serie de imagem monta o painel, com a mensagem do painel', () => {
    const { servicesManager } = makeServices({ displaySets: [] });
    render(<ImageDetailsContainer servicesManager={servicesManager} />);
    expect(screen.queryByTestId('img-no-service')).toBeNull();
    expect(screen.getByTestId('img-no-event')).toBeTruthy();
  });

  it('descarta series que nao sao evento de imagem', () => {
    const { servicesManager } = makeServices({
      displaySets: [
        { Modality: 'RTPLAN', displaySetInstanceUID: 'p', instances: [{ Modality: 'RTPLAN' }] },
      ],
    });
    render(<ImageDetailsContainer servicesManager={servicesManager} />);
    expect(screen.getByTestId('img-no-event')).toBeTruthy();
  });
});

describe('ImageDetailsContainer: monta a tabela a partir do DICOM', () => {
  it('uma imagem portal produz a tabela, com o equipamento lido do objeto', () => {
    const { servicesManager } = makeServices({ displaySets: [portalImage('ds-1')] });
    render(<ImageDetailsContainer servicesManager={servicesManager} />);
    expect(screen.getByTestId('img-table')).toBeTruthy();
    expect(screen.getByTestId('img-value-machineName').textContent).toContain('TrueBeam-1');
  });

  it('a linha de energia do feixe traz o valor e a unidade do padrao', () => {
    const { servicesManager } = makeServices({ displaySets: [portalImage('ds-1')] });
    render(<ImageDetailsContainer servicesManager={servicesManager} />);
    expect(screen.getByTestId('img-value-beamEnergy').textContent).toContain('6');
    expect(screen.getByTestId('img-row-beamEnergy').getAttribute('data-state')).toBe('present');
  });

  it('o que o adaptador nao mapeia sai como nao informado, nao como zero', () => {
    const { servicesManager } = makeServices({ displaySets: [portalImage('ds-1')] });
    render(<ImageDetailsContainer servicesManager={servicesManager} />);
    const fraction = screen.getByTestId('img-value-fractionNumber').textContent;
    expect(fraction).toBe('Nao informado');
    expect(fraction).not.toContain('0');
  });

  it('foca a aquisicao mais recente, e nao a mais antiga do curso', () => {
    const older = portalImage('ds-old', { AcquisitionDate: '20260801' });
    const newer = portalImage('ds-new', { AcquisitionDate: '20260814' });
    const { servicesManager } = makeServices({ displaySets: [newer, older] });
    render(<ImageDetailsContainer servicesManager={servicesManager} />);
    expect(screen.getByTestId('img-value-instanceUid').textContent).toContain('uid-ds-new');
  });

  it('as setas trocam o evento em foco', () => {
    const older = portalImage('ds-old', { AcquisitionDate: '20260801' });
    const newer = portalImage('ds-new', { AcquisitionDate: '20260814' });
    const { servicesManager } = makeServices({ displaySets: [newer, older] });
    render(<ImageDetailsContainer servicesManager={servicesManager} />);
    fireEvent.click(screen.getByTestId('img-prev'));
    expect(screen.getByTestId('img-value-instanceUid').textContent).toContain('uid-ds-old');
  });
});

describe('ImageDetailsContainer: o emparelhamento da previa nao e fabricado', () => {
  it('imagem unica no viewport ativo emparelha', () => {
    const { servicesManager } = makeServices({
      displaySets: [portalImage('ds-1')],
      activeViewportDisplaySets: ['ds-1'],
    });
    render(<ImageDetailsContainer servicesManager={servicesManager} />);
    expect(screen.getByTestId('img-preview-paired')).toBeTruthy();
  });

  it('sem viewport identificado NAO emparelha', () => {
    const { servicesManager } = makeServices({
      displaySets: [portalImage('ds-1')],
      activeViewportDisplaySets: [],
    });
    render(<ImageDetailsContainer servicesManager={servicesManager} />);
    expect(screen.getByTestId('img-preview-unpaired')).toBeTruthy();
  });

  it('pilha de CT no viewport NAO emparelha, porque rolar troca a imagem sem aviso', () => {
    const { servicesManager } = makeServices({
      displaySets: [ctStack('ds-ct')],
      activeViewportDisplaySets: ['ds-ct'],
    });
    render(<ImageDetailsContainer servicesManager={servicesManager} />);
    expect(screen.getByTestId('img-preview-unpaired')).toBeTruthy();
  });

  it('dois display sets no viewport (fusao) NAO emparelham', () => {
    const { servicesManager } = makeServices({
      displaySets: [portalImage('ds-1'), portalImage('ds-2')],
      activeViewportDisplaySets: ['ds-1', 'ds-2'],
    });
    render(<ImageDetailsContainer servicesManager={servicesManager} />);
    expect(screen.getByTestId('img-preview-unpaired')).toBeTruthy();
  });

  it('o evento em foco e o que o viewport renderiza, nao o mais recente', () => {
    const older = portalImage('ds-old', { AcquisitionDate: '20260801' });
    const newer = portalImage('ds-new', { AcquisitionDate: '20260814' });
    const { servicesManager } = makeServices({
      displaySets: [newer, older],
      activeViewportDisplaySets: ['ds-old'],
    });
    render(<ImageDetailsContainer servicesManager={servicesManager} />);
    expect(screen.getByTestId('img-value-instanceUid').textContent).toContain('uid-ds-old');
    expect(screen.getByTestId('img-preview-paired')).toBeTruthy();
  });
});

describe('ImageDetailsContainer: reage a mudanca de estado do viewer', () => {
  it('assina os eventos de serie e de grade', () => {
    const { servicesManager, subscribedTo } = makeServices({ displaySets: [portalImage('ds-1')] });
    render(<ImageDetailsContainer servicesManager={servicesManager} />);
    const tokens = subscribedTo();
    expect(tokens).toContain(DISPLAY_SET_EVENTS.DISPLAY_SETS_ADDED);
    expect(tokens).toContain(DISPLAY_SET_EVENTS.DISPLAY_SETS_CHANGED);
    expect(tokens).toContain(DISPLAY_SET_EVENTS.DISPLAY_SETS_REMOVED);
    expect(tokens).toContain(GRID_EVENTS.ACTIVE_VIEWPORT_ID_CHANGED);
  });

  it('uma serie que chega depois entra na lista', () => {
    const sets: unknown[] = [];
    const subscribers: Record<string, Array<() => void>> = {};
    const servicesManager = {
      services: {
        displaySetService: {
          EVENTS: DISPLAY_SET_EVENTS,
          getActiveDisplaySets: () => sets,
          getDisplaySetByUID: () => undefined,
          subscribe: (token: string, handler: () => void) => {
            subscribers[token] = subscribers[token] ?? [];
            subscribers[token].push(handler);
            return { unsubscribe: () => undefined };
          },
        },
        viewportGridService: {
          EVENTS: GRID_EVENTS,
          getActiveViewportId: () => 'viewport-1',
          getDisplaySetsUIDsForViewport: () => [],
          subscribe: () => ({ unsubscribe: () => undefined }),
        },
      },
    };
    render(<ImageDetailsContainer servicesManager={servicesManager} />);
    expect(screen.getByTestId('img-no-event')).toBeTruthy();

    sets.push(portalImage('ds-late'));
    act(() => {
      for (const handler of subscribers[DISPLAY_SET_EVENTS.DISPLAY_SETS_ADDED] ?? []) {
        handler();
      }
    });
    expect(screen.getByTestId('img-table')).toBeTruthy();
  });

  it('cancela as assinaturas ao desmontar', () => {
    let cancelled = 0;
    const servicesManager = {
      services: {
        displaySetService: {
          EVENTS: DISPLAY_SET_EVENTS,
          getActiveDisplaySets: () => [portalImage('ds-1')],
          getDisplaySetByUID: () => undefined,
          subscribe: () => ({
            unsubscribe: () => {
              cancelled += 1;
            },
          }),
        },
      },
    };
    const view = render(<ImageDetailsContainer servicesManager={servicesManager} />);
    view.unmount();
    expect(cancelled).toBe(3);
  });
});
