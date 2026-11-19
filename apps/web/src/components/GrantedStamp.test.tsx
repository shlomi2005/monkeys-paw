// @vitest-environment jsdom
// GrantedStamp: hidden without a Grant, the stamp plays again for each new grantedSeq, and no animation under reduced
// motion. Plus the stylesheet rules.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { declarationsFor, parseCss, readText } from '../styles/css-test-support';
import { GrantedStamp } from './GrantedStamp';
import { grantOf } from './round-end-test-support';

afterEach(cleanup);

const stampOf = (container: HTMLElement): HTMLElement => container.querySelector('[data-stamp]') as HTMLElement;

describe('GrantedStamp', () => {
  it('renders nothing without a Grant', () => {
    const { container } = render(<GrantedStamp grant={null} grantedSeq={0} reducedMotion={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the red stamp and the narration as a caption', () => {
    const grant = grantOf(3);
    const { container } = render(<GrantedStamp grant={grant} grantedSeq={1} reducedMotion={false} />);
    expect(stampOf(container).textContent).toBe('Granted.');
    expect(screen.getByText(grant.narration)).toBeTruthy();
  });

  it('hides the stamp text from assistive technology and keeps the narration readable', () => {
    const grant = grantOf(3);
    const { container } = render(<GrantedStamp grant={grant} grantedSeq={1} reducedMotion={false} />);
    expect(stampOf(container).getAttribute('aria-hidden')).toBe('true');
    const caption = screen.getByText(grant.narration);
    expect(caption.closest('[aria-hidden="true"]')).toBeNull();
    expect(container.querySelector('[aria-live], [role]')).toBeNull();
    expect(container.querySelector('a, button, input, select, textarea, [tabindex]')).toBeNull();
  });

  it('shows the narration as text, never as markup', () => {
    const grant = { ...grantOf(3), narration: '<b>Granted</b> <img src=x onerror=alert(1)>' };
    const { container } = render(<GrantedStamp grant={grant} grantedSeq={1} reducedMotion={false} />);
    expect(container.querySelector('b, img')).toBeNull();
    expect(screen.getByText(grant.narration)).toBeTruthy();
  });

  it('keeps the same stamp element while grantedSeq is unchanged', () => {
    const grant = grantOf(3);
    const { container, rerender } = render(<GrantedStamp grant={grant} grantedSeq={1} reducedMotion={false} />);
    const before = stampOf(container);
    rerender(<GrantedStamp grant={{ ...grant }} grantedSeq={1} reducedMotion={false} />);
    expect(stampOf(container)).toBe(before);
  });

  it('makes a new stamp element, so the animation replays, whenever grantedSeq changes', () => {
    const grant = grantOf(3);
    const { container, rerender } = render(<GrantedStamp grant={grant} grantedSeq={1} reducedMotion={false} />);
    const first = stampOf(container);
    rerender(<GrantedStamp grant={grantOf(4)} grantedSeq={2} reducedMotion={false} />);
    const second = stampOf(container);
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
    expect(second.dataset['stampSeq']).toBe('2');
    expect(second.className).toMatch(/animate/);
  });

  it('plays the animation class when motion is allowed', () => {
    const { container } = render(<GrantedStamp grant={grantOf(3)} grantedSeq={1} reducedMotion={false} />);
    expect(stampOf(container).className).toMatch(/animate/);
    expect(container.querySelector('[data-granted-stamp]')?.className).not.toMatch(/reduced/);
  });

  it('has no animation class under reduced motion, also when the stamp replays', () => {
    const { container, rerender } = render(<GrantedStamp grant={grantOf(3)} grantedSeq={1} reducedMotion />);
    expect(stampOf(container).className).not.toMatch(/animate/);
    expect(container.querySelector('[data-granted-stamp]')?.className).toMatch(/reduced/);
    expect(stampOf(container).textContent).toBe('Granted.');

    rerender(<GrantedStamp grant={grantOf(3)} grantedSeq={2} reducedMotion />);
    expect(stampOf(container).className).not.toMatch(/animate/);
    expect(stampOf(container).dataset['stampSeq']).toBe('2');
  });

  it('follows the reduced-motion prop when it changes', () => {
    const grant = grantOf(3);
    const { container, rerender } = render(<GrantedStamp grant={grant} grantedSeq={1} reducedMotion={false} />);
    rerender(<GrantedStamp grant={grant} grantedSeq={1} reducedMotion />);
    expect(stampOf(container).className).not.toMatch(/animate/);
  });

  it('disappears when the Grant is gone', () => {
    const { container, rerender } = render(<GrantedStamp grant={grantOf(3)} grantedSeq={1} reducedMotion={false} />);
    rerender(<GrantedStamp grant={null} grantedSeq={1} reducedMotion={false} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('GrantedStamp stylesheet', () => {
  const raw = readText('./GrantedStamp.module.css', import.meta.url);
  const css = parseCss(raw);

  it('stamps in blood red in the display font', () => {
    const stamp = declarationsFor(css, '.stamp', null);
    expect(stamp['color']).toBe('var(--blood)');
    expect(stamp['font-family']).toBe('var(--font-display)');
  });

  it('presses with the seal duration token and stays out of the way of reduced motion', () => {
    expect(declarationsFor(css, '.animate', null)['animation-duration']).toBe('var(--dur-seal)');
    expect(raw).not.toMatch(/animation-duration:\s*\d/);
    expect(declarationsFor(css, '.reduced .stamp', null)['animation']).toBe('none');
    expect(declarationsFor(css, '.stamp', '(prefers-reduced-motion: reduce)')['animation']).toBe('none');
  });

  it('animates transform and opacity only', () => {
    const keyframes = raw.slice(raw.indexOf('@keyframes'), raw.indexOf('.reduced'));
    const properties = [...keyframes.matchAll(/^\s+([a-z-]+):/gm)].map((m) => m[1]);
    expect(properties.length).toBeGreaterThan(0);
    for (const property of properties) expect(['opacity', 'transform']).toContain(property);
  });

  it('never sets text below 1rem', () => {
    const sizes = raw.match(/font-size:\s*[^;]+/g) ?? [];
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size).toMatch(/rem\s*$/);
      expect(Number.parseFloat(size.replace(/font-size:\s*/, ''))).toBeGreaterThanOrEqual(1);
    }
  });

  it('has no control, so no :hover rule', () => {
    expect(raw).not.toContain(':hover');
  });
});
