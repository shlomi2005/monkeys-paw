// @vitest-environment jsdom
// WishLine: the 18+ box, its alert, the outside screen and the inert seal after the Grant (Req 13.2, 13.3, 13.6, 13.11).

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADULT_REQUIRED_MESSAGE,
  EMPTY_WISH_MESSAGE,
  OUTSIDE_NOTE_MESSAGE,
  SEAL_USED_MESSAGE,
  WISH_SENT_TO_GEMINI_MESSAGE,
} from '../api/api-messages';
import { declarationsFor, parseCss, readText } from '../styles/css-test-support';
import type { WishLineProps } from './WishLine';
import { WishLine } from './WishLine';

afterEach(cleanup);

function setup(overrides: Partial<WishLineProps> = {}) {
  const props: WishLineProps = {
    text: 'Only the owner can delete a project',
    context: '',
    onTextChange: vi.fn(),
    onContextChange: vi.fn(),
    onSubmit: vi.fn(),
    granting: false,
    notice: null,
    outside: false,
    adultConfirmed: false,
    onAdultChange: vi.fn(),
    sealed: false,
    ...overrides,
  };
  const view = render(<WishLine {...props} />);
  return { props, ...view };
}

const box = (): HTMLInputElement => screen.getByRole('checkbox', { name: 'I am 18 or older' }) as HTMLInputElement;
const seal = (): HTMLButtonElement => screen.getByRole('button', { name: 'Make the wish' }) as HTMLButtonElement;
const wish = (): HTMLInputElement => screen.getByLabelText('I wish that') as HTMLInputElement;
const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();

describe('the 18+ checkbox', () => {
  it('is a native, unticked checkbox with autocomplete off, between the context and the seal', () => {
    const { container } = setup();
    expect(box().type).toBe('checkbox');
    expect(box().checked).toBe(false);
    expect(box().getAttribute('autocomplete')).toBe('off');
    const order = Array.from(container.querySelectorAll('input, button'));
    expect(order.indexOf(box())).toBeGreaterThan(order.indexOf(screen.getByRole('button', { name: /^for…/ })));
    expect(order.indexOf(box())).toBe(order.indexOf(seal()) - 1);
  });

  it('reports a tick through onAdultChange', () => {
    const { props } = setup();
    fireEvent.click(box());
    expect(props.onAdultChange).toHaveBeenCalledWith(true);
  });

  it('shows the alert, marks the box invalid, describes it by the alert and focuses it when the wish needs the tick', () => {
    const onSubmit = vi.fn(() => 'adult-required' as const);
    setup({ onSubmit });
    fireEvent.click(seal());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(ADULT_REQUIRED_MESSAGE);
    expect(box().getAttribute('aria-invalid')).toBe('true');
    expect(box().getAttribute('aria-describedby')).toBe(alert.id);
    expect(document.activeElement).toBe(box());
  });

  it('keeps focus where it is for any other outcome, and a blank wish keeps priority over the alert', () => {
    const onSubmit = vi.fn(() => 'sent' as const);
    setup({ onSubmit });
    fireEvent.click(seal());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).not.toBe(box());
    cleanup();

    const blank = vi.fn(() => 'adult-required' as const);
    setup({ text: '  ', onSubmit: blank });
    fireEvent.click(seal());
    expect(blank).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(EMPTY_WISH_MESSAGE);
    expect(document.activeElement).toBe(wish());
    expect(box().getAttribute('aria-invalid')).toBeNull();
  });

  it('clears the alert when the box is ticked', () => {
    const { props } = setup({ onSubmit: vi.fn(() => 'adult-required' as const) });
    fireEvent.click(seal());
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(box());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(props.onAdultChange).toHaveBeenCalledWith(true);
  });

  it("shows the server's line as an error and keeps the box described by it when the server unticked it", () => {
    setup({ notice: { kind: 'error', text: ADULT_REQUIRED_MESSAGE } });
    expect(box().getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(box())).toBe(ADULT_REQUIRED_MESSAGE);
    expect(document.activeElement).not.toBe(box());
  });
});

describe('the outside screen', () => {
  it('has no checkbox, and the outside note replaces the privacy note', () => {
    setup({ outside: true });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(OUTSIDE_NOTE_MESSAGE).tagName).toBe('P');
    expect(screen.queryByText(WISH_SENT_TO_GEMINI_MESSAGE)).toBeNull();
  });
});

describe('the seal after the Grant (A14)', () => {
  it('is aria-disabled, focusable, not natively disabled, and described by the visible reason', () => {
    setup({ sealed: true, adultConfirmed: true });
    expect(seal().getAttribute('aria-disabled')).toBe('true');
    expect(seal().disabled).toBe(false);
    expect(seal().tabIndex).toBe(0);
    expect(describedBy(seal())).toBe(SEAL_USED_MESSAGE);
    expect(screen.getByText(SEAL_USED_MESSAGE)).toBeTruthy();
  });

  it('is never described by nothing when a notice has the message row', () => {
    setup({ sealed: true, adultConfirmed: true, notice: { kind: 'error', text: 'The paw is slow to wake.' } });
    expect(screen.getByText('The paw is slow to wake.')).toBeTruthy();
    expect(describedBy(seal())).toBe(SEAL_USED_MESSAGE);
  });

  it('is not described at all in the usual state', () => {
    setup({ adultConfirmed: true });
    expect(seal().hasAttribute('aria-disabled')).toBe(false);
    expect(seal().hasAttribute('aria-describedby')).toBe(false);
  });

  it('sends nothing on click, Enter in the wish line, or Space on the seal', () => {
    const { props } = setup({ sealed: true, adultConfirmed: true });
    fireEvent.click(seal());
    fireEvent.submit(seal().form as HTMLFormElement);
    fireEvent.keyDown(wish(), { key: 'Enter' });
    fireEvent.keyDown(seal(), { key: ' ' });
    fireEvent.keyUp(seal(), { key: ' ' });
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('makes the inputs read-only and the checkbox aria-disabled and inert', () => {
    const { props } = setup({ sealed: true, adultConfirmed: true, context: 'a shop' });
    expect(wish().readOnly).toBe(true);
    expect((screen.getByLabelText('for…') as HTMLInputElement).readOnly).toBe(true);
    expect(box().getAttribute('aria-disabled')).toBe('true');
    expect(box().disabled).toBe(false);
    fireEvent.click(box());
    expect(props.onAdultChange).not.toHaveBeenCalled();
  });

  it('is restored when sealed turns off', () => {
    const { rerender, props } = setup({ sealed: true, adultConfirmed: true });
    rerender(<WishLine {...props} sealed={false} />);
    expect(seal().hasAttribute('aria-disabled')).toBe(false);
    expect(wish().readOnly).toBe(false);
    expect(screen.queryByText(SEAL_USED_MESSAGE)).toBeNull();
  });

  it('stays natively disabled while granting', () => {
    setup({ granting: true, adultConfirmed: true });
    expect(seal().disabled).toBe(true);
    expect(wish().disabled).toBe(true);
    expect(box().disabled).toBe(true);
  });
});

describe('stylesheet', () => {
  const css = parseCss(readText('./WishLine.module.css', import.meta.url));

  it('makes the inert seal clearly different: transparent fill, ink text, dashed ink border, default cursor, no shadow', () => {
    const inert = declarationsFor(css, '.sealInert', null);
    expect(inert['background']).toBe('transparent');
    expect(inert['color']).toBe('var(--ink)');
    expect(inert['border-style']).toBe('dashed');
    expect(inert['cursor']).toBe('default');
    expect(inert['box-shadow']).toBe('none');
    expect(inert['opacity']).toBe('1');
  });

  it('gives no hover glow or pressed shadow to an aria-disabled seal', () => {
    const raw = readText('./WishLine.module.css', import.meta.url);
    expect(raw).toContain(".seal:active:not(:disabled):not([aria-disabled='true'])");
    expect(raw).toContain(".seal:hover:not(:disabled):not([aria-disabled='true'])");
  });

  it('keeps the 18+ row at least 48 px high and on the "for…" row from 768 px', () => {
    expect(declarationsFor(css, '.adult', null)['min-height']).toBe('3rem');
    const raw = readText('./WishLine.module.css', import.meta.url);
    expect(raw).toContain("'context context adult'");
  });
});
