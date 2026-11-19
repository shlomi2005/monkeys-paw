import type { ReactNode, Ref } from 'react';
import type { Group } from 'three';

export interface RestGroupProps {
  readonly ref?: Ref<Group>;
  readonly children?: ReactNode;
}

/**
 * The model root group. The joint driver writes the rest sink (`position.y`) and tilt (`rotation.x`) here and the
 * granting twitch writes `rotation.z`, so the GLB's own nodes keep their bind transforms (Req 6.1). Its origin is
 * the wrist, so the tilt and the twitch turn the paw about the wrist.
 */
export function RestGroup({ ref, children }: RestGroupProps) {
  return (
    <group ref={ref} name="paw-rest-group">
      {children}
    </group>
  );
}
