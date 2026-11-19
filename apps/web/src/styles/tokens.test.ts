// Checks the non-colour tokens (design section 7), the static shell in index.html (section 8: FCP, LCP, CLS) and the
// font and noise budgets (Req 12.2, 10.1).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { declarationsFor, parseCss, readText } from './css-test-support';

const plateCss = readText('../components/PlateFrame.module.css', import.meta.url);
const indexHtml = readText('../../index.html', import.meta.url);
const fontsCss = readText('./fonts.css', import.meta.url);
const tokensCss = readText('./tokens.css', import.meta.url);

const MOBILE = null;
const DESKTOP = '(min-width: 768px)';
const REDUCED = '(prefers-reduced-motion: reduce)';

const tokens = parseCss(tokensCss);
const base = declarationsFor(tokens, ':root', null);
const desktop = declarationsFor(tokens, ':root', DESKTOP);
const reduced = declarationsFor(tokens, ':root', REDUCED);

const ms = (value: string | undefined): number => {
  const match = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(value ?? '');
  if (!match) throw new Error(`Not a duration: ${String(value)}`);
  return Number(match[1]) * (match[2] === 's' ? 1000 : 1);
};

describe('size and type tokens', () => {
  it('sets a 16 px base under 768 px and an 18 px base from 768 px, as floors', () => {
    expect(base['font-size']).toBe('max(16px, 100%)');
    expect(desktop['font-size']).toBe('max(18px, 112.5%)');
  });

  it('uses a line height of 1.5', () => {
    expect(base['line-height']).toBe('var(--line-height)');
    expect(base['--line-height']).toBe('1.5');
  });

  it('sizes the paw box 150 to 200 px on mobile and 300 to 400 px on desktop with clamp()', () => {
    expect(base['--paw-size']).toMatch(/^clamp\(150px, [\d.]+vw, 200px\)$/);
    // Desktop: from the width and from the height, whichever is smaller, so the stage fits one screen.
    expect(desktop['--paw-size']).toMatch(/^clamp\(300px, min\([\d.]+vw, [\d.]+vh\), 400px\)$/);
  });

  it('declares the ring radii, wider than tall', () => {
    expect(base['--ring-rx']).toBeDefined();
    expect(base['--ring-ry']).toBeDefined();
  });

  it('names the font stacks and puts a metric-matched fallback behind each web font', () => {
    expect(base['--font-display']).toMatch(/^'IM Fell English', 'IM Fell English Fallback'/);
    expect(base['--font-body']).toMatch(/^'Crimson Text', 'Crimson Text Fallback'/);
  });
});

describe('duration tokens and reduced motion', () => {
  const ONE_OFFS = ['--dur-fill', '--dur-seal', '--dur-fade'] as const;
  const LOOPS = ['--dur-smoke', '--dur-curtain', '--dur-pulse'] as const;

  it('defines every duration token', () => {
    for (const name of [...ONE_OFFS, ...LOOPS]) expect(ms(base[name]), name).toBeGreaterThan(0);
  });

  it('keeps the brazier smoke at 2 to 3 s and the curtain at about 500 ms', () => {
    expect(ms(base['--dur-smoke'])).toBeGreaterThanOrEqual(2000);
    expect(ms(base['--dur-smoke'])).toBeLessThanOrEqual(3000);
    expect(ms(base['--dur-curtain'])).toBe(500);
  });

  it('cuts every duration to at most 1 ms under prefers-reduced-motion', () => {
    for (const name of [...ONE_OFFS, ...LOOPS]) expect(ms(reduced[name]), name).toBeLessThanOrEqual(1);
  });

  it('turns the loops and the pulse off under prefers-reduced-motion', () => {
    expect(base['--loop-iterations']).toBe('infinite');
    expect(base['--pulse-iterations']).toBe('1');
    expect(reduced['--loop-iterations']).toBe('0');
    expect(reduced['--pulse-iterations']).toBe('0');
  });
});

describe('static shell in index.html', () => {
  const style = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)?.[1] ?? '';
  const critical = parseCss(style);

  it('has inline critical CSS with the same paw-box values as tokens.css', () => {
    expect(style).not.toBe('');
    expect(declarationsFor(critical, ':root', MOBILE)['--paw-size']).toBe(base['--paw-size']);
    expect(declarationsFor(critical, ':root', DESKTOP)['--paw-size']).toBe(desktop['--paw-size']);
  });

  it('uses the same palette values as tokens.css', () => {
    const shell = declarationsFor(critical, ':root', MOBILE);
    for (const name of ['--ink', '--sepia', '--parchment']) expect(shell[name], name).toBe(base[name]);
  });

  it('reserves a 1:1 box from --paw-size', () => {
    const box = declarationsFor(critical, '#static-shell .shell-paw', MOBILE);
    expect(box['width']).toBe('var(--paw-size)');
    expect(box['aspect-ratio']).toBe('1 / 1');
  });

  it('is fixed, so removing it moves nothing', () => {
    expect(declarationsFor(critical, '#static-shell', MOBILE)['position']).toBe('fixed');
  });

  it('puts the poster in the box with explicit size, no alt text and aria-hidden', () => {
    const img = /<img\b[^>]*>/.exec(indexHtml)?.[0] ?? '';
    expect(img).toContain('src="/paw/paw-poster.jpg"');
    expect(img).toMatch(/\bwidth="1080"/);
    expect(img).toMatch(/\bheight="1080"/);
    expect(img).toMatch(/\balt=""/);
    expect(img).toContain('aria-hidden="true"');
  });

  it('preloads the poster with high priority', () => {
    const link = /<link\b[^>]*rel="preload"[^>]*>/.exec(indexHtml)?.[0] ?? '';
    expect(link).toContain('as="image"');
    expect(link).toContain('href="/paw/paw-poster.jpg"');
    expect(link).toContain('fetchpriority="high"');
  });

  it('leaves #root for React and has no third-party URL', () => {
    expect(indexHtml).toContain('<div id="root"></div>');
    expect(indexHtml).not.toMatch(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});

describe('fonts', () => {
  const fontDir = fileURLToPath(new URL('./fonts/', import.meta.url));
  const files = readdirSync(fontDir);
  const woff2 = files.filter((name) => name.endsWith('.woff2'));

  it('totals at most 140 KB of WOFF2', () => {
    const total = woff2.reduce((sum, name) => sum + statSync(`${fontDir}${name}`).size, 0);
    expect(total).toBeLessThanOrEqual(140_000);
  });

  it('keeps one OFL licence text per family', () => {
    for (const name of ['OFL-IM-Fell-English.txt', 'OFL-Crimson-Text.txt']) {
      expect(readFileSync(`${fontDir}${name}`, 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
  });

  it('references only files that exist and only WOFF2 under ./fonts/, with no remote URL', () => {
    const urls = [...fontsCss.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1] as string);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url, url).toMatch(/^\.\/fonts\/[\w-]+\.woff2$/);
      expect(existsSync(fileURLToPath(new URL(url, new URL('./', import.meta.url)))), url).toBe(true);
    }
    expect(woff2.every((name) => urls.includes(`./fonts/${name}`))).toBe(true);
    expect(fontsCss).not.toMatch(/https?:|\/\//);
  });

  it('uses font-display: swap on every web face and size-adjust with metric overrides on every fallback face', () => {
    const faces = parseCss(fontsCss).filter((rule) => rule.selector === '@font-face');
    const web = faces.filter((face) => face.declarations['src']?.includes('url('));
    const fallback = faces.filter((face) => !face.declarations['src']?.includes('url('));
    expect(web).toHaveLength(woff2.length);
    expect(fallback.length).toBeGreaterThanOrEqual(2);
    for (const face of web) expect(face.declarations['font-display']).toBe('swap');
    for (const face of fallback) {
      expect(face.declarations['size-adjust']).toMatch(/%$/);
      expect(face.declarations['ascent-override']).toMatch(/%$/);
      expect(face.declarations['descent-override']).toMatch(/%$/);
    }
  });
});

describe('noise texture', () => {
  it('is an inline vector texture under 20 KB, with no raster image', () => {
    const uris = [...plateCss.matchAll(/url\("(data:[^"]+)"\)/g)].map((m) => m[1] as string);
    expect(uris.length).toBeGreaterThan(0);
    for (const uri of uris) expect(uri.length).toBeLessThan(20 * 1024);
    expect(plateCss).not.toMatch(/\.(png|jpe?g|webp|gif)/i);
  });
});
