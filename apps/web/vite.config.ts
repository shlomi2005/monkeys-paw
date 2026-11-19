import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

// The joint contract lives in docs/art/paw/ and is imported, not copied (design.md, "Assets and where they are
// served from"). Relative paths only: the alias is resolved against this file.
const APP_DIR = fileURLToPath(new URL('.', import.meta.url));
const PAW_ASSET_DIR = fileURLToPath(new URL('../../docs/art/paw', import.meta.url));

export default defineConfig({
  plugins: [react()],
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
