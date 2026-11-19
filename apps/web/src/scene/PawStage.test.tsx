// @vitest-environment jsdom
// PawStage and PawPoster: the 1:1 box keeps its size class and the shared size property, the poster has explicit
// dimensions, no alt text and aria-hidden, and the canvas slot sits over it. No canvas and no three import.

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { declarationsFor, parseCss, readText } from '../styles/css-test-support';
import { PawPoster, POSTER_SIZE, posterSrc } from './PawPoster';
import { PawStage } from './PawStage';

afterEach(cleanup);

const stageCss = parseCss(readText('./PawStage.module.css', import.meta.url));
const posterCss = parseCss(readText('./PawPoster.module.css', import.meta.url));
const stageSource = readText('./PawStage.tsx', import.meta.url) + readText('./PawPoster.tsx', import.meta.url);

describe('PawStage', () => {
  it('renders one box with its size class, and keeps the class when a className is added', () => {
    const { container, rerender } = render(<PawStage />);
    const box = container.querySelector<HTMLElement>('[data-paw-stage]');
    expect(box).not.toBeNull();
    expect(box?.className).toMatch(/box/);
    rerender(<PawStage className="extra" />);
    expect(container.querySelector('[data-paw-stage]')?.className).toMatch(/box/);
    expect(container.querySelector('[data-paw-stage]')?.className).toMatch(/extra/);
  });

  it('sizes the box from --paw-size as a 1:1 positioned box', () => {
    const box = declarationsFor(stageCss, '.box', null);
    expect(box['width']).toBe('var(--paw-size)');
    expect(box['aspect-ratio']).toBe('1 / 1');
    expect(box['position']).toBe('relative');
  });

  it('defines no size of its own: the 150 to 200 px and 300 to 400 px clamps live in tokens.css only', () => {
    const css = readText('./PawStage.module.css', import.meta.url);
    expect(css).not.toMatch(/clamp\(/);
    expect(css).not.toMatch(/--paw-size\s*:/);
  });

  it('holds the poster and an empty canvas slot, absolutely positioned over it', () => {
    const { container } = render(<PawStage />);
    const slot = container.querySelector<HTMLElement>('[data-canvas-slot]');
    expect(slot).not.toBeNull();
    expect(slot?.childElementCount).toBe(0);
    expect(slot?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[data-paw-stage] > img')).not.toBeNull();
    const rule = declarationsFor(stageCss, '.canvasSlot', null);
    expect(rule['position']).toBe('absolute');
    expect(rule['inset']).toBe('0');
    expect(rule['pointer-events']).toBe('none');
  });

  it('renders its children in the canvas slot, after the poster', () => {
    const { container } = render(
      <PawStage>
        <div data-testid="later-canvas" />
      </PawStage>,
    );
    const slot = container.querySelector('[data-canvas-slot]');
    expect(slot?.querySelector('[data-testid="later-canvas"]')).not.toBeNull();
    const kids = [...(container.querySelector('[data-paw-stage]')?.children ?? [])];
    expect(kids[0]?.tagName).toBe('IMG');
    expect(kids[1]).toBe(slot);
  });

  it('contains no canvas element and imports no three', () => {
    const { container } = render(<PawStage />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(stageSource).not.toMatch(/from\s+['"](three|@react-three)/);
  });

  it('passes posterHidden to the poster', () => {
    const { container, rerender } = render(<PawStage />);
    expect(container.querySelector('img')?.className).not.toMatch(/hidden/);
    rerender(<PawStage posterHidden />);
    expect(container.querySelector('img')?.className).toMatch(/hidden/);
  });
});

describe('PawPoster', () => {
  it('is the poster image with explicit width and height, no alt text and aria-hidden', () => {
    const { container } = render(<PawPoster />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(`${import.meta.env.BASE_URL}paw/paw-poster.jpg`);
    expect(img?.getAttribute('width')).toBe(String(POSTER_SIZE));
    expect(img?.getAttribute('height')).toBe(String(POSTER_SIZE));
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses the same 1080 px size as the static shell in index.html', () => {
    const html = readText('../../index.html', import.meta.url);
    expect(html).toContain(`width="${POSTER_SIZE}"`);
    expect(html).toContain(`height="${POSTER_SIZE}"`);
  });

  it('respects the Vite base URL', () => {
    expect(posterSrc('/')).toBe('/paw/paw-poster.jpg');
    expect(posterSrc('/monkeys-paw/')).toBe('/monkeys-paw/paw/paw-poster.jpg');
  });

  it('fills the box and hides with visibility, so the box keeps its size', () => {
    const poster = declarationsFor(posterCss, '.poster', null);
    expect(poster['width']).toBe('100%');
    expect(poster['height']).toBe('100%');
    expect(declarationsFor(posterCss, '.hidden', null)['visibility']).toBe('hidden');
  });

  it('is visible by default and gets the hidden class with the hidden prop', () => {
    const { container, rerender } = render(<PawPoster />);
    expect(container.querySelector('img')?.className).not.toMatch(/hidden/);
    rerender(<PawPoster hidden />);
    expect(container.querySelector('img')?.className).toMatch(/hidden/);
  });

  it('is not focusable and has no accessible name', () => {
    const { container } = render(<PawPoster />);
    const img = container.querySelector('img');
    expect(img?.hasAttribute('tabindex')).toBe(false);
    expect(img?.getAttribute('alt')).toBe('');
  });
});
