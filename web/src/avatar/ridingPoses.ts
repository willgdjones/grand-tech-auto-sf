import { AnimationClip, AnimationMixer, Bone, Object3D, Quaternion, QuaternionKeyframeTrack, SkinnedMesh, Vector3, VectorKeyframeTrack } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { PersonalRide } from '@gtasf/shared/content/rides';

export type RideAnimation = PersonalRide['id'];
export const rideBodyYaw: Readonly<Record<RideAnimation, number>> = {
  scooter: 0, skateboard: Math.PI / 2, ebike: 0, onewheel: Math.PI / 2, segway: 0,
};
type Point = readonly [number, number, number];
const positions: Readonly<Record<RideAnimation, { deck: number; feet: readonly [Point, Point]; hands: readonly [Point, Point]; hipDrop: number; lean: number }>> = {
  scooter: { deck: .145, feet: [[.025, 0, .16], [-.025, 0, -.16]], hands: [[.19, 1.01, .34], [-.19, 1.01, .34]], hipDrop: .12, lean: .18 },
  skateboard: { deck: .123, feet: [[0, 0, -.25], [0, 0, .25]], hands: [[.12, 1.02, -.4], [.12, 1.02, .4]], hipDrop: .08, lean: .04 },
  ebike: { deck: .24, feet: [[.13, 0, .1], [-.13, 0, -.1]], hands: [[.18, .87, .5], [-.18, .87, .5]], hipDrop: 0, lean: .78 },
  onewheel: { deck: .343, feet: [[0, 0, -.27], [0, 0, .27]], hands: [[.12, 1.23, -.4], [.12, 1.23, .4]], hipDrop: .08, lean: .04 },
  segway: { deck: .205, feet: [[.1, 0, -.07], [-.1, 0, -.07]], hands: [[.17, 1.17, .025], [-.17, 1.17, .025]], hipDrop: .035, lean: .04 },
};

/** Authored poses over the shipped rig. Solve once at template load, never in the frame loop. */
export function createRidingClips(gltf: GLTF, idle: AnimationClip, polished: boolean): AnimationClip[] {
  return (Object.keys(positions) as RideAnimation[]).map(id => {
    const figure = clone(gltf.scene), mixer = new AnimationMixer(figure), pose = positions[id];
    if (polished) figure.scale.set(1.07, 1.04, 1.02);
    figure.rotateY(rideBodyYaw[id]);
    mixer.clipAction(idle).play(); mixer.update(0); figure.updateMatrixWorld(true);
    const bone = (name: string): Object3D => {
      const found = figure.getObjectByName(name);
      if (!found) throw new Error(`Ride pose requires avatar bone ${name}`);
      return found;
    };
    const at = (node: Object3D) => node.getWorldPosition(new Vector3());
    const place = (node: Object3D, world: Vector3) => {
      node.position.copy(node.parent!.worldToLocal(world.clone())); figure.updateMatrixWorld(true);
    };
    const aim = (node: Object3D, child: Object3D, direction: Vector3) => {
      const current = at(child).sub(at(node)).normalize();
      const world = new Quaternion().setFromUnitVectors(current, direction.normalize()).multiply(node.getWorldQuaternion(new Quaternion()));
      node.quaternion.copy(node.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world)).normalize();
      figure.updateMatrixWorld(true);
    };
    const solve = (upper: Object3D, lower: Object3D, end: Object3D, target: Vector3, pole: Vector3) => {
      const start = at(upper), a = start.distanceTo(at(lower)), b = at(lower).distanceTo(at(end));
      const direction = target.clone().sub(start), length = Math.max(.0001, Math.min(a + b - .0001, Math.max(Math.abs(a - b) + .0001, direction.length())));
      direction.normalize();
      const bend = pole.clone().addScaledVector(direction, -pole.dot(direction)).normalize();
      const along = (a * a + length * length - b * b) / (2 * length);
      const joint = start.clone().addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
      aim(upper, lower, joint.sub(start)); aim(lower, end, target.clone().sub(at(lower)));
    };
    // Feet on this rig have independent parents; move them to the solved ankles
    // as well as bending the leg bones, just as the existing seated clip does.
    const ankleHeight = (at(bone('FootL')).y + at(bone('FootR')).y) / 2;
    // The packaged GLB prunes the source rig's unused LowerLeg end bones. Derive
    // their endpoints from the neutral foot anchors before changing the pose.
    const ankles = ['L', 'R'].map(side => {
      const lower = bone(`LowerLeg${side}`), endpoint = new Object3D();
      endpoint.position.copy(lower.worldToLocal(at(bone(`Foot${side}`))));
      lower.add(endpoint); return endpoint;
    });
    figure.updateMatrixWorld(true);
    const body = bone('Body'), hip = at(body);
    hip.y += pose.deck - pose.hipDrop;
    if (id === 'ebike') { hip.y = .77; hip.z = -.28; }
    if (id === 'segway') hip.z -= .07;
    // The idle clip twists Body sideways. Face the ride (boards rotate the
    // complete figure) and lean forward from the hips for a stable riding pose.
    place(body, hip); body.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), pose.lean); figure.updateMatrixWorld(true);
    for (const [index, side] of ['L', 'R'].entries()) {
      const [x, y, z] = pose.feet[index]!, ankle = new Vector3(x, y + ankleHeight + pose.deck, z);
      const pole = rideBodyYaw[id] ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
      solve(bone(`UpperLeg${side}`), bone(`LowerLeg${side}`), ankles[index]!, ankle, pole);
      place(bone(`Foot${side}`), at(ankles[index]!));
      const hand = new Vector3(...pose.hands[index]!);
      solve(bone(`UpperArm${side}`), bone(`LowerArm${side}`), bone(`Wrist${side}`), hand, new Vector3(side === 'L' ? 1 : -1, -.3, -.4));
    }
    const tracks: (VectorKeyframeTrack | QuaternionKeyframeTrack)[] = [];
    const breathe = body.parent!.worldToLocal(at(body).add(new Vector3(0, .004, 0))).sub(body.position);
    figure.traverse(node => {
      if (!(node instanceof Bone)) return;
      const p = node.position.toArray(), q = node.quaternion.normalize().toArray(), middle = node === body ? node.position.clone().add(breathe).toArray() : p;
      tracks.push(new VectorKeyframeTrack(`${node.name}.position`, [0, 1, 2], [...p, ...middle, ...p]));
      tracks.push(new QuaternionKeyframeTrack(`${node.name}.quaternion`, [0, 1, 2], [...q, ...q, ...q]));
    });
    mixer.stopAllAction(); mixer.uncacheRoot(figure);
    figure.traverse(node => { if (node instanceof SkinnedMesh) node.skeleton.dispose(); });
    return new AnimationClip(id, 2, tracks);
  });
}
