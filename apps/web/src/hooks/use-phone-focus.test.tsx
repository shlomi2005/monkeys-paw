// @vitest-environment jsdom
// usePhoneFocus (paw-web design.md "Mobile" C): the scroll and focus rules of a phone, one test per rule, and the same
// moments on desktop, where nothing may happen.

import { cleanup, render } from '@testing-library/react';
import { StrictMode, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Phase } from '../state/paw-machine-types';
import { focusTemporarily, usePhoneFocus } from './use-phone-focus';

interface State {
  readonly phone: boolean;
  readonly phase: Phase;
  readonly grantedSeq: number;
  readonly showExport: boolean;
}

const IDLE: State = { phone: true, phase: 'idle', grantedSeq: 0, showExport: false };
const GRANTING: State = { ...IDLE, phase: 'granting' };
const GRANTED: State = { ...IDLE, phase: 'curling', grantedSeq: 1 };
const ENDED: State = { ...GRANTED, phase: 'ended', showExport: true };

/** The parts App.tsx gives the hook, in miniature. The wish line is disabled while granting, as the real one is. */
function Page({ phone, phase, grantedSeq, showExport }: State) {
  const root = useRef<HTMLDivElement>(null);
  const wish = useRef<HTMLDivElement>(null);
  const examples = useRef<HTMLDivElement>(null);
  usePhoneFocus({ phone, phase, grantedSeq, showExport, root, wish, examples });
  const granting = phase === 'granting';
  return (
    <div ref={root}>
      <div data-testid="stamp-slot">{grantedSeq > 0 && <p data-narration>Granted. Exactly as written.</p>}</div>
      <div data-testid="ring">
        <button type="button">circle</button>
      </div>
      <div data-slot="export">{showExport && <button type="button">Take the scroll</button>}</div>
      <div ref={wish} data-testid="wish">
        <input aria-label="wish" disabled={granting} />
        <button type="submit" disabled={granting}>
          seal
        </button>
        <p role="status">{granting ? 'The Paw stirs…' : ''}</p>
      </div>
      <div ref={examples}>
        <button type="button" data-testid="card">
          card
        </button>
      </div>
    </div>
  );
}

let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollTo = vi.fn();
  vi.stubGlobal('scrollTo', scrollTo);
  (window as unknown as { scrollTo: unknown }).scrollTo = scrollTo;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const $ = (selector: string): HTMLElement => document.querySelector<HTMLElement>(selector)!;
const input = (): HTMLInputElement => $('input') as HTMLInputElement;
const status = (): HTMLElement => $('[role="status"]');
const narration = (): HTMLElement => $('[data-narration]');

function mount(state: State) {
  const view = render(<Page {...state} />);
  return {
    set(next: State): void {
      view.rerender(<Page {...next} />);
    },
  };
}

describe('usePhoneFocus: granting', () => {
  it('moves focus from a control that has just been disabled to the status line', () => {
    const page = mount(IDLE);
    input().focus();
    page.set(GRANTING);
    // The input is disabled and, as in a browser, is still the active element: that counts as lost.
    expect(input().matches(':disabled')).toBe(true);
    expect(document.activeElement).toBe(status());
    expect(status().getAttribute('tabindex')).toBe('-1');
  });

  it('does the same when focus was on the body', () => {
    const page = mount(IDLE);
    page.set(GRANTING);
    expect(document.activeElement).toBe(status());
  });

  it('leaves focus where it is when it is still on a working control', () => {
    const page = mount(IDLE);
    const card = $('[data-testid="card"]');
    card.focus();
    page.set(GRANTING);
    expect(document.activeElement).toBe(card);
    expect(status().hasAttribute('tabindex')).toBe(false);
  });
});

describe('usePhoneFocus: a Grant arrives', () => {
  it('scrolls to the top without smoothing, and focuses the narration from the status line', () => {
    const page = mount(IDLE);
    page.set(GRANTING);
    expect(document.activeElement).toBe(status());
    page.set(GRANTED);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
    expect(document.activeElement).toBe(narration());
    expect(narration().getAttribute('tabindex')).toBe('-1');
  });

  it('focuses the narration without scrolling the page', () => {
    const page = mount(IDLE);
    page.set(GRANTING);
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    page.set(GRANTED);
    expect(focus.mock.calls.some(([options]) => (options as FocusOptions | undefined)?.preventScroll === true)).toBe(true);
    focus.mockRestore();
  });

  it('does the same for an instant replay that never rendered "granting"', () => {
    const page = mount(IDLE);
    input().focus();
    page.set(GRANTED);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(narration());
  });

  it('takes focus from the examples too', () => {
    const page = mount(IDLE);
    $('[data-testid="card"]').focus();
    page.set(GRANTED);
    expect(document.activeElement).toBe(narration());
  });

  it('leaves focus on a circle or another working control outside the wish line', () => {
    const page = mount(IDLE);
    const circle = $('[data-testid="ring"] button');
    circle.focus();
    page.set(GRANTED);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(circle);
  });

  it('scrolls and focuses once, also under StrictMode', () => {
    const view = render(
      <StrictMode>
        <Page {...IDLE} />
      </StrictMode>,
    );
    input().focus();
    view.rerender(
      <StrictMode>
        <Page {...GRANTED} />
      </StrictMode>,
    );
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(narration());
  });

  it('falls back to scrollTo(0, 0) where the browser does not know "instant"', () => {
    scrollTo.mockImplementationOnce(() => {
      throw new TypeError('The provided value is not a valid enum value');
    });
    mount(IDLE).set(GRANTED);
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
  });

  it('does not fail where scrollTo is missing', () => {
    (window as unknown as { scrollTo: unknown }).scrollTo = undefined;
    expect(() => mount(IDLE).set(GRANTED)).not.toThrow();
  });

  it('does not scroll or move focus when only the screen turns (the phone flag changes, the Grant stays)', () => {
    const page = mount({ ...GRANTED, phone: false });
    input().focus();
    page.set(GRANTED);
    page.set({ ...GRANTED, phone: false });
    page.set(GRANTED);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input());
  });

  it('does not fire on a later render with the same Grant', () => {
    const page = mount(GRANTED);
    page.set({ ...GRANTED, phase: 'ready' });
    page.set({ ...GRANTED, phase: 'binding' });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('usePhoneFocus: a Grant fails', () => {
  it('returns focus from the status line to the wish input', () => {
    const page = mount(IDLE);
    input().focus();
    page.set(GRANTING);
    expect(document.activeElement).toBe(status());
    page.set(IDLE);
    expect(document.activeElement).toBe(input());
  });

  it('returns focus that was lost to the wish input', () => {
    const page = mount(IDLE);
    page.set(GRANTING);
    status().blur();
    expect(document.activeElement).toBe(document.body);
    page.set(IDLE);
    expect(document.activeElement).toBe(input());
  });

  it('leaves focus on another working control', () => {
    const page = mount(IDLE);
    page.set(GRANTING);
    const card = $('[data-testid="card"]');
    card.focus();
    page.set(IDLE);
    expect(document.activeElement).toBe(card);
  });
});

describe('usePhoneFocus: the round ends', () => {
  it('focuses "Take the scroll" when focus was lost with Stop', () => {
    const page = mount(GRANTED);
    $('[data-testid="ring"] button').focus();
    $('[data-testid="ring"] button').blur();
    page.set(ENDED);
    expect(document.activeElement).toBe($('[data-slot="export"] button'));
  });

  it('leaves focus on a circle that has it', () => {
    const page = mount(GRANTED);
    const circle = $('[data-testid="ring"] button');
    circle.focus();
    page.set(ENDED);
    expect(document.activeElement).toBe(circle);
  });
});

describe('usePhoneFocus: desktop', () => {
  const DESKTOP_IDLE: State = { ...IDLE, phone: false };

  it('scrolls nothing and moves no focus through a whole round', () => {
    const page = mount(DESKTOP_IDLE);
    input().focus();
    page.set({ ...DESKTOP_IDLE, phase: 'granting' });
    // The disabled input keeps focus in jsdom, as it can in a browser: desktop is not touched either way.
    expect(document.activeElement).toBe(input());
    page.set({ ...DESKTOP_IDLE, phase: 'curling', grantedSeq: 1 });
    expect(document.activeElement).toBe(input());
    page.set({ ...DESKTOP_IDLE, phase: 'ended', grantedSeq: 1, showExport: true });
    expect(document.activeElement).toBe(input());
    page.set(DESKTOP_IDLE);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[tabindex]')).toHaveLength(0);
  });

  it('does not take focus that was lost', () => {
    const page = mount(DESKTOP_IDLE);
    page.set({ ...DESKTOP_IDLE, phase: 'granting' });
    expect(document.activeElement).toBe(document.body);
    page.set({ ...DESKTOP_IDLE, phase: 'ended', grantedSeq: 1, showExport: true });
    expect(document.activeElement).toBe(document.body);
  });
});

describe('focusTemporarily', () => {
  function target(): HTMLElement {
    const element = document.createElement('p');
    element.textContent = 'text';
    document.body.append(element);
    return element;
  }

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('gives the element tabindex -1, focuses it, and takes the attribute away after it loses focus', () => {
    vi.useFakeTimers();
    const element = target();
    const other = document.createElement('button');
    document.body.append(other);
    focusTemporarily(element);
    expect(document.activeElement).toBe(element);
    expect(element.getAttribute('tabindex')).toBe('-1');
    other.focus();
    // Checked after blur, not during it.
    expect(element.getAttribute('tabindex')).toBe('-1');
    vi.runAllTimers();
    expect(element.hasAttribute('tabindex')).toBe(false);
  });

  it('keeps the attribute while the element is still the active element (a window switch)', () => {
    vi.useFakeTimers();
    const element = target();
    focusTemporarily(element);
    element.dispatchEvent(new FocusEvent('blur'));
    vi.runAllTimers();
    expect(element.getAttribute('tabindex')).toBe('-1');
    // The real blur comes later.
    element.blur();
    vi.runAllTimers();
    expect(element.hasAttribute('tabindex')).toBe(false);
  });

  it('keeps a tabindex that was there before', () => {
    vi.useFakeTimers();
    const element = target();
    element.setAttribute('tabindex', '0');
    focusTemporarily(element);
    element.blur();
    vi.runAllTimers();
    expect(element.getAttribute('tabindex')).toBe('0');
  });

  it('is focused again with the attribute still there when called twice in a row', () => {
    vi.useFakeTimers();
    const element = target();
    focusTemporarily(element);
    element.blur();
    focusTemporarily(element);
    vi.runAllTimers();
    expect(document.activeElement).toBe(element);
    expect(element.getAttribute('tabindex')).toBe('-1');
  });
});
