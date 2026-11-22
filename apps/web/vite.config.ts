import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import type { PluginOption } from 'vite';
import { devApi } from './scripts/dev-api';

// The joint contract lives in docs/art/paw/ and is imported, not copied (design.md, "Assets and where they are
// served from"). Relative paths only: the alias is resolved against this file.
const APP_DIR = fileURLToPath(new URL('.', import.meta.url));
const PAW_ASSET_DIR = fileURLToPath(new URL('../../docs/art/paw', import.meta.url));

// `PAW_VISUALIZE=1 pnpm build` also writes the bundle report into dist/ (gitignored): stats.html for people,
// stats.json (raw data) for scripts. A normal build is unchanged. The plugin never opens a browser.
const VISUALIZE = process.env.PAW_VISUALIZE === '1';
const reports = (): PluginOption[] =>
  VISUALIZE
    ? [
        visualizer({ filename: 'dist/stats.html', template: 'treemap', gzipSize: true, open: false }),
        visualizer({ filename: 'dist/stats.json', template: 'raw-data', gzipSize: true, open: false }),
      ]
    : [];

export default defineConfig({
  plugins: [react(), devApi(), ...reports()],
  build: {
    // scripts/check-bundle-budget.mjs reads dist/.vite/manifest.json (design.md section 8).
    manifest: true,
  },
  resolve: {
    alias: { '@paw-asset': PAW_ASSET_DIR },
  },
  server: {
    fs: {
      // Keep serving the app root and the workspace, and allow the asset folder explicitly.
      allow: [searchForWorkspaceRoot(APP_DIR), PAW_ASSET_DIR],
    },
  },
});
