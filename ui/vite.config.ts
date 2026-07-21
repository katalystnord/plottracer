import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// The app version, read from the single source of truth (root package.json,
// which electron-builder also names artifacts from) and injected at build time
// so the Help > About shows what you're running (asked 2026-07-19). No runtime
// IPC needed -- it's a compile-time constant.
const appVersion = (
  JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')) as { version: string }
).version;

// root: '.' (this file's directory, ui/) so ui/index.html is the entry.
// base: './' so the built asset paths are relative — required for
// loading via file:// in Electron (see electron-dev.cjs) rather than an
// http server, matching how the production app already loads
// electron/app/index.html.
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
    strictPort: true,
    // The Help > Open example feature (checkpoint 46) imports sample PNGs from
    // the repo-root samples/ dir, which is above this Vite root -- allow the
    // dev server to serve it (the production build already bundles them fine).
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
});
