import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests must never load the package's .env. `envDir: false` is not supported by this Vite version,
  // so point at a folder that does not exist.
  envDir: fileURLToPath(new URL('./tests/no-env-files', import.meta.url)),
  test: {
    globals: true,
    environment: 'node',
  },
});
