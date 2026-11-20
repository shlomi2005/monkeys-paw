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
