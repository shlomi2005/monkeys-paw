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

  it('reserves the narration height only when there is a Grant, so the wish line does not wait under an empty band', () => {
    expect(declarationsFor(rules, '.stampSlot', MOBILE)['min-height']).toBe('0');
    const withGrant = declarationsFor(rules, '.stampSlot:has([data-narration])', MOBILE);
    expect(withGrant['min-height']).toMatch(/narration-lines/);
  });
});

describe('App layout: the Granted stamp stays under the wrist cord', () => {
  // The cord is at 0.64 to 0.78 of the paw box height. The stamp's top edge is at --stamp-top of the box height.
  it('has its top edge at 0.80 of the paw box height or lower', () => {
    const top = Number(layout(MOBILE)['--stamp-top']);
    expect(top).toBeGreaterThanOrEqual(0.8);
    expect(top).toBeLessThan(1);
  });

  it('is placed from the paw box size, on a phone and on desktop, not in fixed pixels', () => {
    for (const media of [MOBILE, DESKTOP]) {
      const stamp = declarationsFor(rules, '.stampSlot [data-stamp]', media);
      expect(stamp['top'], String(media)).toMatch(/--paw-size\)[^;]*--stamp-top/);
      expect(stamp['top'], String(media)).not.toMatch(/\d+px/);
      expect(stamp['bottom'], String(media)).toBeUndefined();
    }
  });

  it('sizes the letters from the paw box, at least 14 px on a phone and 18 px on desktop', () => {
    expect(declarationsFor(rules, '.stampSlot [data-stamp]', MOBILE)['font-size']).toMatch(/^max\(0\.875rem, .*--paw-size/);
    expect(declarationsFor(rules, '.stampSlot [data-stamp]', DESKTOP)['font-size']).toMatch(/^max\(1rem, .*--paw-size/);
    // 0.875 rem is 14 px at the 16 px phone base; 1 rem is 18 px at the 18 px desktop base (tokens.css).
  });

  it('is not given a larger size at 1024 px', () => {
    expect(declarationsFor(rules, '.stampSlot [data-stamp]', WIDE)['font-size']).toBeUndefined();
  });
});

describe('App layout: the lower captions never reach the brazier column (1024 px and up)', () => {
  const circleRules = parseCss(readText('../components/CurseCircle.module.css', import.meta.url)).flatMap((rule) =>
    rule.selector.split(',').map((selector) => ({ ...rule, selector: selector.trim() })),
  );

  it('derives the brazier column from the brazier width', () => {
    const wide = layout(WIDE);
    expect(wide['--brazier-inner']).toMatch(/--brazier-w/);
    expect(wide['--brazier-w']).toMatch(/min\(7vw, 6\.5rem\)/);
  });

  it('caps the width of captions 3 and 4 with it, beside their discs', () => {
    for (const index of ['3', '4']) {
      const caption = declarationsFor(circleRules, `.slot[data-index='${index}'] .caption`, WIDE);
      expect(caption['width'], index).toMatch(/^min\(\s*var\(--caption-w\),\s*calc\(var\(--brazier-inner, 100vw\)/);
      expect(caption['top'], index).toBe('0');
    }
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

describe('App layout: the end-screen actions stay clear of the narration (1024 px and up)', () => {
  it('starts the group right of the narration column, with a gap, from the width of that column', () => {
    const actions = declarationsFor(rules, '.actions', WIDE);
    const max = actions['max-width'] ?? '';
    expect(max).toMatch(/50%/);
    expect(max).toMatch(/--narration-w\)\s*\/\s*2/);
    expect(max).toMatch(/- 1rem\)$/);
    expect(declarationsFor(rules, '.actions', DESKTOP)['justify-self']).toBe('end');
  });

  it('wraps to a second row that grows upward from the bottom edge', () => {
    expect(declarationsFor(rules, '.actions', null)['flex-wrap']).toBe('wrap');
    expect(declarationsFor(rules, '.actions', WIDE)['align-content']).toBe('flex-end');
  });

  it('aligns the tops of the three buttons from 768 px, so the status line does not push Rewrite down', () => {
    expect(declarationsFor(rules, '.actions', DESKTOP)['align-items']).toBe('flex-start');
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
