import { BoxGeometry, Mesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { measureBindBounds } from './bind-bounds';

describe('measureBindBounds', () => {
  it('is the union of the geometry boxes, not of anything a pose or a node transform does', () => {
    const scene = new Object3D();
    const a = new Mesh(new BoxGeometry(1, 2, 3).translate(0.5, 1, 0));
    const b = new Mesh(new BoxGeometry(1, 1, 1).translate(2, 0, 0));
    b.position.set(100, 100, 100); // an object transform is not part of the bind box
    scene.add(a, b);
    expect(measureBindBounds(scene)).toEqual({ min: [0, -0.5, -1.5], max: [2.5, 2, 1.5] });
  });

  it('is null for a scene without geometry', () => {
    expect(measureBindBounds(new Object3D())).toBeNull();
  });
});
