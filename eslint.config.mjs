// Flat ESLint config (checkpoint 16, see CLAUDE.md). Scoped to the
// actively-maintained TypeScript/React rebuild (core/, algorithms/,
// engine/, ui/) plus the small, hand-written Electron main-process
// files -- deliberately NOT wpd-core/ (git subtree, never edit
// directly), electron/app/ (built vendor output incl. pdf.js), or
// ui-patches/ (legacy runtime-injected code for the current shipping
// app, a different style/pattern than the rebuild).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
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
    ],
  },
  js.configs.recommended,
  {
    // TypeScript-specific rules only apply to actual TS files -- applying
    // them repo-wide flagged plain CommonJS Node/Electron files (main.js,
    // preload.js, scripts/*.js, the .cjs dev harness) for using require(),
    // which is exactly correct there, not a lint violation.
    files: ['core/**/*.ts', 'algorithms/**/*.ts', 'engine/**/*.ts', 'ui/src/**/*.{ts,tsx}', 'ui/__tests__/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['core/**/*.ts', 'algorithms/**/*.ts', 'engine/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // crossCheck.test.ts talks to the live app's untyped legacy global
    // (window.wpd) inside page.evaluate() specifically to compare it
    // against this port -- `any` there is the deliberate interop
    // boundary the rule exists to permit, not an oversight.
    files: ['core/__tests__/crossCheck.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['ui/src/**/*.{ts,tsx}', 'ui/__tests__/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Both Workspace.tsx and ImageCanvas.tsx deliberately read a ref's
      // .current during render (a plain mutable class/DOM ref, not React
      // state, forced to re-render via a version counter -- see
      // Workspace.tsx's own doc comment) -- a documented, tested pattern
      // across checkpoints 3-15, not the bug this newer/React-Compiler-
      // oriented rule is meant to catch. See CLAUDE.md checkpoint 16.
      'react-hooks/refs': 'off',
    },
  },
  {
    files: ['ui/*.cjs', 'electron/*.js', 'scripts/*.js'],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'commonjs',
    },
    rules: {
      // Best-effort cleanup (e.g. "delete this file, ignore if it's
      // already gone") is a common, intentional Node idiom in these files.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  }
);
