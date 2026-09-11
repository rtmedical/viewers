/**
 * O modo tem de CARREGAR (RTV-234).
 *
 * Este e o teste que faltava no dia em que o defeito entrou. Ate 11/09/2026 nenhum arquivo de
 * modo era executado por teste algum -- a linha dos modos estava comentada no jest.config.js da
 * raiz -- e os dois modos deste projeto lancavam TypeError na avaliacao do modulo, sem nada
 * ficar vermelho em lugar nenhum:
 *
 *     TypeError: _modeBasic.toolbarButtons is not iterable
 *
 * A causa era um named import que o @ohif/mode-basic nunca exportou, espalhado num array em
 * escopo de modulo. Vale notar o que NAO teria pego isso: a guarda de registro de paineis
 * (RTV-233) le os arquivos de modo como TEXTO e continuava verde, porque a citacao do painel
 * resolvia -- ela prova que o id existe, nao que o modulo carrega. Sao afirmacoes diferentes e
 * as duas sao necessarias.
 *
 * O teste e deliberadamente grosso: importar e olhar a forma. Um modo e quase todo declaracao,
 * e o que quebra nele e contrato com o upstream -- nome que sumiu, formato que mudou -- que
 * aparece na carga ou na primeira leitura do campo.
 */
import mode, { modeInstance } from './index';

describe('modo rtmedical-radioterapia carrega', () => {
  it('o modulo avalia sem lancar e expoe o mode', () => {
    expect(mode).toBeTruthy();
    expect(mode.id).toBe(modeInstance.id);
    expect(typeof mode.modeFactory).toBe('function');
  });

  it('declara rota propria', () => {
    expect(Array.isArray(modeInstance.routes)).toBe(true);
    expect(modeInstance.routes.length).toBeGreaterThan(0);
    expect(modeInstance.routeName).toBe('rtmedical-radiotherapy');
  });

  /**
   * A assercao que pega a regressao do RTV-234. Nao basta ser array: um `[...undefined]` nunca
   * chega aqui (lanca antes), mas um `toolbarButtons` que virasse `[]` por outra via passaria
   * despercebido e a toolbar sumiria sem erro.
   */
  it('compoe toolbarButtons a partir do basic, sem perder os botoes proprios', () => {
    expect(Array.isArray(modeInstance.toolbarButtons)).toBe(true);
    expect(modeInstance.toolbarButtons.length).toBeGreaterThan(1);
    const referencias = modeInstance.toolbarButtons.filter(
      (b: Record<string, unknown>) => b && typeof b === 'object' && '$reference' in b
    );
    // O marcador de composicao do basic tem de continuar na lista: e ele que traz os botoes
    // do cornerstone na expansao do CustomizationService.
    expect(referencias.length).toBeGreaterThan(0);
  });

  it('o modeFactory devolve uma instancia utilizavel', () => {
    const instancia = mode.modeFactory.call(mode, { modeConfiguration: null });
    expect(instancia.routeName).toBe('rtmedical-radiotherapy');
  });
});
