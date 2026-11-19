// @vitest-environment jsdom
// LiveRegion: one polite, atomic, visually hidden region. A repeated message must change the DOM text.

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { declarationsFor, parseCss, readText } from '../styles/css-test-support';
import { LIVE_REPEAT_MARK, LiveRegion } from './LiveRegion';

afterEach(cleanup);

const region = (container: HTMLElement): HTMLElement => container.querySelector('[aria-live]') as HTMLElement;
const text = (container: HTMLElement): string => region(container).textContent ?? '';
const plain = (value: string): string => value.split(LIVE_REPEAT_MARK).join('');

describe('LiveRegion', () => {
  it('is exactly one polite, atomic div', () => {
    const { container } = render(<LiveRegion text="" seq={0} />);
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);
    const node = region(container);
    expect(node.tagName).toBe('DIV');
    expect(node.getAttribute('aria-live')).toBe('polite');
    expect(node.getAttribute('aria-atomic')).toBe('true');
    expect(node.hasAttribute('aria-hidden')).toBe(false);
    expect(node.hasAttribute('hidden')).toBe(false);
    expect(node.hasAttribute('role')).toBe(false);
    expect(node.className).toMatch(/visuallyHidden/);
  });

  it('is empty before the first message', () => {
    const { container } = render(<LiveRegion text="" seq={0} />);
    expect(text(container)).toBe('');
  });

  it('shows the live text', () => {
    const { container, rerender } = render(<LiveRegion text="" seq={0} />);
    rerender(<LiveRegion text="Granted. 3 curses arrive." seq={1} />);
    expect(plain(text(container))).toBe('Granted. 3 curses arrive.');
    rerender(<LiveRegion text="The paw rests." seq={2} />);
    expect(plain(text(container))).toBe('The paw rests.');
  });

  it('shows the text as text, never as markup', () => {
    const { container } = render(<LiveRegion text="<b>Granted.</b>" seq={1} />);
    expect(container.querySelector('b')).toBeNull();
    expect(plain(text(container))).toBe('<b>Granted.</b>');
  });

  it('changes the DOM text for a repeated message with a new seq, and alternates', () => {
    const { container, rerender } = render(<LiveRegion text="The line to the paw is cut." seq={1} />);
    const first = text(container);

    rerender(<LiveRegion text="The line to the paw is cut." seq={2} />);
    const second = text(container);
    expect(second).not.toBe(first);
    expect(plain(second)).toBe('The line to the paw is cut.');

    rerender(<LiveRegion text="The line to the paw is cut." seq={3} />);
    const third = text(container);
    expect(third).not.toBe(second);
    expect(plain(third)).toBe('The line to the paw is cut.');
  });

  it('changes the DOM text for every repeat, however many follow', () => {
    const { container, rerender } = render(<LiveRegion text="Same." seq={1} />);
    let previous = text(container);
    for (let seq = 2; seq <= 8; seq += 1) {
      rerender(<LiveRegion text="Same." seq={seq} />);
      expect(text(container)).not.toBe(previous);
      previous = text(container);
    }
  });

  it('also changes the text when seq skips a number', () => {
    const { container, rerender } = render(<LiveRegion text="Same." seq={1} />);
    const before = text(container);
    rerender(<LiveRegion text="Same." seq={3} />);
    expect(text(container)).not.toBe(before);
  });

  it('leaves the text alone when neither text nor seq changed', () => {
    const { container, rerender } = render(<LiveRegion text="Same." seq={1} />);
    rerender(<LiveRegion text="Same." seq={2} />);
    const settled = text(container);
    rerender(<LiveRegion text="Same." seq={2} />);
    expect(text(container)).toBe(settled);
  });

  it('keeps one element through every change', () => {
    const { container, rerender } = render(<LiveRegion text="A" seq={1} />);
    const node = region(container);
    rerender(<LiveRegion text="A" seq={2} />);
    rerender(<LiveRegion text="B" seq={3} />);
    expect(region(container)).toBe(node);
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);
  });

  it('adds nothing visible to an empty message', () => {
    const { container, rerender } = render(<LiveRegion text="" seq={0} />);
    rerender(<LiveRegion text="" seq={1} />);
    expect(text(container)).toBe('');
  });
});

describe('LiveRegion stylesheet', () => {
  const css = parseCss(readText('./LiveRegion.module.css', import.meta.url));

  it('uses the standard visually hidden clip pattern', () => {
    const rule = declarationsFor(css, '.visuallyHidden', null);
    expect(rule['position']).toBe('absolute');
    expect(rule['width']).toBe('1px');
    expect(rule['height']).toBe('1px');
    expect(rule['overflow']).toBe('hidden');
    expect(rule['clip']).toBe('rect(0 0 0 0)');
    expect(rule['clip-path']).toBe('inset(50%)');
    expect(rule['white-space']).toBe('nowrap');
    expect(rule['display']).toBeUndefined();
    expect(rule['visibility']).toBeUndefined();
  });
});
