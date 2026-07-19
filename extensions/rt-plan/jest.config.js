const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  displayName: 'rt-plan',
  // Base testMatch only covers .js/.ts; be explicit for this TS/TSX extension.
  testMatch: [
    '<rootDir>/src/**/*.test.ts',
    '<rootDir>/src/**/*.test.tsx',
  ],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '@ohif/(.*)': '<rootDir>/../../platform/$1/src',
  },
};
