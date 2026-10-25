// Lint configuration for development only; ESLint is not a runtime dependency.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'outputs/', 'work/', 'lib/vendor/'] },
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
    // Components only reached by tests are reviewed when the bundle is split into src/client/.
    rules: { 'no-unused-vars': 'off' },
  },
];
