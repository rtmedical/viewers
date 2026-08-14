/**
 * RTV-143 — testes do COMANDO, não só da geometria.
 *
 * Existem por um motivo concreto: a primeira versão deste wiring usava
 * `parseRtImageBevGeometry` sem importá-lo. Toda a suíte de geometria passava,
 * porque nenhum teste chegava a executar o caminho de render — o
 * `ReferenceError` só apareceria no browser, ao clicar no botão. Estes testes
 * atravessam `toggleDrrGraticule` de ponta a ponta contra um viewport falso, então
 * um binding faltando falha aqui.
 */
import { GRATICULE_OVERLAY_CLASS } from './drrGraticule';
import { rtImageInstance } from './__fixtures__/rtplanBevFixture';
import getCommandsModule from './getCommandsModule';

jest.mock('@cornerstonejs/core', () => ({ metaData: { get: () => undefined } }));

/** Um viewport de stack mostrando o DRR do fixture. */
function makeServices(options: { instance?: any; noRtImage?: boolean } = {}) {
  const element = document.createElement('div');
  document.body.appendChild(element);

  const instance = options.instance ?? rtImageInstance;
  const viewport = {
    type: 'stack',
    element,
    getCurrentImageId: () => 'wadors:image-1',
  };

  const services = {
    cornerstoneViewportService: {
      getRenderingEngine: () => ({
        getViewports: () => (options.noRtImage ? [] : [viewport]),
      }),
    },
    displaySetService: {
      getActiveDisplaySets: () => [
        {
          Modality: 'RTIMAGE',
          images: [{ imageId: 'wadors:image-1', ...instance }],
          instances: [{ imageId: 'wadors:image-1', ...instance }],
        },
      ],
      getDisplaySetByUID: () => undefined,
    },
    uiNotificationService: { show: jest.fn() },
  };

  return { servicesManager: { services }, element, show: services.uiNotificationService.show };
}

const overlays = (element: HTMLElement) =>
  element.querySelectorAll(`.${GRATICULE_OVERLAY_CLASS}-svg`).length;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('toggleDrrGraticule', () => {
  it('registra os três comandos do graticule', () => {
    const { definitions } = getCommandsModule({ servicesManager: makeServices().servicesManager });
    for (const name of ['toggleDrrGraticule', 'setDrrGraticuleSpacing', 'refreshDrrGraticule']) {
      expect(typeof definitions[name]?.commandFn).toBe('function');
    }
  });

  it('roda o caminho de render sem ReferenceError', () => {
    // O teste que faltava: exercita renderGraticule de verdade.
    const { servicesManager } = makeServices();
    const { actions } = getCommandsModule({ servicesManager });
    expect(() => actions.toggleDrrGraticule()).not.toThrow();
  });

  it('avisa e não liga quando não há RTIMAGE aberto', () => {
    const { servicesManager, show } = makeServices({ noRtImage: true });
    const { actions } = getCommandsModule({ servicesManager });
    expect(actions.toggleDrrGraticule()).toBe(false);
    expect(show).toHaveBeenCalled();
  });

  it('não deixa o estado ligado quando não conseguiu desenhar', () => {
    // Instância sem geometria: o toggle tem de voltar a desligado, senão o próximo
    // clique "desligaria" um graticule que nunca apareceu.
    const { servicesManager } = makeServices({ instance: { Modality: 'RTIMAGE' } });
    const { actions } = getCommandsModule({ servicesManager });
    expect(actions.toggleDrrGraticule()).toBe(false);
    // Segundo clique tenta ligar de novo (e não desligar).
    expect(actions.toggleDrrGraticule()).toBe(false);
  });

  it('setDrrGraticuleSpacing recusa valor não numérico', () => {
    const { servicesManager } = makeServices();
    const { actions } = getCommandsModule({ servicesManager });
    expect(actions.setDrrGraticuleSpacing({ spacingMm: NaN })).toBe(false);
    expect(actions.setDrrGraticuleSpacing({})).toBe(false);
    expect(actions.setDrrGraticuleSpacing({ spacingMm: 20 })).toBe(true);
  });

  it('refreshDrrGraticule é seguro com o graticule desligado', () => {
    const { servicesManager, element } = makeServices();
    const { actions } = getCommandsModule({ servicesManager });
    expect(() => actions.refreshDrrGraticule()).not.toThrow();
    expect(overlays(element)).toBe(0);
  });
});
