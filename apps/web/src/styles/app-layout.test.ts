// Checks the page layout stylesheet (App.module.css, design.md sections 1 and 7). jsdom cannot measure layout, so this
// reads the stylesheet with the CSS reader in css-test-support.ts, the way tokens.test.ts does.

import { describe, expect, it } from 'vitest';
import { declarationsFor, parseCss, readText } from './css-test-support';

const appCss = readText('../App.module.css', import.meta.url);
const indexHtml = readText('../../index.html', import.meta.url);
const tokensCss = readText('./tokens.css', import.meta.url);

const MOBILE = null;
const DESKTOP = '(min-width: 768px)';
const WIDE = '(min-width: 1024px)';

// parseCss keeps a grouped selector (`.a, .b`) as one rule: split it, so each selector is found on its own.
const rules = parseCss(appCss).flatMap((rule) =>
  rule.selector.split(',').map((selector) => ({ ...rule, selector: selector.trim() })),
);
const layout = (media: string | null) => declarationsFor(rules, '.layout', media);

/** The rows of a grid-template-areas value, each as its list of area names. */
function areaRows(value: string | undefined): string[][] {
  return [...(value ?? '').matchAll(/'([^']+)'/g)].map((m) => (m[1] as string).trim().split(/\s+/));
}

const firstRow = (rows: string[][], name: string): number => rows.findIndex((row) => row.includes(name));

describe('App layout: mobile grid (under 768 px)', () => {
  const rows = areaRows(layout(MOBILE)['grid-template-areas']);
  const at = (name: string) => firstRow(rows, name);

  it('has one column, with every area present', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toHaveLength(1);
    for (const name of ['paw', 'stamp', 'wish', 'examples', 'ring', 'medal', 'actions']) expect(at(name), name).toBeGreaterThanOrEqual(0);
  });

  it('puts the wish line and the examples before the circle list, and the circle list before the actions', () => {
    expect(at('wish')).toBeLessThan(at('ring'));
    expect(at('examples')).toBeLessThan(at('ring'));
    expect(at('ring')).toBeLessThan(at('actions'));
    expect(at('ring')).toBeLessThan(at('medal'));
  });

  it('keeps the visual order the tab order: paw, stamp, wish, examples, circles, medal, actions', () => {
    const order = ['paw', 'stamp', 'wish', 'examples', 'ring', 'medal', 'actions'];
    expect(rows.map((row) => row[0])).toEqual(order);
  });

  it('reserves a height for the stamp area, so the Grant arriving moves nothing', () => {
    expect(declarationsFor(rules, '.stampSlot', MOBILE)['min-height']).toMatch(/narration-lines/);
  });
});

describe('App layout: desktop grid (768 px and up)', () => {
  const rows = areaRows(layout(DESKTOP)['grid-template-areas']);

  it('has no stamp, medal or actions row of its own', () => {
    const names = rows.flat();
    expect(names).not.toContain('stamp');
    expect(names).not.toContain('medal');
    expect(names).not.toContain('actions');
    expect(rows.map((row) => row[0])).toEqual(['stage', 'wish', 'examples']);
  });

  it('places the stamp slot, the paw box, the ring, the medal and the actions in the stage area', () => {
    for (const selector of ['.stampSlot', '.pawBox', '.ringSlot', '.medalSlot', '.actions', '.decorLayer']) {
      expect(declarationsFor(rules, selector, DESKTOP)['grid-area'], selector).toBe('stage');
    }
  });

  it('draws the narration out of the flow, so it costs no height', () => {
    expect(declarationsFor(rules, '.stampSlot [data-narration]', DESKTOP)['position']).toBe('absolute');
  });

  it('sets the stage height from tokens, not from the content', () => {
    const vars = layout(DESKTOP);
    expect(vars['--stage-top']).toBeDefined();
    expect(vars['--stage-bottom']).toBeDefined();
    expect(declarationsFor(rules, '.pawBox', DESKTOP)['margin-bottom']).toBe('var(--stage-bottom)');
  });

  it('is shorter from 1024 px, where the narration column replaces the narration band', () => {
    const wide = layout(WIDE);
    expect(wide['--stage-bottom']).toBeDefined();
    expect(wide['--stage-bottom']).not.toMatch(/8\.5rem/);
    expect(layout(DESKTOP)['--stage-bottom']).toMatch(/8\.5rem/);
  });
});

describe('App layout: DOM order stays the tab order', () => {
  it('never uses the `order` property', () => {
    for (const rule of rules) expect(Object.keys(rule.declarations), rule.selector).not.toContain('order');
  });
});

describe('paw size depends on the viewport height as well as the width', () => {
  const tokens = parseCss(tokensCss);
  const desktop = declarationsFor(tokens, ':root', DESKTOP)['--paw-size'] ?? '';

  it('has a vh term on desktop', () => {
    expect(desktop).toMatch(/[\d.]vh\b/);
  });

  it('is repeated unchanged in the inline critical CSS of index.html', () => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)?.[1] ?? '';
    expect(declarationsFor(parseCss(style), ':root', DESKTOP)['--paw-size']).toBe(desktop);
  });
});
