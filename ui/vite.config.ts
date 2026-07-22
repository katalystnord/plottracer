import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// Content-Security-Policy for the PRODUCTION build only (electron-main.cjs loads
// dist/index.html over file://). Kept out of dev so Vite's HMR (inline scripts +
// ws:) still works with `npm start`. Local resources are allowed via
// file:/data:/blob:; http(s)/ws are deliberately ABSENT from connect-src, which
// is what enforces the offline guarantee (no figure ever leaves the machine) at
// the engine level. 'unsafe-inline' style is required by MUI/emotion's injected
// styles; pdf.js needs worker/blob + wasm-unsafe-eval.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: file:",
  "media-src 'self' data: blob: file:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob: file:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

function cspMetaPlugin(): Plugin {
  return {
    name: 'plottracer-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `  <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n  </head>`
      );
    },
  };
}

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
  plugins: [react(), cspMetaPlugin()],
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
