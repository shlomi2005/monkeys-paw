// @vitest-environment jsdom
// useResultFirst (paw-web design.md "Mobile" B): the wish slot and the examples slot move by ref, in a layout effect.
// Nothing else moves, focus, caret and selection survive, and a render that finds them in place touches nothing.

import { cleanup, render } from '@testing-library/react';
import { StrictMode, useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useResultFirst } from './use-result-first';

afterEach(cleanup);

/** The layout of App.tsx in miniature: the same order, the same kinds of nodes, one modal-style dialog in the middle. */
function Layout({ resultFirst }: { resultFirst: boolean }) {
  const wish = useRef<HTMLDivElement>(null);
  const examples = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const sound = useRef<HTMLDivElement>(null);
  useResultFirst(resultFirst, { wish, examples, ring, sound });
  return (
    <div data-testid="layout">
      <div data-slot="paw" />
      <div data-slot="wish" ref={wish}>
        <input aria-label="wish" defaultValue="Only the owner can delete" />
        <button type="button">seal</button>
      </div>
      <div data-slot="examples" ref={examples}>
        <button type="button">card</button>
      </div>
      <div data-slot="ring" ref={ring}>
        <button type="button">circle</button>
      </div>
      <dialog data-slot="dialog" />
      <div data-slot="actions">
        <button type="button">stop</button>
      </div>
      <div data-slot="sound" ref={sound}>
        <button type="button">sound</button>
      </div>
    </div>
  );
}

const slots = (): string[] =>
  Array.from(document.querySelector('[data-testid="layout"]')!.children).map((node) => (node as HTMLElement).dataset['slot']!);
const node = (slot: string): HTMLElement => document.querySelector(`[data-slot="${slot}"]`)!;

const USUAL = ['paw', 'wish', 'examples', 'ring', 'dialog', 'actions', 'sound'];
const RESULT_FIRST = ['paw', 'ring', 'dialog', 'actions', 'wish', 'examples', 'sound'];

describe('useResultFirst: the move', () => {
  it('leaves the usual order alone', () => {
    render(<Layout resultFirst={false} />);
    expect(slots()).toEqual(USUAL);
  });

  it('puts the wish slot, then the examples slot, before the sound slot, and back before the ring', () => {
    const { rerender } = render(<Layout resultFirst={false} />);
    rerender(<Layout resultFirst />);
    expect(slots()).toEqual(RESULT_FIRST);
    rerender(<Layout resultFirst={false} />);
    expect(slots()).toEqual(USUAL);
    rerender(<Layout resultFirst />);
    expect(slots()).toEqual(RESULT_FIRST);
  });

  it('moves before the first paint when it starts result first', () => {
    render(<Layout resultFirst />);
    expect(slots()).toEqual(RESULT_FIRST);
  });

  it('moves the same nodes (no remount), and never the ring, the dialog, the actions or the paw', () => {
    const { rerender } = render(<Layout resultFirst={false} />);
    const before = Object.fromEntries(USUAL.map((slot) => [slot, node(slot)]));
    rerender(<Layout resultFirst />);
    for (const slot of USUAL) expect(node(slot), slot).toBe(before[slot]);
    // The nodes that stay never left the document: only the wish and the examples slots were touched.
    const watcher = new MutationObserver(() => undefined);
    watcher.observe(document.querySelector('[data-testid="layout"]')!, { childList: true });
    rerender(<Layout resultFirst={false} />);
    rerender(<Layout resultFirst />);
    const touched = watcher
      .takeRecords()
      .flatMap((record) => [...record.removedNodes, ...record.addedNodes].map((moved) => (moved as HTMLElement).dataset['slot'] ?? '?'));
    watcher.disconnect();
    expect(new Set(touched)).toEqual(new Set(['wish', 'examples']));
  });

  it('does nothing when they are already in place', () => {
    const { rerender } = render(<Layout resultFirst />);
    const watcher = new MutationObserver(() => undefined);
    watcher.observe(document.querySelector('[data-testid="layout"]')!, { childList: true, subtree: true });
    rerender(<Layout resultFirst />);
    rerender(<Layout resultFirst />);
    expect(watcher.takeRecords()).toEqual([]);
    watcher.disconnect();
  });

  it('gives the same result when StrictMode runs the effect twice', () => {
    const { rerender } = render(
      <StrictMode>
        <Layout resultFirst />
      </StrictMode>,
    );
    expect(slots()).toEqual(RESULT_FIRST);
    rerender(
      <StrictMode>
        <Layout resultFirst={false} />
      </StrictMode>,
    );
    expect(slots()).toEqual(USUAL);
  });

  it('keeps the typed text', () => {
    const { rerender } = render(<Layout resultFirst={false} />);
    const input = document.querySelector<HTMLInputElement>('[data-slot="wish"] input')!;
    input.value = 'typed after mount';
    rerender(<Layout resultFirst />);
    expect(document.querySelector<HTMLInputElement>('[data-slot="wish"] input')!.value).toBe('typed after mount');
  });
});

describe('useResultFirst: focus', () => {
  it('keeps focus, caret and selection of an input in a moved slot, both ways', () => {
    const { rerender } = render(<Layout resultFirst={false} />);
    const input = document.querySelector<HTMLInputElement>('[data-slot="wish"] input')!;
    input.focus();
    input.setSelectionRange(4, 9, 'backward');

    rerender(<Layout resultFirst />);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([4, 9, 'backward']);

    input.setSelectionRange(7, 7);
    rerender(<Layout resultFirst={false} />);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([7, 7]);
  });

  it('restores focus on a button of a moved slot', () => {
    const { rerender } = render(<Layout resultFirst={false} />);
    const card = document.querySelector<HTMLButtonElement>('[data-slot="examples"] button')!;
    card.focus();
    rerender(<Layout resultFirst />);
    expect(document.activeElement).toBe(card);
  });

  it('restores focus without scrolling', () => {
    const { rerender } = render(<Layout resultFirst={false} />);
    const input = document.querySelector<HTMLInputElement>('[data-slot="wish"] input')!;
    input.focus();
    const options: Array<FocusOptions | undefined> = [];
    const focus = input.focus.bind(input);
    input.focus = (given?: FocusOptions) => {
      options.push(given);
      focus(given);
    };
    // Where the browser blurs the node it moves, the effect has to focus it again.
    const original = Element.prototype.before;
    Element.prototype.before = function (this: Element, ...nodes: (Node | string)[]) {
      original.apply(this, nodes);
      (document.activeElement as HTMLElement | null)?.blur();
    };
    try {
      rerender(<Layout resultFirst />);
    } finally {
      Element.prototype.before = original;
    }
    expect(options).toEqual([{ preventScroll: true }]);
    expect(document.activeElement).toBe(input);
  });

  it('leaves focus alone when it is elsewhere', () => {
    const { rerender } = render(<Layout resultFirst={false} />);
    const circle = document.querySelector<HTMLButtonElement>('[data-slot="ring"] button')!;
    circle.focus();
    rerender(<Layout resultFirst />);
    expect(document.activeElement).toBe(circle);
  });
});
