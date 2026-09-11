// Initiate all tests from root, but allow tests from each package root.
// Share as much config as possible to reduce duplication.
//
// Borrowing from here:
// https://github.com/facebook/jest/issues/3112#issuecomment-398581705
const base = require('./jest.config.base.js');

module.exports = {
  ...base,
  // https://jestjs.io/docs/en/configuration#projects-array-string-projectconfig
  projects: [
    '<rootDir>/platform/*/jest.config.js',
    '<rootDir>/extensions/*/jest.config.js',
    // RTV-234: habilitado. A nota original dizia "Enable if any mode definitions start
    // including tests" -- e enquanto ninguem habilitava, os modos deste projeto lancavam na
    // carga sem nada ficar vermelho. So os modos com jest.config.js entram, e os do upstream
    // nao tem nenhum, entao isto nao passa a executar codigo que nao e nosso.
    '<rootDir>/modes/*/jest.config.js',
  ],
  coverageDirectory: '<rootDir>/coverage/',
};
