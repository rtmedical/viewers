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
 * ## O pacote que nao pode ser carregado aqui, e o que descobrimos tentando
 *
 * `rt-tps` importa tres arquivos da extensao `default` POR CAMINHO RELATIVO
 * (`'../../default/src/ViewerLayout/ViewerHeader'` e dois vizinhos). O `ViewerHeader` importa
 * `@ohif/app` -- a APLICACAO -- e importar a aplicacao EXECUTA o bootstrap dela.
 *
 * Medido em 15/09/2026, e o resultado corrige a primeira versao deste comentario: o `require`
 * RETORNA SEM ERRO, e o processo morre depois, fora de qualquer `try`:
 *
 *     platform/app/src/loadDynamicConfig.js:8
 *       const useDynamicConfig = config.dangerouslyUseDynamicConfig;
 *     TypeError: Cannot read properties of undefined (reading 'dangerouslyUseDynamicConfig')
 *       at platform/app/src/index.js:47
 *
 * Nao e "o modulo nao carrega". E "carregar o modulo liga a aplicacao", e sem `window.config` a
 * aplicacao cai levando o worker do jest junto. Nenhum `try/catch` sobrevive a isso, porque a
 * falha nao acontece na pilha do `require`.
 *
 * ## Por que a checagem de pendencia NAO usa `require`
 *
 * A primeira versao afirmava "este pacote continua sem carregar" chamando `require` dentro de um
 * `try`. Alem de nao capturar o caso acima, ela dependia de ESTADO DE BUILD: `pluginImports.js`
 * e gerado por `writePluginImportsFile.js` e esta no `.gitignore`, entao em clone limpo o
 * `require` falhava cedo (resolucao, capturavel) e depois de um build ele ia adiante e derrubava
 * o processo. Uma guarda cujo resultado muda conforme alguem buildou ou nao nao e guarda.
 *
 * A checagem passou a ser ESTATICA: uma pendencia so continua valida enquanto o pacote ainda
 * tiver um import relativo de runtime que escapa dele. Mesma regra do `packageBoundary.test.ts`,
 * sem carregar nada, com o mesmo resultado em clone limpo e em arvore buildada.
 *
 * A exclusao continua EXATA nos dois sentidos, como a lista de paineis orfaos do RTV-233:
 * pacote novo que nao carrega falha por nao estar na lista, e pendencia cujo motivo deixou de
 * existir TAMBEM falha.
 *
 * O acoplamento em si e um achado a parte (RTV-237). Nao e fork -- nada foi modificado -- entao
 * o gate do RTV-114 nao ve, e nenhuma outra guarda via. Se o upstream mover
 * `ViewerLayout/ViewerHeader`, o layout TPS quebra no build e nada avisa antes.
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

/** Varredura de fontes de um pacote (sem teste), usada pela checagem estatica de pendencia. */
function walkSrc(dir: string, out: string[]): string[] {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') {
      continue;
    }
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      walkSrc(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

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
    'RTV-237 — importa ../../default/src/ViewerLayout/ViewerHeader por caminho relativo; a ' +
    'cadeia chega em @ohif/app e carregar o modulo EXECUTA o bootstrap da aplicacao, que sem ' +
    'window.config derruba o worker do jest fora de qualquer try/catch',
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
   * O outro sentido da lista, ESTATICO (ver o cabecalho: `require` aqui derruba o worker e
   * depende de estado de build). Uma pendencia so continua valida enquanto o motivo dela --
   * um import relativo de runtime que escapa do pacote -- ainda estiver la.
   */
  it.each(Object.keys(NAO_CARREGAM).map(dir => [dir] as [string]))(
    '%s ainda tem o acoplamento que justifica a pendencia (se sumiu, tire da lista)',
    dir => {
      const arquivos = walkSrc(path.join(EXTENSIONS_DIR, dir, 'src'), []);
      const escapes = arquivos.filter(file => {
        const fonte = fs.readFileSync(file, 'utf8');
        const rx = /(?:^|\n)\s*import\s+([^;]*?)\s*from\s*'(\.[^']*)'/g;
        let match: RegExpExecArray | null;
        while ((match = rx.exec(fonte)) !== null) {
          const soTipo = /^\s*type\b/.test(match[1] || '');
          const alvo = path.resolve(path.dirname(file), match[2]);
          if (!soTipo && !alvo.startsWith(path.join(EXTENSIONS_DIR, dir) + path.sep)) {
            return true;
          }
        }
        return false;
      });
      expect(escapes.length).toBeGreaterThan(0);
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
