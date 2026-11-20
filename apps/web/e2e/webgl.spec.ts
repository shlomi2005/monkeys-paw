// The WebGL check (paw-web task 42): with the SwiftShader launch args of playwright.config.ts the app must leave
// poster mode. Every round test relies on this, because the curl and open timings only exist with the 3D scene.

import { expect, test } from './support/test';
import { eventsOf, readTimeline, requireEvent } from './support/timeline';

test('the 3D canvas mounts and the poster steps aside', async ({ paw }) => {
  await paw.open();

  const renderer = await paw.page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl !== null && info != null ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null;
  });
  expect(renderer, 'the GL renderer behind the canvas').toMatch(/swiftshader/i);

  const events = await readTimeline(paw.page);
  const mounted = requireEvent(events, 'canvas', (value) => value === 'mounted');
  const hidden = requireEvent(events, 'poster', (value) => value === 'hidden');
  expect(hidden.t, 'the poster hides after the canvas mounts').toBeGreaterThanOrEqual(mounted.t);
  expect(eventsOf(events, 'canvas')).toHaveLength(1);
});


// Task 48 (desktop half): above 768 px the app picks the big model, and only that one (Req 2.2, 10.5).
test('desktop requests paw-web.glb and no other GLB', async ({ paw }) => {
  const glbs: string[] = [];
  paw.page.on('request', (request) => {
    if (/\.glb(\?|$)/.test(request.url())) glbs.push(new URL(request.url()).pathname);
  });
  await paw.open();
  await paw.makeWish();
  await paw.expectCurled(5);
  expect(glbs).toEqual(['/paw/paw-web.glb']);
});

// Task 50 (Req 10.4, design.md section 8): the 3D chunk stays out of the first load. It is requested only after the
// window `load` event. Both times come from the page's own clock: `loadEventStart` of the navigation entry and the
// `startTime` (request start) of the chunk's resource entry.
test('the 3D chunk is requested only after the window load event', async ({ paw }) => {
  const { page } = paw;
  await paw.open();

  const times = await page.evaluate(() => {
    const [navigation] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    const chunks = performance
      .getEntriesByType('resource')
      .filter((entry) => /\/assets\/PawScene-[^/]+\.js$/.test(new URL(entry.name).pathname))
      .map((entry) => ({ name: new URL(entry.name).pathname, requestedAt: entry.startTime }));
    return { loadEventStart: navigation?.loadEventStart ?? 0, chunks };
  });

  expect(times.loadEventStart, 'the load event has fired').toBeGreaterThan(0);
  expect(times.chunks, 'exactly one 3D chunk is requested').toHaveLength(1);
  expect(times.chunks[0]!.requestedAt, `${times.chunks[0]!.name} is requested after the load event`).toBeGreaterThanOrEqual(
    times.loadEventStart,
  );
});
