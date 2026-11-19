import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { PawLights } from './PawLights';

interface Found {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

function flatten(node: ReactNode): Found[] {
  const out: Found[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<Record<string, unknown>>;
    out.push({ type: element.type, props: element.props });
    out.push(...flatten(element.props.children as ReactNode));
  });
  return out;
}

describe('PawLights', () => {
  // Skip the root fragment; keep the three.js host elements.
  const elements = flatten(PawLights()).filter((e) => typeof e.type === 'string');

  it('renders only the ambient, key and rim lights', () => {
    expect(elements.map((e) => e.type)).toEqual(['ambientLight', 'directionalLight', 'directionalLight']);
  });

  it('has no shadow catcher and no shadow-casting light (the engraving has no cast shadow)', () => {
    for (const element of elements) {
      expect(element.type).not.toBe('mesh');
      expect(element.type).not.toBe('shadowMaterial');
      expect(element.props.castShadow).toBeUndefined();
      expect(element.props.receiveShadow).toBeUndefined();
    }
  });
});
