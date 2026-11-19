// The page-level accessibility facts that index.html owns (paw-web task 34, Req 8.5): axe checks the body of the app in
// App.a11y.test.tsx, and cannot see these.

import { describe, expect, it } from 'vitest';
import { readText } from './styles/css-test-support';

const html = readText('../index.html', import.meta.url);

describe('index.html', () => {
  it('sets the page language and a title', () => {
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
  });

  it('does not stop the user from zooming (200% zoom, Req 8.5)', () => {
    const viewport = /<meta name="viewport" content="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(viewport).toContain('width=device-width');
    expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)/);
    expect(viewport).not.toMatch(/maximum-scale/);
  });
});
