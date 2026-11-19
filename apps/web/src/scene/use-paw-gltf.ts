import { useGLTF } from '@react-three/drei';

/**
 * Loads the paw GLB. Both GLBs list no `extensionsUsed` (glb-extensions.test.ts guards that), so no decoder is
 * needed. Draco and meshopt are switched off, so drei never points a loader at its default third-party CDN.
 * `useGLTF` suspends and caches by URL: one request per URL, however often the component renders.
 */
export function usePawGltf(url: string) {
  return useGLTF(url, false, false);
}
