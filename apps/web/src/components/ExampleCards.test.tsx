// @vitest-environment jsdom
// ExampleCards and ExampleCard: every ExamplesState, selection by click and Enter, highlight, dimming.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Grant } from 'paw-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLES_SLEEPING_MESSAGE } from '../api/api-messages';
import type { ExampleEntry, ExamplesState } from '../api/api-schemas';
import { declarationsFor, parseCss, readText } from '../styles/css-test-support';
import { ExampleCards } from './ExampleCards';
import { snippet } from './snippet';
import type { ExampleCardsProps } from './ExampleCards';

afterEach(cleanup);

const GRANT: Grant = {
  wishId: 'w',
  narration: 'Granted.',
  curses: [
    { id: 'c1', type: 'permissions', story: 's1', loophole: 'l1', status: 'open' },
    { id: 'c2', type: 'money', story: 's2', loophole: 'l2', status: 'open' },
    { id: 'c3', type: 'time', story: 's3', loophole: 'l3', status: 'open' },
  ],
};

function entry(id: string, text: string, context?: string): ExampleEntry {
  return { wish: { id, text, ...(context === undefined ? {} : { context }), createdAt: 1 }, grant: GRANT };
}

const LONG_WISH =
  'Only the owner of a project can delete it, and every deletion must be confirmed by email within a day';
const LONG_CONTEXT = 'A team workspace where people join, leave and take over projects from each other';

const ENTRIES: readonly ExampleEntry[] = [
  entry('a', 'Only the owner can delete a project', 'a team workspace'),
  entry('b', LONG_WISH, LONG_CONTEXT),
  entry('c', 'Refunds are issued within 30 days'),
];

function setup(state: ExamplesState, overrides: Partial<ExampleCardsProps> = {}) {
  const props: ExampleCardsProps = { state, selectedIndex: null, dimmed: false, onSelect: vi.fn(), ...overrides };
  const view = render(<ExampleCards {...props} />);
  return { props, ...view };
}

const ready = (entries: readonly ExampleEntry[] = ENTRIES): ExamplesState => ({ kind: 'ready', entries });
const cards = (): HTMLButtonElement[] => screen.getAllByRole('button') as HTMLButtonElement[];

describe('loading', () => {
  it('renders a busy row of inert ghost cards with no buttons', () => {
    const { container } = setup({ kind: 'loading' });
    const region = container.firstElementChild as HTMLElement;
    expect(region.getAttribute('data-state')).toBe('loading');
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(region.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('uses the same fixed-height region as the other states (no layout shift)', () => {
    const regions = (['loading', 'unavailable'] as const).map((kind) => {
      const { container, unmount } = setup({ kind });
      const className = (container.firstElementChild as HTMLElement).className;
      unmount();
      return className;
    });
    const { container } = setup(ready());
    regions.push((container.firstElementChild as HTMLElement).className);
    expect(new Set(regions).size).toBe(1);

    const css = parseCss(readText('./ExampleCards.module.css', import.meta.url));
    const height = declarationsFor(css, '.region', null)['height'] ?? '';
    expect(height).toContain('var(--card-h)');
    expect(declarationsFor(css, '.region', null)['--card-h']).toBeDefined();
    expect(declarationsFor(css, '.region', '(min-width: 768px)')['--card-h']).toBeDefined();
  });
});

describe('unavailable', () => {
  it('shows one placeholder card that is text, not a button and not an error', () => {
    setup({ kind: 'unavailable' });
    expect(screen.getByText(EXAMPLES_SLEEPING_MESSAGE)).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ready', () => {
  it('renders one button per entry in a labelled list, named by the visible text in the visible order', () => {
    setup(ready());
    const list = screen.getByRole('list', { name: 'Example wishes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    // Label in Name (WCAG 2.5.3): "Example", the wish snippet, the context snippet. No word is added or dropped.
    expect(cards().map((card) => card.getAttribute('aria-label'))).toEqual([
      'Example. Only the owner can delete a project. a team workspace',
      `Example. ${snippet(LONG_WISH)}. ${snippet(LONG_CONTEXT)}`,
      'Example. Refunds are issued within 30 days',
    ]);
  });

  it('keeps the whole wish and context for a screen reader when the card shows a cut snippet', () => {
    setup(ready());
    const [whole, cut, noContext] = cards() as unknown as [HTMLElement, HTMLElement, HTMLElement];
    expect(whole.hasAttribute('aria-describedby')).toBe(false);
    expect(noContext.hasAttribute('aria-describedby')).toBe(false);
    const description = document.getElementById(cut.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe(`Whole wish: ${LONG_WISH}. Context: ${LONG_CONTEXT}.`);
    // Only the cut card has a description node.
    expect(document.querySelectorAll('[class*="fullText"]')).toHaveLength(1);
  });

  it('shows the Example label on every card', () => {
    setup(ready());
    for (const card of cards()) expect(within(card).getByText('Example')).toBeTruthy();
  });

  it('shows short text whole and cuts long text to about 50 characters with an ellipsis', () => {
    setup(ready());
    const [first, second] = cards();
    expect(within(first as HTMLElement).getByText('Only the owner can delete a project')).toBeTruthy();
    expect(within(first as HTMLElement).getByText('a team workspace')).toBeTruthy();

    const wish = within(second as HTMLElement).getByText(/^Only the owner of a project/);
    expect(wish.textContent?.endsWith('…')).toBe(true);
    expect(Array.from(wish.textContent ?? '').length).toBeLessThanOrEqual(50);
    expect(LONG_WISH.startsWith((wish.textContent ?? '').slice(0, -1))).toBe(true);
    const context = within(second as HTMLElement).getByText(/^A team workspace where/);
    expect(context.textContent?.endsWith('…')).toBe(true);
  });

  it('leaves out the context line when the wish has none', () => {
    setup(ready());
    expect((cards()[2] as HTMLElement).querySelectorAll('span')).toHaveLength(2);
  });

  it('keeps entries text-only (markup in a wish stays literal)', () => {
    const html = '<img src=x onerror="alert(1)">';
    const { container } = setup(ready([entry('x', html)]));
    expect(container.querySelector('img')).toBeNull();
    expect((cards()[0] as HTMLElement).textContent).toContain(html);
  });

  it('selects by click, reporting the entry and its index', () => {
    const { props } = setup(ready());
    fireEvent.click(cards()[1] as HTMLElement);
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith(ENTRIES[1], 1);
  });

  it('is a native button, so Enter and Space select it', () => {
    // jsdom does not turn key presses into clicks. A native <button> gets that from the browser, so the
    // test checks the element type and that nothing intercepts the keys.
    const { props } = setup(ready());
    const card = cards()[0] as HTMLButtonElement;
    expect(card.tagName).toBe('BUTTON');
    expect(card.type).toBe('button');
    expect(card.tabIndex).toBe(0);
    expect(fireEvent.keyDown(card, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(card, { key: ' ' })).toBe(true);
    card.focus();
    expect(document.activeElement).toBe(card);
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('marks only the selected card with aria-pressed="true"', () => {
    setup(ready(), { selectedIndex: 1 });
    expect(cards().map((card) => card.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect((cards()[1] as HTMLElement).className).toMatch(/selected/);
    expect((cards()[0] as HTMLElement).className).not.toMatch(/selected/);
  });

  it('clears the highlight when the parent clears the selection', () => {
    const view = setup(ready(), { selectedIndex: 0 });
    view.rerender(<ExampleCards {...view.props} selectedIndex={null} />);
    expect(cards().every((card) => card.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('marks no card when the selected index is out of range', () => {
    setup(ready(), { selectedIndex: 9 });
    expect(cards().every((card) => card.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('renders an empty ready list without cards', () => {
    setup(ready([]));
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('dimmed', () => {
  it.each([
    ['loading', { kind: 'loading' } as ExamplesState],
    ['unavailable', { kind: 'unavailable' } as ExamplesState],
    ['ready', ready()],
  ])('adds the dimmed class in the %s state only when asked', (_name, state) => {
    const { container, rerender, props } = setup(state);
    const region = (): HTMLElement => container.firstElementChild as HTMLElement;
    expect(region().className).not.toMatch(/dimmed/);
    rerender(<ExampleCards {...props} dimmed />);
    expect(region().className).toMatch(/dimmed/);
  });

  it('keeps the cards clickable while dimmed', () => {
    const { props } = setup(ready(), { dimmed: true });
    fireEvent.click(cards()[0] as HTMLElement);
    expect(props.onSelect).toHaveBeenCalledWith(ENTRIES[0], 0);
  });
});

describe('stylesheets', () => {
  const rowsCss = readText('./ExampleCards.module.css', import.meta.url);
  const rows = parseCss(rowsCss);
  const card = parseCss(readText('./ExampleCard.module.css', import.meta.url));
  const cardText = readText('./ExampleCard.module.css', import.meta.url);
  const DESKTOP = '(min-width: 768px)';

  it('scrolls horizontally', () => {
    expect(declarationsFor(rows, '.row', null)['overflow-x']).toBe('auto');
  });

  it('sizes a mobile card to a third of the strip and a desktop card to 15 rem', () => {
    expect(declarationsFor(rows, '.item', null)['flex']).toContain('/ 3');
    expect(declarationsFor(rows, '.item', DESKTOP)['flex-basis']).toBe('15rem');
  });

  it('dims with opacity', () => {
    expect(Number(declarationsFor(rows, '.dimmed', null)['opacity'])).toBeLessThan(1);
    expect(Number(declarationsFor(rows, '.dimmed', null)['opacity'])).toBeGreaterThanOrEqual(0.7);
  });

  it('shows the focus ring from the tokens and glows the selected card', () => {
    expect(declarationsFor(card, '.card:focus-visible', null)['outline']).toBe(
      'var(--focus-ring-width) solid var(--focus-ring-color)',
    );
    expect(cardText).toMatch(/\.selected,\s*\.card\[aria-pressed='true'\]\s*\{[^}]*border-color: var\(--blood\);[^}]*box-shadow:[^}]*--blood/);
  });

  it('puts every :hover rule inside (hover: hover)', () => {
    for (const rule of [...rows, ...card].filter((r) => r.selector.includes(':hover'))) {
      expect(rule.media).toBe('(hover: hover)');
    }
    expect(card.some((r) => r.selector.includes(':hover'))).toBe(true);
  });

  it('never sets text below 1rem and runs no keyframe animation', () => {
    for (const text of [rowsCss, cardText]) {
      for (const size of text.match(/font-size:\s*[^;]+/g) ?? []) {
        expect(Number.parseFloat(size.replace(/font-size:\s*/, ''))).toBeGreaterThanOrEqual(1);
      }
      expect(text).not.toContain('@keyframes');
    }
  });
});
