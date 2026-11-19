// @vitest-environment jsdom
// CircleRing and CurseCircle: labels and roles per status, empty circles hidden and not focusable, an arriving circle
// is aria-disabled, activation (click, Enter, Space) calls onActivate with the index, the story is reachable through
// aria-describedby, and the DOM order is index 0 to 4.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Curse, CurseType } from 'paw-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { declarationsFor, parseCss, readText } from '../styles/css-test-support';
import { curseTypeLabel } from '../state/paw-selectors';
import type { CircleIndex, CircleView } from '../state/paw-selectors';
import { CircleRing } from './CircleRing';
import { CIRCLE_INDEXES } from './circle-layout';

afterEach(cleanup);

const TYPES: readonly CurseType[] = ['permissions', 'money', 'time', 'data-loss', 'edge-input'];

const CURSES: readonly Curse[] = TYPES.map((type, i) => ({
  id: `curse-${i}`,
  type,
  story: `Story number ${i}: the system obeys exactly.`,
  loophole: `Loophole number ${i}: the words "exactly ${i}".`,
  status: 'open' as const,
}));

type Status = CircleView['status'];

/** Same strings as `circleViews` in state/paw-selectors.ts. */
function view(index: CircleIndex, status: Status): CircleView {
  const label = curseTypeLabel(TYPES[index] as CurseType);
  const text: Record<Status, string> = {
    empty: '',
    arriving: `${label} curse, arriving`,
    open: `${label} curse, open, click to bind`,
    closed: `${label} curse, closed, sealed`,
    'open-final': `${label} curse, open, the paw remembers`,
  };
  return { index, status, ariaLabel: text[status] };
}

function views(...statuses: Status[]): CircleView[] {
  return CIRCLE_INDEXES.map((i) => view(i, statuses[i] ?? 'empty'));
}

function renderRing(circles: CircleView[], curses: readonly Curse[] = CURSES) {
  const onActivate = vi.fn();
  const utils = render(<CircleRing circles={circles} curses={curses} onActivate={onActivate} />);
  const slots = [...utils.container.querySelectorAll<HTMLElement>('li[data-index]')];
  return { ...utils, onActivate, slots };
}

/** What a browser does for a focused native button: Enter clicks on keydown, Space clicks on keyup. jsdom does not. */
function press(target: HTMLElement, key: 'Enter' | ' '): void {
  const down = fireEvent.keyDown(target, { key });
  if (key === 'Enter' && down) fireEvent.click(target);
  const up = fireEvent.keyUp(target, { key });
  if (key === ' ' && up && down) fireEvent.click(target);
}

describe('structure', () => {
  it('renders five slots in DOM order 0 to 4, whatever the statuses', () => {
    const { slots } = renderRing(views('open', 'empty', 'closed', 'arriving', 'open-final'));
    expect(slots.map((s) => s.dataset['index'])).toEqual(['0', '1', '2', '3', '4']);
  });

  it('keeps index order when the views arrive shuffled', () => {
    const shuffled = [view(3, 'open'), view(0, 'open'), view(4, 'open'), view(1, 'open'), view(2, 'open')];
    const { slots } = renderRing(shuffled);
    expect(slots.map((s) => s.dataset['index'])).toEqual(['0', '1', '2', '3', '4']);
  });

  it('puts the buttons in index order, so that is also the tab order', () => {
    renderRing(views('open', 'open', 'closed', 'open', 'open-final'));
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(CIRCLE_INDEXES.map((i) => view(i, i === 2 ? 'closed' : i === 4 ? 'open-final' : 'open').ariaLabel));
  });

  it('renders five empty slots when a view is missing', () => {
    const { slots } = renderRing([], []);
    expect(slots).toHaveLength(5);
    expect(slots.every((s) => s.dataset['status'] === 'empty')).toBe(true);
  });

  it('gives every slot its unit offsets from the layout table', () => {
    const { slots } = renderRing(views('open', 'open', 'open', 'open', 'open'));
    const dx = slots.map((s) => Number(s.style.getPropertyValue('--dx')));
    const dy = slots.map((s) => Number(s.style.getPropertyValue('--dy')));
    expect(dx[0]).toBeLessThan(0);
    expect(dx[1]).toBe(0);
    expect(dx[2]).toBeGreaterThan(0);
    expect(dy.map((v) => v < 0)).toEqual([true, true, true, false, false]);
  });
});

describe('empty circles', () => {
  it('are aria-hidden blank discs with no button and no tab stop', () => {
    const { slots } = renderRing(views('open', 'empty', 'empty', 'empty', 'empty'));
    for (const slot of slots.slice(1)) {
      expect(slot.getAttribute('aria-hidden')).toBe('true');
      expect(slot.dataset['status']).toBe('empty');
      expect(slot.querySelector('button, a, input, [tabindex]')).toBeNull();
      expect(slot.textContent).toBe('');
    }
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('hide the whole ring from assistive technology when nothing has arrived', () => {
    const { container } = renderRing(views());
    expect(container.querySelector('ul')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('keep the ring visible once one circle is filled', () => {
    const { container } = renderRing(views('arriving'));
    expect(container.querySelector('ul')?.hasAttribute('aria-hidden')).toBe(false);
  });

  it('stay blank when the curse exists but its curl is still queued', () => {
    const { slots } = renderRing(views('open', 'empty', 'empty'));
    expect(slots[1]?.textContent).toBe('');
    expect(screen.queryByText(CURSES[1]?.story as string)).toBeNull();
  });
});

describe.each<[Status, boolean]>([
  ['arriving', true],
  ['open', false],
  ['closed', false],
  ['open-final', false],
])('a %s circle', (status, disabled) => {
  it('is one button named by the CircleView label, with the type label text and an svg', () => {
    const { slots } = renderRing(views(status));
    const button = within(slots[0] as HTMLElement).getByRole('button');
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toBe(view(0, status).ariaLabel);
    expect(screen.getByRole('button', { name: view(0, status).ariaLabel })).toBe(button);
    expect(button.textContent).toBe('Permissions');
    expect(slots[0]?.dataset['status']).toBe(status);
    expect(button.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2);
  });

  it(`is ${disabled ? '' : 'not '}aria-disabled`, () => {
    renderRing(views(status));
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-disabled')).toBe(disabled ? 'true' : null);
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('is aria-hidden on every svg and is not hidden itself', () => {
    const { container } = renderRing(views(status));
    for (const svg of container.querySelectorAll('svg')) expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button').closest('[aria-hidden="true"]')).toBeNull();
  });

  it('shows its story as a caption next to the button, not inside it', () => {
    const { slots } = renderRing(views(status));
    const story = within(slots[0] as HTMLElement).getByText(CURSES[0]?.story as string);
    expect(story.closest('button')).toBeNull();
    expect(slots[0]?.contains(story)).toBe(true);
  });

  it('can take focus', () => {
    renderRing(views(status));
    const button = screen.getByRole('button');
    button.focus();
    expect(document.activeElement).toBe(button);
  });
});

describe('statuses', () => {
  it('shows the laurel only on a closed circle', () => {
    const { slots } = renderRing(views('open', 'closed', 'arriving', 'open-final'));
    const laurels = slots.map((s) => s.querySelector('[data-laurel]') !== null);
    expect(laurels).toEqual([false, true, false, false, false]);
  });

  it('keeps the seal on a closed circle and cracks it on an open-final one', () => {
    const { slots } = renderRing(views('open', 'closed', 'arriving', 'open-final'));
    const seals = slots.map((s) => s.querySelector('[data-seal]')?.getAttribute('data-seal') ?? null);
    expect(seals).toEqual(['sealed', 'sealed', 'sealed', 'cracked', null]);
  });

  it('says "The paw remembers." only on an open-final circle', () => {
    const { slots } = renderRing(views('open', 'closed', 'arriving', 'open-final'));
    const texts = slots.map((s) => s.textContent?.includes('The paw remembers.') === true);
    expect(texts).toEqual([false, false, false, true, false]);
  });

  it('shows the curse type label in the display name of each type', () => {
    const { slots } = renderRing(views('open', 'open', 'open', 'open', 'open'));
    const labels = slots.map((s) => s.querySelector('button')?.textContent);
    expect(labels).toEqual(['Permissions', 'Money', 'Time', 'Data loss', 'Edge input']);
  });

  it('changes status without remounting the button, so the fill does not replay', () => {
    const onActivate = vi.fn();
    const { rerender } = render(<CircleRing circles={views('arriving')} curses={CURSES} onActivate={onActivate} />);
    const before = screen.getByRole('button');
    const ink = before.querySelector('[class*="ink"]');
    rerender(<CircleRing circles={views('open')} curses={CURSES} onActivate={onActivate} />);
    expect(screen.getByRole('button')).toBe(before);
    expect(before.querySelector('[class*="ink"]')).toBe(ink);
    rerender(<CircleRing circles={views('closed')} curses={CURSES} onActivate={onActivate} />);
    expect(screen.getByRole('button')).toBe(before);
  });

  it('mounts the ink layer when a circle goes from empty to arriving', () => {
    const onActivate = vi.fn();
    const { rerender } = render(<CircleRing circles={views()} curses={CURSES} onActivate={onActivate} />);
    expect(document.querySelector('[class*="ink"]')).toBeNull();
    rerender(<CircleRing circles={views('arriving')} curses={CURSES} onActivate={onActivate} />);
    expect(document.querySelector('[class*="ink"]')).not.toBeNull();
  });

  it('follows a round: empty, arriving, open, closed', () => {
    const onActivate = vi.fn();
    const labels: Array<string | null> = [];
    const { rerender } = render(<CircleRing circles={views('empty')} curses={CURSES} onActivate={onActivate} />);
    for (const status of ['arriving', 'open', 'closed'] as const) {
      rerender(<CircleRing circles={views(status)} curses={CURSES} onActivate={onActivate} />);
      labels.push(screen.getByRole('button').getAttribute('aria-label'));
    }
    expect(labels).toEqual([
      'Permissions curse, arriving',
      'Permissions curse, open, click to bind',
      'Permissions curse, closed, sealed',
    ]);
  });
});

describe('story and loophole', () => {
  it('are reachable through aria-describedby', () => {
    renderRing(views('open', 'closed', 'arriving', 'open-final', 'open'));
    for (const button of screen.getAllByRole('button')) {
      const index = Number(button.closest('li')?.dataset['index']);
      const ids = (button.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      expect(ids).toHaveLength(2);
      const text = ids.map((id) => document.getElementById(id)?.textContent ?? '');
      expect(text[0]).toBe(CURSES[index]?.story);
      expect(text[1]).toBe(CURSES[index]?.loophole);
    }
  });

  it('use ids that are unique on the page', () => {
    renderRing(views('open', 'open', 'open', 'open', 'open'));
    const ids = screen.getAllByRole('button').flatMap((b) => (b.getAttribute('aria-describedby') ?? '').split(' '));
    expect(new Set(ids).size).toBe(10);
  });

  it('keep the loophole out of the visible text', () => {
    const { slots } = renderRing(views('open'));
    const loophole = slots[0]?.querySelector('[hidden]');
    expect(loophole?.textContent).toBe(CURSES[0]?.loophole);
  });

  it('are not in the button name', () => {
    renderRing(views('open'));
    expect(screen.getByRole('button').getAttribute('aria-label')).not.toContain('Story');
  });
});

describe('activation', () => {
  it('calls onActivate with the index on click', () => {
    const { onActivate } = renderRing(views('open', 'open', 'open', 'open', 'open'));
    fireEvent.click(screen.getAllByRole('button')[3] as HTMLElement);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(3);
  });

  it.each([
    ['Enter', 'Enter' as const],
    ['Space', ' ' as const],
  ])('calls onActivate exactly once on %s (native button, no extra key handler)', (_name, key) => {
    const { onActivate } = renderRing(views('open', 'open', 'open'));
    const button = screen.getAllByRole('button')[2] as HTMLElement;
    button.focus();
    press(button, key);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(2);
  });

  it('passes every index through for a closed and an open-final circle, and leaves the decision to the caller', () => {
    const { onActivate } = renderRing(views('closed', 'open-final'));
    for (const button of screen.getAllByRole('button')) fireEvent.click(button);
    expect(onActivate.mock.calls).toEqual([[0], [1]]);
  });

  it('does not call onActivate for an arriving circle (aria-disabled)', () => {
    const { onActivate } = renderRing(views('arriving', 'open'));
    fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement);
    press(screen.getAllByRole('button')[0] as HTMLElement, 'Enter');
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('becomes active once the circle is no longer arriving', () => {
    const onActivate = vi.fn();
    const { rerender } = render(<CircleRing circles={views('arriving')} curses={CURSES} onActivate={onActivate} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onActivate).not.toHaveBeenCalled();
    rerender(<CircleRing circles={views('open')} curses={CURSES} onActivate={onActivate} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onActivate).toHaveBeenCalledWith(0);
  });

  it('never calls onActivate for an empty circle', () => {
    const { onActivate, slots } = renderRing(views('open'));
    for (const slot of slots.slice(1)) fireEvent.click(slot);
    expect(onActivate).not.toHaveBeenCalled();
  });
});

describe('stylesheets', () => {
  const ring = parseCss(readText('./CircleRing.module.css', import.meta.url));
  const circle = parseCss(readText('./CurseCircle.module.css', import.meta.url));
  const circleText = readText('./CurseCircle.module.css', import.meta.url);
  const DESKTOP = '(min-width: 768px)';

  it('is a vertical list on mobile and an anchored ring from 768 px', () => {
    const mobile = declarationsFor(ring, '.ring', null);
    expect(mobile['flex-direction']).toBe('column');
    expect(mobile['--disc']).toBe('60px');
    const desktop = declarationsFor(ring, '.ring', DESKTOP);
    expect(desktop['position']).toBe('absolute');
    expect(desktop['--disc']).toBe('80px');
  });

  it('places each desktop slot from --dx, --dy, --ring-rx and --ring-ry', () => {
    const slot = declarationsFor(circle, '.slot', DESKTOP);
    expect(slot['position']).toBe('absolute');
    expect(slot['left']).toContain('var(--dx)');
    expect(slot['left']).toContain('var(--ring-rx)');
    expect(slot['top']).toContain('var(--dy)');
    expect(slot['top']).toContain('var(--ring-ry)');
  });

  it('keeps every disc at or above the 48 px hit area', () => {
    const sizes = [declarationsFor(ring, '.ring', null)['--disc'], declarationsFor(ring, '.ring', DESKTOP)['--disc']];
    for (const size of sizes) expect(Number.parseInt(size ?? '0', 10)).toBeGreaterThanOrEqual(48);
    expect(declarationsFor(circle, '.button', null)['width']).toBe('var(--disc)');
  });

  it('fills from the centre outwards over --dur-fill with ease-out, on clip-path only', () => {
    const ink = declarationsFor(circle, '.ink', null);
    expect(ink['animation']).toBe('fill-in var(--dur-fill) ease-out both');
    const keyframes = /@keyframes fill-in\s*\{([\s\S]*?\})\s*\}/.exec(circleText)?.[1] ?? '';
    expect(keyframes).toMatch(/circle\(0% at 50% 50%\)/);
    expect(keyframes.match(/[a-z-]+(?=:)/g)?.every((p) => p === 'clip-path')).toBe(true);
  });

  it('takes the seal and fade durations from the tokens, so reduced motion collapses them', () => {
    expect(declarationsFor(circle, '.sealPress', null)['animation']).toContain('var(--dur-seal)');
    expect(declarationsFor(circle, '.sealCrack', null)['animation']).toContain('var(--dur-seal)');
    expect(circleText.match(/animation:[^;]*/g)?.every((rule) => /var\(--dur-/.test(rule))).toBe(true);
  });

  it('shows the focus ring from the tokens', () => {
    const focus = declarationsFor(circle, '.button:focus-visible', null);
    expect(focus['outline']).toBe('var(--focus-ring-width) solid var(--focus-ring-color)');
    expect(focus['outline-offset']).toBe('var(--focus-ring-offset)');
  });

  it('puts the top-centre caption beside its disc and clamps the visible story', () => {
    expect(declarationsFor(circle, ".slot[data-index='1'] .caption", DESKTOP)['left']).toContain('100%');
    expect(declarationsFor(circle, '.story', DESKTOP)['-webkit-line-clamp']).toBe('4');
  });
});
