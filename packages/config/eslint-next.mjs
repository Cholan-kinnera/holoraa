import baseConfig from './eslint-base.mjs';

/**
 * ESLint config for Next.js apps.
 * Extends the base config with React/Next-specific settings.
 */
export default [
  ...baseConfig,
  {
    settings: {
      react: { version: 'detect' },
    },
  },
];
