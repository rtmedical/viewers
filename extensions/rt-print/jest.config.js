const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  displayName: 'rt-print',
  testMatch: [
    '<rootDir>/src/**/*.test.ts',
    '<rootDir>/src/**/*.test.tsx',
  ],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '@ohif/(.*)': '<rootDir>/../../platform/$1/src',
  },
};
