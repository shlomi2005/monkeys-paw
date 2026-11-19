import { z } from 'zod';
import rawControls from '@paw-asset/runtime-controls.json';
import { JOINT_NAMES } from './digit-joints';
import type { JointName } from './digit-joints';
import type { JointSpec } from './joint-pose';

const Vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const QuatSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

const OperationSchema = z.object({
  name: z.string(),
  axis_joint: Vec3Schema.refine((a) => Math.hypot(a[0], a[1], a[2]) > 1e-6, 'axis must not be zero'),
  max_degrees: z.number().finite(),
});

const JointControlSchema = z.object({
  bind_local_rotation_xyzw: QuatSchema,
  amount_range: z.tuple([z.literal(0), z.literal(1)]),
  operations_after_bind: z.array(OperationSchema),
});

const jointsShape = Object.fromEntries(JOINT_NAMES.map((name) => [name, JointControlSchema])) as Record<
  JointName,
  typeof JointControlSchema
>;

export const RuntimeControlsSchema = z.object({
  source_glb_sha256: z.string().optional(),
  coordinate_system: z.string().optional(),
  composition: z.string().optional(),
  gesture: z.string().optional(),
  rebuild_from_bind: z.boolean().optional(),
  joints: z.object(jointsShape),
});

export type RuntimeControls = z.infer<typeof RuntimeControlsSchema>;

function toSpecs(controls: RuntimeControls): Record<JointName, JointSpec> {
  const specs = {} as Record<JointName, JointSpec>;
  for (const name of JOINT_NAMES) {
    const joint = controls.joints[name];
    specs[name] = {
      bind: joint.bind_local_rotation_xyzw,
      ops: joint.operations_after_bind.map((op) => ({ axis: op.axis_joint, maxDegrees: op.max_degrees })),
    };
  }
  return specs;
}

/** Parsed once at module load. A malformed file throws here, not in the render loop. */
export const PAW_CONTROLS: Readonly<Record<JointName, JointSpec>> = toSpecs(
  RuntimeControlsSchema.parse(rawControls),
);
