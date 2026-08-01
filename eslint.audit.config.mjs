// THROWAWAY type-aware audit config — a second opinion, not the build's linter.
//
// The committed eslint.config.mjs extends `tseslint.configs.recommended`, which
// is SYNTACTIC ONLY. This one turns on the type-aware set, which uses type
// information the build already computes. The rule that earns it:
//
//   @typescript-eslint/no-unnecessary-condition — flags a check that can never
//   be false. That is literally the shape of the `calibrate()` refusals that
//   could never fire (project_calibrate_cannot_fail_defect).
//
// Run:  npx eslint -c eslint.audit.config.mjs <paths>
// Do NOT commit. Whatever proves worth keeping gets landed in the real config
// with targeted disables, per the ranked plan.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'wpd-core/**',
      'electron/app/**',
      'ui-patches/**',
      'ui/dist/**',
      'node_modules/**',
      'dist-core/**',
      'dist/**',
      'dist-ui/**',
      'build/**',
      '.stryker-tmp/**',
      'reports/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['core/**/*.ts', 'algorithms/**/*.ts', 'engine/**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Noise for this pass — they are style opinions, not defect finders, and
      // they would bury the rules that actually encode a failure mode.
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/consistent-indexed-object-style': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/class-literal-property-style': 'off',
    },
  }
);
