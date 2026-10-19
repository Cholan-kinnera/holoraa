import baseConfig from './eslint-base.mjs';

/**
 * ESLint config for NestJS apps.
 * Extends the base config with Node-specific settings.
 */
export default [
  ...baseConfig,
  {
    rules: {
      // NestJS uses empty constructors for DI
      'no-useless-constructor': 'off',
      '@typescript-eslint/no-useless-constructor': 'off',
    },
  },
];
