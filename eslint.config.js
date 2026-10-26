// Lint configuration for development only; ESLint is not a runtime dependency.
import js from '@eslint/js';
import globals from 'globals';

export default [
  // src/client/ holds slices of one browser script; the generated lib/client.js is linted whole.
  { ignores: ['node_modules/', 'outputs/', 'work/', 'lib/vendor/', 'src/client/'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: {
      // `catch {}` deliberately ignores best-effort failures (cleanup, optional probes).
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Low-level errors are rethrown as user-facing messages on purpose; the
      // original stays in logs where it matters, so `cause` is not required.
      'preserve-caught-error': 'off',
      // Defaults assigned before a `try` that may bail out are intentional.
      'no-useless-assignment': 'off',
      // Callback and handler signatures keep their documented parameters.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
    },
  },
  {
    // The browser bundle is a plain script registered through the host module loader.
    files: ['lib/client.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
    // Some components are only reached by tests; removing them awaits a maintainer decision.
    rules: { 'no-unused-vars': 'off' },
  },
];
