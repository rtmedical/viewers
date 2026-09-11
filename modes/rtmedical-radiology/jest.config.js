/*
 * RTV-234 — projeto jest para este modo.
 *
 * Ate 11/09/2026 nenhum arquivo de modo era executado por teste neste repo: a linha
 * `modes/*` + `/jest.config.js` estava comentada no jest.config.js da raiz, com a nota "Enable
 * if any mode definitions start including tests". O resultado foi que a camada que mais depende
 * de contrato com o upstream -- a fiacao de toolbar, painel, rota e sopClassHandler -- era a
 * unica sem cobertura, e os dois modos passaram a lancar na carga sem nada ficar vermelho.
 *
 * O moduleNameMapper precisa resolver TRES formas de @ohif neste monorepo, e a ordem importa
 * porque a ultima regra casaria todas:
 *   @ohif/mode-<x>      -> modes/<x>/src
 *   @ohif/extension-<x> -> extensions/<x>/src
 *   @ohif/<x>           -> platform/<x>/src
 * O mapa que as extensoes usam (um unico @ohif/(.*) para platform) nao serve aqui: mandaria
 * @ohif/mode-basic para platform/mode-basic/src, que nao existe.
 */
const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  displayName: 'rtmedical-radiology',
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '^@ohif/mode-(.*)$': '<rootDir>/../$1/src',
    '^@ohif/extension-(.*)$': '<rootDir>/../../extensions/$1/src',
    '^@ohif/(.*)$': '<rootDir>/../../platform/$1/src',
  },
};
