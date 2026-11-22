// usePhoneFocus: the scroll and focus rules of a phone (paw-web design.md "Mobile" C). Desktop does nothing here.
// "Focus is lost" means `document.activeElement` is null, the body, or a disabled control: a control that has just been
// disabled stays the active element until the browser blurs it, and removing a node blurs it. The rules react to a change
// between two renders, never to a value, so a rotation (which changes `phone`, not the phase) triggers none of them.
// Run it after `useResultFirst`: layout effects run in hook order, so the move comes first, then scroll and focus.

import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { Phase } from '../state/paw-machine-types';

export interface PhoneFocusInput {
  readonly phone: boolean;
  readonly phase: Phase;
  /** `session.grantedSeq`: changes whenever a Grant arrives, also an instant cached replay that never shows "granting". */
  readonly grantedSeq: number;
  /** The export buttons are shown: the round has ended. */
  readonly showExport: boolean;
  /** The layout grid. */
  readonly root: RefObject<HTMLElement | null>;
  /** The slots that `useResultFirst` moves. */
  readonly wish: RefObject<HTMLElement | null>;
  readonly examples: RefObject<HTMLElement | null>;
}

function isFocusLost(): boolean {
  const active = document.activeElement;
  return (
    active === null ||
    active === document.body ||
    active === document.documentElement ||
    (active instanceof HTMLElement && active.matches(':disabled'))
  );
}

/**
 * Focuses an element that is not interactive. It gets `tabindex="-1"` for as long as it keeps focus: the attribute goes
 * once the element is no longer the active element, checked after `blur` (when the window loses focus, the element stays
 * the active element and keeps its attribute). It is never a tab stop.
 */
export function focusTemporarily(element: HTMLElement, options?: FocusOptions): void {
  if (!element.hasAttribute('tabindex')) {
    element.setAttribute('tabindex', '-1');
    const onBlur = (): void => {
      // While the blur event runs, the next element has not taken focus yet: look once it has.
      setTimeout(() => {
        if (document.activeElement === element) return;
        element.removeAttribute('tabindex');
        element.removeEventListener('blur', onBlur);
      }, 0);
    };
    element.addEventListener('blur', onBlur);
  }
  element.focus(options);
}

function scrollToTop(): void {
  if (typeof window.scrollTo !== 'function') return;
  try {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  } catch {
    window.scrollTo(0, 0); // a browser that does not know "instant"
  }
}

export function usePhoneFocus({ phone, phase, grantedSeq, showExport, root, wish, examples }: PhoneFocusInput): void {
  const before = useRef({ phase, grantedSeq, showExport });

  // No dependency list: it compares this render with the last one, so a StrictMode second run finds nothing to do.
  useLayoutEffect(() => {
    const was = before.current;
    before.current = { phase, grantedSeq, showExport };
    const layout = root.current;
    if (!phone || !layout) return;

    const wishSlot = wish.current;
    const examplesSlot = examples.current;

    if (grantedSeq !== was.grantedSeq) {
      // A Grant arrived, after the move. Never smooth, whatever the reduced-motion setting.
      scrollToTop();
      const active = document.activeElement;
      const inMovedNode = active !== null && (wishSlot?.contains(active) === true || examplesSlot?.contains(active) === true);
      const narration = layout.querySelector<HTMLElement>('[data-narration]');
      if (narration && (isFocusLost() || inMovedNode)) focusTemporarily(narration, { preventScroll: true });
    } else if (phase === 'granting' && was.phase !== 'granting') {
      const status = wishSlot?.querySelector<HTMLElement>('[role="status"]');
      if (status && isFocusLost()) focusTemporarily(status);
    } else if (phase === 'idle' && was.phase === 'granting') {
      // The Grant failed.
      const status = wishSlot?.querySelector<HTMLElement>('[role="status"]');
      if (isFocusLost() || (status && document.activeElement === status)) {
        wishSlot?.querySelector<HTMLElement>('input')?.focus();
      }
    }

    if (showExport && !was.showExport && isFocusLost()) {
      layout.querySelector<HTMLElement>('[data-slot="export"] button')?.focus();
    }
  });
}
