/**
 * Todo pacote nosso tem de CARREGAR, e quem se registra como extensao tem de ter `id` (RTV-236).
 *
 * Esta e a mesma guarda que `modes/*\/src/modeLoads.test.ts` faz para os modos, estendida ao
 * outro lugar onde mora registro: o ponto de entrada da extensao.
 *
 * ## Por que os pontos de entrada sao o ponto cego
 *
 * Um `index.ts` de extensao e quase todo declaracao -- `getPanelModule`, `getCommandsModule`,
 * `getSopClassHandlerModule`, `id` -- e quase nada de logica. Um teste unitario monta o
 * componente ou chama a funcao pura DIRETO, nunca pelo barrel, entao o arquivo que a aplicacao
 * de fato importa nao e exercitado por ninguem. Medido em 15/09/2026: de 39 pacotes nossos, 37
 * nao tinham um unico teste que importasse o proprio ponto de entrada.
 *
 * Esse ponto cego ja custou caro uma vez. O RTV-234 foi exatamente isto nos modos: os dois modos
 * do produto lancavam `TypeError` na avaliacao do modulo -- nao registravam rota, painel nem
 * toolbar -- e ficaram meses assim, com suite verde, porque nenhum teste importava o modulo. O
 * que pega essa classe e montar o modulo de verdade; nada mais pega.
 *
 * ## Extensao registrada nao e a mesma coisa que pacote nosso
 *
 * A distincao sai de `platform/app/pluginConfig.json`, que e o manifesto que a aplicacao le, e
 * nao de uma lista mantida a mao aqui:
 *
 *   - Pacote NO manifesto e uma extensao que a app registra. Ela precisa de `id`, porque e por
 *     ele que o extensionManager a registra -- e `id` ausente NAO lanca: a extensao carrega, nao
 *     registra, e some da aplicacao sem erro nenhum.
 *   - Pacote FORA do manifesto e biblioteca. `rt-calibration` e `rt-nm`, por exemplo, exportam
 *     so funcao pura (calibracao por phantom, quantificacao SPECT) e sao importados por outros
 *     pacotes. Exigir `id` deles seria inventar um defeito que nao existe.
 *
 * Carregar, os dois casos precisam: uma biblioteca que nao monta quebra quem a importa.
 *
 * ## O que esta guarda NAO afirma
 *
 * Que os modulos funcionam. Um `getPanelModule` que devolva lixo passa aqui. Quem cobre isso e
 * `panelRegistry.test.ts` (o painel registrado e citado por um modo) e os testes de cada painel.
 * As tres guardas se completam: a citacao resolve, o modulo carrega, o componente renderiza.
 *
 * ## O resolvedor, e por que ele nao e o das outras extensoes
 *
 * Os pontos de entrada arrastam o repo inteiro: um importa `@ohif/ui-next`, outro importa
 * `@ohif/extension-cornerstone`, o `rt-tps` importa `@state` (alias do webpack, em
 * `.webpack/resolveConfig.js`, e do tsconfig) e tambem `@ohif/core/src/utils/...` -- import
 * profundo, que precisa de regra propria. O `jest.config.js` deste pacote tem os detalhes.
 *
 * ## O pacote que nao da para carregar, e por que isso nao e um stub a mais
 *
 * `rt-tps` importa tres arquivos da extensao `default` POR CAMINHO RELATIVO
 * (`'../../default/src/ViewerLayout/ViewerHeader'` e dois vizinhos). O `ViewerHeader` importa
 * `@ohif/app`, que puxa as rotas da aplicacao, que exigem `pluginImports` -- um arquivo GERADO
 * pelo build (`writePluginImportsFile.js`) e que esta no `.gitignore`. Nao existe na arvore.
 *
 * Daria para stubar tambem. Nao foi feito de proposito: a essa altura a guarda ja nao estaria
 * perguntando "o ponto de entrada do rt-tps avalia", e sim "uma aplicacao inteira feita de
 * stubs avalia", que nao e afirmacao sobre nada. Melhor uma exclusao declarada, com a razao, do
 * que uma cobertura que mente.
 *
 * A exclusao e EXATA nos dois sentidos, pelo mesmo motivo da lista de paineis orfaos do
 * RTV-233: pacote novo que nao carrega falha por nao estar na lista, e pacote que passou a
 * carregar e continua nela TAMBEM falha. A lista encolhe junto com a divida.
 *
 * O acoplamento em si -- codigo nosso importando as ENTRANHAS de uma extensao do upstream por
 * caminho relativo -- e um achado a parte. Nao e fork (nada foi modificado), entao o gate do
 * RTV-114 nao ve; e nao ha guarda que veja. Se o upstream mover `ViewerLayout/ViewerHeader`, o
 * layout TPS quebra no build e nada avisa antes.
 *
 * ## O custo, dito em voz alta
 *
 * Carregar os pontos de entrada de verdade traz cornerstone, vtk.js e React para dentro da
 * suite. Medido em 15/09/2026, e os dois numeros importam por motivos diferentes:
 *
 *   - CACHE FRIO (o caso do CI): `rt-services` vai de ~6s para ~143s. O grosso e o grafo
 *     COMPARTILHADO, pago uma vez -- os tres primeiros pacotes custam 49s, 45s e 29s, e os
 *     outros 35 ficam abaixo de 2s, porque o registro de modulos do jest e o mesmo dentro de um
 *     arquivo de teste.
 *   - CACHE QUENTE (o caso de quem desenvolve): ~10s a suite inteira, porque o babel-jest
 *     guarda a transformacao em disco. O mesmo `cad` que custou 49s na primeira vez custa 2,4s
 *     na segunda.
 *
 * E caro no CI e vale: o defeito que esta guarda pega deixou o produto inteiro sem carregar por
 * meses (RTV-234). Se um dia o custo precisar cair, o caminho e separar este arquivo num
 * projeto jest proprio que rode em paralelo -- nao e reduzir o que ele carrega, porque carregar
 * de verdade e a unica coisa que ele faz.
 */
import fs from 'fs';
import path from 'path';

// __dirname e <repo>/extensions/rt-services/src.
const EXTENSIONS_DIR = path.resolve(__dirname, '../..');
const REPO_DIR = path.resolve(EXTENSIONS_DIR, '..');
const PLUGIN_CONFIG = path.join(REPO_DIR, 'platform/app/pluginConfig.json');

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return {};
  }
}

/** Pacotes deste projeto, pelo campo `repository` — mesmo criterio do panelRegistry. */
function isOurs(dir: string): boolean {
  const pkg = readJson(path.join(EXTENSIONS_DIR, dir, 'package.json')) as {
    repository?: string | { url?: string };
  };
  const repository = pkg.repository;
  const url = typeof repository === 'string' ? repository : (repository || {}).url || '';
  return String(url).indexOf('rtmedical/viewers') >= 0;
}

function packageName(dir: string): string {
  return ((readJson(path.join(EXTENSIONS_DIR, dir, 'package.json')) as { name?: string }).name ||
    '') as string;
}

/** O arquivo que a aplicacao importa: o `main` do package.json. */
function entryPoint(dir: string): string {
  const main =
    ((readJson(path.join(EXTENSIONS_DIR, dir, 'package.json')) as { main?: string }).main as
      | string
      | undefined) || 'src/index.ts';
  return path.join(EXTENSIONS_DIR, dir, main);
}

/** Pacotes que a aplicacao registra como extensao, lidos do manifesto. */
const REGISTRADAS = new Set<string>(
  (((readJson(PLUGIN_CONFIG).extensions as unknown[]) || []) as Array<
    { packageName?: string } | string
  >)
    .map(entry => (typeof entry === 'string' ? entry : entry.packageName || ''))
    .filter(Boolean)
);

const NOSSOS = fs
  .readdirSync(EXTENSIONS_DIR)
  .filter(entry => {
    try {
      return fs.statSync(path.join(EXTENSIONS_DIR, entry)).isDirectory() && isOurs(entry);
    } catch (error) {
      return false;
    }
  })
  .sort();

const REGISTRADAS_NOSSAS = NOSSOS.filter(dir => REGISTRADAS.has(packageName(dir)));

/**
 * Pacotes que ainda NAO carregam sob o jest, com a razao. Ver o cabecalho: a lista e exata nos
 * dois sentidos, entao uma entrada aqui e uma divida declarada e nao uma excecao escondida.
 */
const NAO_CARREGAM: { [dir: string]: string } = {
  'rt-tps':
    'importa ../../default/src/ViewerLayout/ViewerHeader por caminho relativo; a cadeia chega ' +
    'em @ohif/app e exige pluginImports, que o build gera e o .gitignore ignora',
};

const CARREGAM = NOSSOS.filter(dir => !(dir in NAO_CARREGAM));

describe('pacotes nossos: o ponto de entrada carrega (RTV-236)', () => {
  it('encontra os pacotes do projeto (se isto cair, a guarda morreu)', () => {
    expect(NOSSOS.length).toBeGreaterThan(30);
    // A cornerstone e do upstream: se ela aparecer, o criterio de "nosso" quebrou.
    expect(NOSSOS).not.toContain('cornerstone');
  });

  it('le o manifesto de extensoes e encontra as nossas nele', () => {
    expect(REGISTRADAS.size).toBeGreaterThan(20);
    expect(REGISTRADAS_NOSSAS.length).toBeGreaterThan(20);
  });

  it('toda pendencia declarada aponta um pacote que existe, com razao escrita', () => {
    for (const dir of Object.keys(NAO_CARREGAM)) {
      expect(NOSSOS).toContain(dir);
      expect(NAO_CARREGAM[dir].length).toBeGreaterThan(20);
    }
  });

  it.each(CARREGAM.map(dir => [dir] as [string]))('%s avalia sem lancar', dir => {
    const entry = entryPoint(dir);
    expect(fs.existsSync(entry)).toBe(true);
    // Sem try/catch: queremos o erro REAL na saida do jest, com a pilha, e nao uma mensagem
    // nossa resumindo o que aconteceu.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modulo = require(entry);
    expect(modulo).toBeTruthy();
  });

  /**
   * O outro sentido da lista. Se um pendente passou a carregar, a entrada tem de sair -- senao
   * a lista vira cemiterio e a guarda passa a cobrir menos do que parece.
   */
  it.each(Object.keys(NAO_CARREGAM).map(dir => [dir] as [string]))(
    '%s continua sem carregar (se passou a carregar, tire da lista)',
    dir => {
      let carregou = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require(entryPoint(dir));
        carregou = true;
      } catch (error) {
        carregou = false;
      }
      expect(carregou).toBe(false);
    }
  );

  it.each(
    REGISTRADAS_NOSSAS.filter(dir => !(dir in NAO_CARREGAM)).map(dir => [dir] as [string])
  )('%s esta no manifesto e expoe um id para registrar', dir => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const modulo = require(entryPoint(dir));
    const alvo = modulo && modulo.default ? modulo.default : modulo;
    expect(typeof alvo.id).toBe('string');
    expect((alvo.id as string).length).toBeGreaterThan(0);
  });

  /**
   * O manifesto nao pode citar pacote que nao existe.
   *
   * Uma entrada com nome errado nao quebra o build: a app tenta importar, falha, e a extensao
   * some. E o mesmo formato de falha que o RTV-233 mediu do outro lado (painel citado por modo
   * que nenhuma extensao registra), so que uma camada acima.
   */
  it('o manifesto nao cita pacote nosso que nao existe', () => {
    const nomesNossos = new Set(NOSSOS.map(packageName).filter(Boolean));
    const fantasmas = Array.from(REGISTRADAS)
      .filter(nome => nome.indexOf('@ohif/extension-rt') === 0 || nome.indexOf('rtmedical') >= 0)
      .filter(nome => !nomesNossos.has(nome))
      .sort();
    expect(fantasmas).toEqual([]);
  });
});
