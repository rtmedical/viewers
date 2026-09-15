const path = require('path');
const base = require('../../jest.config.base.js');
const { alias } = require('../../.webpack/resolveConfig.js');

/*
 * RTV-236 — este pacote resolve como o BUILD resolve, e nao so como as outras extensoes.
 *
 * Aqui moram as guardas que carregam codigo dos outros pacotes de verdade
 * (`extensionLoads.test.ts` monta o ponto de entrada de cada pacote nosso), e um ponto de
 * entrada arrasta o repo inteiro. O `rt-tps`, por exemplo, importa o ViewerLayout da extensao
 * `default`, que importa `platform/app/src/index.js`, que puxa as rotas da aplicacao -- e no
 * meio do caminho aparecem os aliases do webpack, um de cada vez.
 *
 * ## Os aliases sao DERIVADOS, nao copiados
 *
 * `.webpack/resolveConfig.js` ja existe para que a build do webpack/rspack e a do rsbuild nao
 * divirjam. O jest vira o terceiro consumidor do mesmo arquivo, pela mesma razao: uma copia a
 * mao aqui envelheceria em silencio, e o sintoma seria uma guarda reprovando por um alias que o
 * produto resolve bem.
 *
 * A traducao de webpack para jest tem duas formas, e a ordem importa porque o mapeador e
 * ordenado e a primeira regra que casa vence:
 *   - `'@ohif/app$'` (com `$`) e correspondencia EXATA -> uma regra ancorada;
 *   - `'@components'` (sem `$`) e prefixo -> duas regras, a exata e a de subcaminho.
 * As chaves mais longas entram primeiro, senao `@` engoliria `@components`.
 *
 * ## As tres formas de `@ohif/`
 *
 * Duas regras por familia, sempre a exata antes da profunda:
 *   `@ohif/core`                        -> platform/core/src
 *   `@ohif/core/src/utils/algumaCoisa`  -> platform/core/src/utils/algumaCoisa
 *
 * Um `^@ohif/(.*)$` sozinho parece cobrir as duas e nao cobre: com o import profundo o grupo
 * captura `core/src/utils/algumaCoisa` e o destino vira `.../algumaCoisa/src`. Por isso os
 * grupos sao `([^/]+)`, que param no primeiro segmento.
 */

/** Aliases do webpack traduzidos para o formato do jest (ver o cabecalho). */
function aliasesDoWebpack() {
  const out = {};
  const chaves = Object.keys(alias).sort((a, b) => b.length - a.length);
  for (const chave of chaves) {
    const destino = path.resolve(alias[chave]);
    if (chave.endsWith('$')) {
      out['^' + chave.slice(0, -1) + '$'] = destino;
    } else {
      out['^' + chave + '$'] = destino;
      out['^' + chave + '/(.*)$'] = destino + '/$1';
    }
  }
  return out;
}

module.exports = {
  ...base,
  displayName: 'rt-services',
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  moduleNameMapper: {
    /*
     * ANTES do spread de proposito. O `^@cornerstonejs/([^/]+)/(.*)$` da base manda tudo para
     * `dist/esm/<subpath>`, e os quatro codecs WASM publicam por `exports` fora de `dist/esm`.
     * Ver o cabecalho de `src/__mocks__/codecStub.js`.
     */
    '^@cornerstonejs/codec-[^/]+(/.*)?$': '<rootDir>/src/__mocks__/codecStub.js',
    ...base.moduleNameMapper,
    ...aliasesDoWebpack(),
    '^@ohif/mode-([^/]+)$': '<rootDir>/../../modes/$1/src',
    '^@ohif/mode-([^/]+)/(.*)$': '<rootDir>/../../modes/$1/$2',
    '^@ohif/extension-([^/]+)$': '<rootDir>/../../extensions/$1/src',
    '^@ohif/extension-([^/]+)/(.*)$': '<rootDir>/../../extensions/$1/$2',
    '^@ohif/([^/]+)$': '<rootDir>/../../platform/$1/src',
    '^@ohif/([^/]+)/(.*)$': '<rootDir>/../../platform/$1/$2',
  },
};
