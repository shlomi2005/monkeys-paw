import { defineConfig } from '@playwright/test';

// End-to-end config (paw-web task 42). The tests run against the production build served by `vite preview`, with the
// API answered by `page.route` stubs (e2e/support/stub-api.ts). Nothing here talks to a real API or model.

const HOST = '127.0.0.1';
const PORT = 4173;
const ORIGIN = `http://${HOST}:${PORT}`;

/** Software GL, so the 3D canvas mounts on machines and CI runners without a GPU. */
const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  // A flaky end-to-end test must fail, not hide.
  retries: 0,
  workers: 2,
  forbidOnly: true,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // `list` only: the html reporter starts a report server on failure.
  reporter: [['list']],
  use: {
    baseURL: ORIGIN,
    browserName: 'chromium',
    launchOptions: { args: WEBGL_ARGS },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      // Every spec except `*.mobile.spec.ts`.
      name: 'desktop',
      testIgnore: /.*\.mobile\.spec\.ts$/,
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      // Only `*.mobile.spec.ts` (task 48 adds them).
      name: 'mobile',
      testMatch: /.*\.mobile\.spec\.ts$/,
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    // Build, then serve the build. `VITE_API_BASE_URL` is empty so the app calls its own origin, where the stub answers.
    command: `pnpm run build && pnpm exec vite preview --host ${HOST} --port ${PORT} --strictPort`,
    cwd: import.meta.dirname,
    url: ORIGIN,
    env: { VITE_API_BASE_URL: '' },
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
