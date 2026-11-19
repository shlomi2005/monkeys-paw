// @vitest-environment jsdom
// WishLine: submit paths, the blank-wish line, the context disclosure, the granting state and the notice.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_WISH_MESSAGE, PAW_STIRS_MESSAGE } from '../api/api-messages';
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
    ...overrides,
  };
  const view = render(<WishLine {...props} />);
  return { props, ...view };
}

const wishInput = (): HTMLInputElement => screen.getByLabelText('I wish that') as HTMLInputElement;
const sealButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Make the wish' }) as HTMLButtonElement;
const disclosure = (): HTMLButtonElement => screen.getByRole('button', { name: /^for…/ }) as HTMLButtonElement;

describe('structure', () => {
  it('is a form whose seal button submits and whose input shares the form', () => {
    const { container } = setup();
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect(sealButton().type).toBe('submit');
    expect(sealButton().form).toBe(form);
    expect(wishInput().form).toBe(form);
  });

  it('labels the wish input and limits its length to something sensible', () => {
    setup();
    expect(wishInput().maxLength).toBeGreaterThanOrEqual(200);
    expect(wishInput().maxLength).toBeLessThanOrEqual(1000);
  });

  it('shows the value it is given and reports typing', () => {
    const { props } = setup({ text: 'abc' });
    expect(wishInput().value).toBe('abc');
    fireEvent.change(wishInput(), { target: { value: 'abcd' } });
    expect(props.onTextChange).toHaveBeenCalledWith('abcd');
  });
});

describe('focus order (Req 8.1)', () => {
  function focusables(container: HTMLElement): Element[] {
    const form = container.querySelector('form') as HTMLFormElement;
    return Array.from(form.querySelectorAll('input, button'));
  }

  it('is wish input, disclosure, seal button while the context is collapsed', () => {
    const { container } = setup();
    expect(focusables(container)).toEqual([wishInput(), disclosure(), sealButton()]);
  });

  it('is wish input, disclosure, context input, seal button while the context is open', () => {
    const { container } = setup();
    fireEvent.click(disclosure());
    const contextInput = screen.getByLabelText('for…');
    expect(focusables(container)).toEqual([wishInput(), disclosure(), contextInput, sealButton()]);
  });

  it('uses no positive tabindex, so the DOM order is the tab order', () => {
    const { container } = setup({ context: 'a clinic app' });
    for (const element of focusables(container)) {
      expect(element.hasAttribute('tabindex'), element.outerHTML).toBe(false);
    }
  });
});

describe('submitting', () => {
  it('submits on Enter in the wish input (a submit event from the input)', () => {
    const { props } = setup();
    fireEvent.submit(wishInput());
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('submits on a click of the seal button', () => {
    const { props } = setup();
    fireEvent.click(sealButton());
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each(['', '   ', '\t\n'])('shows the in-character line for the blank wish %j and makes no request', (blank) => {
    const { props } = setup({ text: blank });
    expect(screen.queryByText(EMPTY_WISH_MESSAGE)).toBeNull();
    fireEvent.click(sealButton());
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(EMPTY_WISH_MESSAGE)).toBeTruthy();
    expect(wishInput().getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps focus in the wish input after a blank submit', () => {
    setup({ text: '  ' });
    sealButton().focus();
    fireEvent.click(sealButton());
    expect(document.activeElement).toBe(wishInput());
  });

  it('hides the blank line again once the wish has text', () => {
    const view = setup({ text: '' });
    fireEvent.click(sealButton());
    expect(screen.getByText(EMPTY_WISH_MESSAGE)).toBeTruthy();
    view.rerender(<WishLine {...view.props} text="a wish" />);
    expect(screen.queryByText(EMPTY_WISH_MESSAGE)).toBeNull();
  });
});

describe('the "for…" context field', () => {
  it('is collapsed at first and the disclosure button says so', () => {
    setup();
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('for…')).toBeNull();
  });

  it('opens and closes with the disclosure button', () => {
    setup();
    fireEvent.click(disclosure());
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    const input = screen.getByLabelText('for…') as HTMLInputElement;
    expect(disclosure().getAttribute('aria-controls')).toBe(input.id);
    fireEvent.click(disclosure());
    expect(disclosure().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('for…')).toBeNull();
  });

  it('reports typing in the context field', () => {
    const { props } = setup();
    fireEvent.click(disclosure());
    fireEvent.change(screen.getByLabelText('for…'), { target: { value: 'a clinic app' } });
    expect(props.onContextChange).toHaveBeenCalledWith('a clinic app');
  });

  it('starts open when a context is already there', () => {
    setup({ context: 'a clinic app' });
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    expect((screen.getByLabelText('for…') as HTMLInputElement).value).toBe('a clinic app');
  });

  it('opens by itself when the parent fills a context (an example was picked)', () => {
    const view = setup();
    expect(screen.queryByLabelText('for…')).toBeNull();
    view.rerender(<WishLine {...view.props} context="a clinic app" />);
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
    expect((screen.getByLabelText('for…') as HTMLInputElement).value).toBe('a clinic app');
  });

  it('keeps its own open state when the context is cleared', () => {
    const view = setup({ context: 'x' });
    view.rerender(<WishLine {...view.props} context="" />);
    expect(disclosure().getAttribute('aria-expanded')).toBe('true');
  });

  it('submits with Enter from the context field too', () => {
    const { props } = setup();
    fireEvent.click(disclosure());
    fireEvent.submit(screen.getByLabelText('for…'));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('limits the context length', () => {
    setup({ context: 'x' });
    expect((screen.getByLabelText('for…') as HTMLInputElement).maxLength).toBeGreaterThanOrEqual(100);
  });
});

describe('granting', () => {
  it('disables the input, the context, the disclosure and the button, and says the Paw stirs', () => {
    setup({ granting: true, context: 'x' });
    expect(wishInput().disabled).toBe(true);
    expect((screen.getByLabelText('for…') as HTMLInputElement).disabled).toBe(true);
    expect(sealButton().disabled).toBe(true);
    expect(disclosure().disabled).toBe(true);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(PAW_STIRS_MESSAGE);
  });

  it('has an empty status line and enabled controls otherwise', () => {
    setup();
    expect(screen.getByRole('status').textContent).toBe('');
    expect(wishInput().disabled).toBe(false);
    expect(sealButton().disabled).toBe(false);
  });

  it('does not submit a second wish while granting', () => {
    const { props, container } = setup({ granting: true });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});

describe('the notice', () => {
  it('renders an error line as text under the wish and links it to the input', () => {
    setup({ notice: { kind: 'error', text: 'The line to the paw is cut.' } });
    const line = screen.getByText('The line to the paw is cut.');
    expect(wishInput().getAttribute('aria-describedby')).toBe(line.id);
  });

  it('renders an info line', () => {
    setup({ notice: { kind: 'info', text: 'The Judge is resting too.' } });
    expect(screen.getByText('The Judge is resting too.')).toBeTruthy();
  });

  it('keeps an HTML string literal', () => {
    const html = '<img src=x onerror="alert(1)"><b>bold</b>';
    const { container } = setup({ notice: { kind: 'error', text: html } });
    expect(screen.getByText(html)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('shows nothing and describes nothing when there is no notice', () => {
    setup();
    expect(wishInput().getAttribute('aria-describedby')).toBeNull();
  });

  it('puts the blank-wish line before a notice', () => {
    setup({ text: '', notice: { kind: 'error', text: 'The paw stumbles. Try again in a moment.' } });
    fireEvent.click(sealButton());
    expect(screen.getByText(EMPTY_WISH_MESSAGE)).toBeTruthy();
    expect(screen.queryByText('The paw stumbles. Try again in a moment.')).toBeNull();
  });
});

describe('stylesheet', () => {
  const css = parseCss(readText('./WishLine.module.css', import.meta.url));
  const raw = readText('./WishLine.module.css', import.meta.url);

  it('draws horizontal ink rules on the band', () => {
    expect(declarationsFor(css, '.band', null)['background-image']).toContain('repeating-linear-gradient');
  });

  it('keeps every control at 48 px or more', () => {
    for (const selector of ['.wishInput,.contextInput', '.seal', '.disclosure']) {
      const found = css.find((rule) => rule.media === null && rule.selector.replace(/\s+/g, '') === selector);
      const declared = found?.declarations['min-height'] ?? declarationsFor(css, selector, null)['min-height'];
      expect(declared, selector).toBe('3rem');
    }
  });

  it('paints the seal blood red with an ink border and a token focus ring', () => {
    const seal = declarationsFor(css, '.seal', null);
    expect(seal['background']).toBe('var(--blood)');
    expect(seal['border']).toBe('var(--control-border-width) solid var(--control-border-color)');
    expect(raw).toContain('outline: var(--focus-ring-width) solid var(--focus-ring-color)');
  });

  it('puts every :hover rule inside (hover: hover)', () => {
    const hover = css.filter((rule) => rule.selector.includes(':hover'));
    expect(hover.length).toBeGreaterThan(0);
    for (const rule of hover) expect(rule.media).toBe('(hover: hover)');
  });

  it('never sets text below 1rem', () => {
    for (const size of raw.match(/font-size:\s*[^;]+/g) ?? []) {
      expect(Number.parseFloat(size.replace(/font-size:\s*/, ''))).toBeGreaterThanOrEqual(1);
    }
  });
});
