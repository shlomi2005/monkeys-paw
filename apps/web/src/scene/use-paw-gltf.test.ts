import { beforeEach, describe, expect, it, vi } from 'vitest';

const useGLTF = vi.hoisted(() => vi.fn(() => ({ scene: {} })));
vi.mock('@react-three/drei', () => ({ useGLTF }));

import { usePawGltf } from './use-paw-gltf';

beforeEach(() => {
  useGLTF.mockClear();
});

describe('usePawGltf', () => {
  it('switches Draco and meshopt off, so no loader is pointed at the default third-party decoder CDN', () => {
    usePawGltf('/paw/paw-web.glb');
    expect(useGLTF).toHaveBeenCalledTimes(1);
    expect(useGLTF).toHaveBeenCalledWith('/paw/paw-web.glb', false, false);
  });

  it('passes the URL through unchanged, and never a decoder path or an extendLoader', () => {
    usePawGltf('/base/paw/paw-mobile.glb');
    const args = (useGLTF.mock.calls[0] ?? []) as unknown[];
    expect(args).toEqual(['/base/paw/paw-mobile.glb', false, false]);
  });
});
