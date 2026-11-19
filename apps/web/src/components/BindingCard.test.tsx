// @vitest-environment jsdom
// BindingCard: dialog wiring, the editable clause, the three buttons, the judging, remembers and resting states, and
// the stylesheet. jsdom has no showModal, so focus trap and focus restore are left to Playwright (task 32).

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Curse } from 'paw-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_CLAUSE_MESSAGE,
  JUDGE_RESTING_MESSAGE,
  JUDGE_STIRS_MESSAGE,
  PAW_REMEMBERS_MESSAGE,
} from '../api/api-messages';
import type { CardView } from '../state/paw-selectors';
import { declarationsFor, parseCss, readText } from '../styles/css-test-support';
import type { BindingCardProps } from './BindingCard';
import { BindingCard } from './BindingCard';
import { suggestClause } from './suggest-clause';

afterEach(cleanup);

const CURSE: Curse = {
  id: 'c1',
  type: 'permissions',
  story: 'The owner quits. Nobody may delete it.',
  loophole: 'Only the owner can delete a project',
  status: 'open',
};

const OTHER_CURSE: Curse = {
  id: 'c2',
  type: 'data-loss',
  story: 'Deletion has no undo.',
  loophole: 'delete',
  status: 'open',
};

function cardOf(overrides: Partial<CardView> = {}): CardView {
  return { curse: CURSE, remembers: false, judging: false, ...overrides };
}

function propsOf(overrides: Partial<BindingCardProps> = {}): BindingCardProps {
  return {
    card: cardOf(),
    judgeResting: false,
    notice: null,
    onAccept: vi.fn(),
    onRewrite: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

function setup(overrides: Partial<BindingCardProps> = {}) {
  const props = propsOf(overrides);
  const view = render(<BindingCard {...props} />);
  return { props, ...view };
}

// A closed <dialog> is not in the accessibility tree, so queries by role need the open attribute set first.
const dialog = (container: HTMLElement): HTMLDialogElement => container.querySelector('dialog') as HTMLDialogElement;
const clauseBox = (): HTMLTextAreaElement => screen.getByLabelText('Your clause (EARS)') as HTMLTextAreaElement;
const accept = (): HTMLButtonElement => screen.getByRole('button', { name: 'Accept this clause' }) as HTMLButtonElement;
const rewrite = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Rewrite the whole wish' }) as HTMLButtonElement;
const cancel = (): HTMLButtonElement => screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;

/** Fires a cancelable `cancel` event the way the browser does for Escape. Returns the event. */
function pressEscape(target: HTMLDialogElement): Event {
  const event = new Event('cancel', { cancelable: true });
  fireEvent(target, event);
  return event;
}

describe('opening and closing', () => {
  it('renders nothing open and no content when card is null', () => {
    const { container } = setup({ card: null });
    expect(dialog(container).open).toBe(false);
    expect(dialog(container).hasAttribute('open')).toBe(false);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    expect(dialog(container).hasAttribute('aria-labelledby')).toBe(false);
  });

  it('opens when card becomes non-null and closes when it becomes null', () => {
    const { container, rerender, props } = setup({ card: null });
    rerender(<BindingCard {...props} card={cardOf()} />);
    expect(dialog(container).hasAttribute('open')).toBe(true);
    expect(clauseBox()).toBeTruthy();
    rerender(<BindingCard {...props} card={null} />);
    expect(dialog(container).hasAttribute('open')).toBe(false);
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('uses showModal and close where the browser has them', () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    const close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close });
    try {
      const { rerender, props } = setup({ card: cardOf() });
      expect(showModal).toHaveBeenCalledTimes(1);
      rerender(<BindingCard {...props} card={null} />);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
      Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
    }
  });

  it('puts initial focus on the clause', () => {
    setup();
    expect(document.activeElement).toBe(clauseBox());
  });
});

describe('structure', () => {
  it('names the dialog by the curse type heading and describes it by story and loophole', () => {
    const { container } = setup();
    const node = dialog(container);
    const heading = screen.getByRole('heading', { name: 'Permissions' });
    expect(node.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(screen.getByRole('dialog', { name: 'Permissions' })).toBe(node);
    const describedBy = document.getElementById(node.getAttribute('aria-describedby') ?? '');
    expect(describedBy).not.toBeNull();
    expect(describedBy?.textContent).toContain(CURSE.story);
    expect(describedBy?.textContent).toContain(CURSE.loophole);
    expect(screen.getByRole('dialog', { description: new RegExp(CURSE.story.slice(0, 12)) })).toBe(node);
  });

  it('shows the story, and the loophole as a quote', () => {
    const { container } = setup();
    expect(screen.getByText(CURSE.story)).toBeTruthy();
    const quote = container.querySelector('blockquote');
    expect(quote?.textContent).toBe(CURSE.loophole);
  });

  it('uses the label of the curse type in the heading', () => {
    setup({ card: cardOf({ curse: OTHER_CURSE }) });
    expect(screen.getByRole('heading', { name: 'Data loss' })).toBeTruthy();
  });

  it('pre-fills the clause with the suggested EARS clause behind a visible label', () => {
    setup();
    expect(clauseBox().value).toBe(suggestClause(CURSE));
    expect(clauseBox().value).toMatch(/^(IF|WHEN|WHILE|WHERE) /);
    const label = document.querySelector(`label[for="${clauseBox().id}"]`);
    expect(label?.textContent).toBe('Your clause (EARS)');
  });

  it('orders the controls: clause, Accept, Rewrite, Cancel', () => {
    const { container } = setup();
    const order = Array.from(container.querySelectorAll('textarea, button')).map(
      (el) => el.tagName.toLowerCase() + ':' + (el.textContent ?? ''),
    );
    expect(order).toEqual([
      expect.stringMatching(/^textarea:/),
      'button:Accept this clause',
      'button:Rewrite the whole wish',
      'button:Cancel',
    ]);
    expect(container.querySelectorAll('[tabindex]')).toHaveLength(0);
  });

  it('has plain buttons that do not submit anything', () => {
    setup();
    for (const button of [accept(), rewrite(), cancel()]) expect(button.type).toBe('button');
  });
});

describe('clause editing', () => {
  it('keeps the user edit while the same curse stays open, also after a not-closed verdict', () => {
    const { rerender, props } = setup();
    fireEvent.change(clauseBox(), { target: { value: 'WHEN the owner leaves, THE SYSTEM SHALL ask an admin.' } });
    rerender(<BindingCard {...props} card={cardOf({ judging: true })} />);
    expect(clauseBox().value).toBe('WHEN the owner leaves, THE SYSTEM SHALL ask an admin.');
    rerender(<BindingCard {...props} card={cardOf({ remembers: true })} />);
    expect(clauseBox().value).toBe('WHEN the owner leaves, THE SYSTEM SHALL ask an admin.');
  });

  it('re-seeds the clause when a different curse opens', () => {
    const { rerender, props } = setup();
    fireEvent.change(clauseBox(), { target: { value: 'my edit' } });
    rerender(<BindingCard {...props} card={cardOf({ curse: OTHER_CURSE })} />);
    expect(clauseBox().value).toBe(suggestClause(OTHER_CURSE));
  });
});

describe('accept', () => {
  it('calls onAccept with the clause', () => {
    const { props } = setup();
    fireEvent.change(clauseBox(), { target: { value: '  WHEN the owner leaves, THE SYSTEM SHALL ask an admin.  ' } });
    fireEvent.click(accept());
    expect(props.onAccept).toHaveBeenCalledTimes(1);
    expect(props.onAccept).toHaveBeenCalledWith('WHEN the owner leaves, THE SYSTEM SHALL ask an admin.');
    expect(props.onRewrite).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('sends the suggested clause as it is when the user changes nothing', () => {
    const { props } = setup();
    fireEvent.click(accept());
    expect(props.onAccept).toHaveBeenCalledWith(suggestClause(CURSE));
  });

  it('shows an in-character line for a blank clause and calls nothing', () => {
    const { props } = setup();
    expect(screen.queryByText(EMPTY_CLAUSE_MESSAGE)).toBeNull();
    fireEvent.change(clauseBox(), { target: { value: '   \n ' } });
    fireEvent.click(accept());
    expect(props.onAccept).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(EMPTY_CLAUSE_MESSAGE);
    expect(clauseBox().getAttribute('aria-invalid')).toBe('true');
  });

  it('clears the blank line once the user types again', () => {
    setup();
    fireEvent.change(clauseBox(), { target: { value: '' } });
    fireEvent.click(accept());
    expect(screen.getByText(EMPTY_CLAUSE_MESSAGE)).toBeTruthy();
    fireEvent.change(clauseBox(), { target: { value: 'IF x, THEN THE SYSTEM SHALL y.' } });
    expect(screen.queryByText(EMPTY_CLAUSE_MESSAGE)).toBeNull();
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
  ])('accepts on %s+Enter in the clause', (_name, modifier) => {
    const { props } = setup();
    fireEvent.keyDown(clauseBox(), { key: 'Enter', ...modifier });
    expect(props.onAccept).toHaveBeenCalledTimes(1);
    expect(props.onAccept).toHaveBeenCalledWith(suggestClause(CURSE));
  });

  it('keeps a plain Enter in the textarea as a new line', () => {
    const { props } = setup();
    const notPrevented = fireEvent.keyDown(clauseBox(), { key: 'Enter' });
    expect(notPrevented).toBe(true);
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  it('does not accept on Ctrl+Enter with a blank clause', () => {
    const { props } = setup();
    fireEvent.change(clauseBox(), { target: { value: '' } });
    fireEvent.keyDown(clauseBox(), { key: 'Enter', ctrlKey: true });
    expect(props.onAccept).not.toHaveBeenCalled();
    expect(screen.getByText(EMPTY_CLAUSE_MESSAGE)).toBeTruthy();
  });
});

describe('rewrite and cancel', () => {
  it('calls onRewrite', () => {
    const { props } = setup();
    fireEvent.click(rewrite());
    expect(props.onRewrite).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  it('calls onCancel from the Cancel button', () => {
    const { props } = setup();
    fireEvent.click(cancel());
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('routes the dialog cancel event (Escape) to onCancel and stops the browser closing it', () => {
    const { container, props } = setup();
    const event = pressEscape(dialog(container));
    expect(event.defaultPrevented).toBe(true);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(dialog(container).hasAttribute('open')).toBe(true);
  });

  it('stays open after Cancel until the parent drops the card', () => {
    const { container } = setup();
    fireEvent.click(cancel());
    expect(dialog(container).hasAttribute('open')).toBe(true);
  });
});

describe('judging', () => {
  const judging = (): CardView => cardOf({ judging: true });

  it('shows "The Judge stirs…" in a polite status line', () => {
    setup({ card: judging() });
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(JUDGE_STIRS_MESSAGE);
    expect(JUDGE_STIRS_MESSAGE).toBe('The Judge stirs…');
  });

  it('keeps the status line empty when the Judge is not working', () => {
    setup();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('marks all three buttons aria-disabled, not disabled, so focus stays', () => {
    setup({ card: judging() });
    for (const button of [accept(), rewrite(), cancel()]) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.disabled).toBe(false);
    }
  });

  it('leaves the buttons enabled when not judging', () => {
    setup();
    for (const button of [accept(), rewrite(), cancel()]) {
      expect(button.getAttribute('aria-disabled')).toBe('false');
    }
  });

  it('ignores clicks on all three buttons', () => {
    const { props } = setup({ card: judging() });
    fireEvent.click(accept());
    fireEvent.click(rewrite());
    fireEvent.click(cancel());
    expect(props.onAccept).not.toHaveBeenCalled();
    expect(props.onRewrite).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('ignores Escape but still keeps the browser from closing the dialog', () => {
    const { container, props } = setup({ card: judging() });
    const event = pressEscape(dialog(container));
    expect(event.defaultPrevented).toBe(true);
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('ignores Ctrl+Enter', () => {
    const { props } = setup({ card: judging() });
    fireEvent.keyDown(clauseBox(), { key: 'Enter', ctrlKey: true });
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  it('makes the clause read-only', () => {
    setup({ card: judging() });
    expect(clauseBox().readOnly).toBe(true);
    expect(clauseBox().value).toBe(suggestClause(CURSE));
  });
});

describe('the paw remembers', () => {
  it('shows the line under the story and keeps the card open', () => {
    const { container } = setup({ card: cardOf({ remembers: true }) });
    const line = screen.getByText(PAW_REMEMBERS_MESSAGE);
    expect(PAW_REMEMBERS_MESSAGE).toBe('The paw remembers.');
    const story = screen.getByText(CURSE.story);
    expect(story.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dialog(container).hasAttribute('open')).toBe(true);
  });

  it('does not show the line otherwise', () => {
    setup();
    expect(screen.queryByText(PAW_REMEMBERS_MESSAGE)).toBeNull();
  });
});

describe('examples-only play', () => {
  it('shows the resting line and disables Accept only', () => {
    setup({ judgeResting: true });
    expect(screen.getByText(JUDGE_RESTING_MESSAGE)).toBeTruthy();
    expect(JUDGE_RESTING_MESSAGE).toBe('The Judge is resting too.');
    expect(accept().getAttribute('aria-disabled')).toBe('true');
    expect(rewrite().getAttribute('aria-disabled')).toBe('false');
    expect(cancel().getAttribute('aria-disabled')).toBe('false');
  });

  it('calls nothing on Accept or Ctrl+Enter, and shows no blank-clause line', () => {
    const { props } = setup({ judgeResting: true });
    fireEvent.click(accept());
    fireEvent.keyDown(clauseBox(), { key: 'Enter', ctrlKey: true });
    fireEvent.change(clauseBox(), { target: { value: '' } });
    fireEvent.click(accept());
    expect(props.onAccept).not.toHaveBeenCalled();
    expect(screen.queryByText(EMPTY_CLAUSE_MESSAGE)).toBeNull();
  });

  it('still lets Rewrite and Cancel work, and Escape close', () => {
    const { container, props } = setup({ judgeResting: true });
    fireEvent.click(rewrite());
    fireEvent.click(cancel());
    pressEscape(dialog(container));
    expect(props.onRewrite).toHaveBeenCalledTimes(1);
    expect(props.onCancel).toHaveBeenCalledTimes(2);
  });

  it('shows the resting line once when the session reports the same line as a notice', () => {
    setup({ judgeResting: true, notice: { kind: 'info', text: JUDGE_RESTING_MESSAGE } });
    expect(screen.getAllByText(JUDGE_RESTING_MESSAGE)).toHaveLength(1);
  });

  it('does not show the resting line in normal play', () => {
    setup();
    expect(screen.queryByText(JUDGE_RESTING_MESSAGE)).toBeNull();
  });
});

describe('notice', () => {
  it('renders the line inside the card', () => {
    const { container } = setup({ notice: { kind: 'error', text: 'The paw stumbles. Try again in a moment.' } });
    const line = screen.getByText('The paw stumbles. Try again in a moment.');
    expect(dialog(container).contains(line)).toBe(true);
    expect(line.getAttribute('role')).toBe('alert');
  });

  it('renders an HTML string as literal text', () => {
    const html = '<img src=x onerror="alert(1)"><b>bold</b>';
    const { container } = setup({ notice: { kind: 'error', text: html } });
    expect(screen.getByText(html)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('renders an info notice without an alert role', () => {
    setup({ notice: { kind: 'info', text: 'A quiet word.' } });
    expect(screen.getByText('A quiet word.').getAttribute('role')).toBeNull();
  });

  it('renders story and loophole as literal text too', () => {
    const curse: Curse = { ...CURSE, story: '<b>story</b>', loophole: '<i>loophole</i>' };
    const { container } = setup({ card: cardOf({ curse }) });
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('i')).toBeNull();
    expect(within(container).getByText('<b>story</b>')).toBeTruthy();
  });
});

describe('stylesheet', () => {
  const raw = readText('./BindingCard.module.css', import.meta.url);
  const css = parseCss(raw);

  it('is a parchment card with an engraved ink border', () => {
    const card = declarationsFor(css, '.card', null);
    expect(card['background']).toContain('var(--parchment)');
    expect(card['border']).toBe('3px solid var(--ink)');
    expect(card['box-shadow']).toContain('inset');
  });

  it('keeps every control at 48 px or more', () => {
    for (const selector of ['.accept,.secondary']) {
      const found = css.find((rule) => rule.media === null && rule.selector.replace(/\s+/g, '') === selector);
      expect(found?.declarations['min-height'], selector).toBe('3rem');
      expect(found?.declarations['min-width'], selector).toBe('48px');
    }
  });

  it('paints Accept blood red with an ink border and gives the controls the token focus ring', () => {
    const accept = declarationsFor(css, '.accept', null);
    expect(accept['background']).toBe('var(--blood)');
    const shared = css.find((rule) => rule.selector.replace(/\s+/g, '') === '.accept,.secondary');
    expect(shared?.declarations['border']).toBe('var(--control-border-width) solid var(--control-border-color)');
    expect(raw).toContain('outline: var(--focus-ring-width) solid var(--focus-ring-color)');
    expect(raw).toContain('outline-offset: var(--focus-ring-offset)');
  });

  it('puts every :hover rule inside (hover: hover)', () => {
    const hover = css.filter((rule) => rule.selector.includes(':hover'));
    expect(hover.length).toBeGreaterThan(0);
    for (const rule of hover) expect(rule.media).toBe('(hover: hover)');
  });

  it('never sets text below 1rem', () => {
    const sizes = raw.match(/font-size:\s*[^;]+/g) ?? [];
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size).toMatch(/rem\s*$/);
      expect(Number.parseFloat(size.replace(/font-size:\s*/, ''))).toBeGreaterThanOrEqual(1);
    }
  });

  it('becomes a full-width bottom sheet of at most 80vh under 768 px', () => {
    const sheet = declarationsFor(css, '.card', '(max-width: 767.98px)');
    expect(sheet['width']).toBe('100%');
    expect(sheet['max-height']).toBe('80vh');
    expect(sheet['overflow-y']).toBe('auto');
    expect(sheet['margin']).toBe('auto 0 0');
    // The centred card has no such 80vh rule outside the media query.
    expect(declarationsFor(css, '.card', null)['max-height']).not.toBe('80vh');
  });

  it('fades in with the reduced-motion duration token', () => {
    const open = declarationsFor(css, '.card[open]', null);
    expect(open['transition']).toContain('var(--dur-fade)');
    expect(raw).not.toMatch(/transition:[^;]*\d+m?s/);
  });
});
