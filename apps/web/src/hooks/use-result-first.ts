// useResultFirst: on a phone with a Grant, the wish line and the examples come after the actions, on screen and in the
// DOM (paw-web design.md A12, "Mobile" A and B). The DOM order is the tab order, so the two nodes are moved, not
// restyled. They are moved by ref in a layout effect, before paint:
//   result first: ... ring, actions, wish slot, examples slot, sound slot
//   otherwise:    ... wish slot, examples slot, ring, actions, sound slot
// JSX keeps one constant order, so React never reorders keyed children (that would move the ring and the actions, and a
// modal <dialog> that leaves the document leaves the top layer). Nothing in the JSX that is conditional sits right
// before a moved node, so React's own inserts never use a moved node as their reference. Moving a node blurs what has
// focus inside it, so focus, caret and selection are put back, without scrolling.

import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

export interface ResultFirstSlots {
  readonly wish: RefObject<HTMLElement | null>;
  readonly examples: RefObject<HTMLElement | null>;
  /** The slot the pair sits before normally. */
  readonly ring: RefObject<HTMLElement | null>;
  /** The slot the pair sits before when result first. */
  readonly sound: RefObject<HTMLElement | null>;
}

interface Selection {
  readonly start: number;
  readonly end: number;
  readonly direction: 'forward' | 'backward' | 'none';
}

function selectionOf(element: HTMLElement): Selection | null {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return null;
  try {
    const { selectionStart: start, selectionEnd: end, selectionDirection: direction } = element;
    return start === null || end === null ? null : { start, end, direction: direction ?? 'none' };
  } catch {
    return null; // an input type without a selection
  }
}

export function useResultFirst(resultFirst: boolean, slots: ResultFirstSlots): void {
  const { wish: wishRef, examples: examplesRef, ring: ringRef, sound: soundRef } = slots;

  useLayoutEffect(() => {
    const [wish, examples, ring, sound] = [wishRef.current, examplesRef.current, ringRef.current, soundRef.current];
    if (!wish || !examples || !ring || !sound) return;
    const anchor = resultFirst ? sound : ring;
    if (wish.nextSibling === examples && examples.nextSibling === anchor) return; // already in place

    const active = document.activeElement;
    const focused = active instanceof HTMLElement && (wish.contains(active) || examples.contains(active)) ? active : null;
    const selection = focused ? selectionOf(focused) : null;

    anchor.before(wish, examples);

    if (focused && document.activeElement !== focused) {
      focused.focus({ preventScroll: true });
      if (selection) {
        try {
          (focused as HTMLInputElement).setSelectionRange(selection.start, selection.end, selection.direction);
        } catch {
          // not a text control any more: nothing to restore
        }
      }
    }
  }, [resultFirst, wishRef, examplesRef, ringRef, soundRef]);
}
