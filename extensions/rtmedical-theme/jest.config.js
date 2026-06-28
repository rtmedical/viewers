const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  displayName: 'rtmedical-theme',
  // Base testMatch only covers .js/.ts; include .jsx/.tsx for React tests.
  testMatch: [
    '<rootDir>/src/**/*.test.js',
    '<rootDir>/src/**/*.test.jsx',
    '<rootDir>/src/**/*.test.ts',
    '<rootDir>/src/**/*.test.tsx',
  ],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '@ohif/(.*)': '<rootDir>/../../platform/$1/src',
  },
};
