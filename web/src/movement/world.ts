/** Metres, +Z forward. The map owns road/terrain choice and real footprint collisions. */
export interface MovementWorld {
  heightAt(x: number, z: number): number | null;
  collidesCircle?(x: number, z: number, radius: number): boolean;
}
export interface GroundPose { x: number; y: number; z: number; yaw: number }

export function availableHeight(world: MovementWorld, x: number, z: number, radius: number): number | null {
  const height = world.heightAt(x, z);
  if (height === null || !Number.isFinite(height) || world.collidesCircle?.(x, z, radius)) return null;
  return height;
}

/** Bounded substeps prevent tunnelling. Sliding is useful for people, disabled for cars. */
export function moveOnGround(pose: GroundPose, dx: number, dz: number, world: MovementWorld, radius: number, slide: boolean): boolean {
  const distance = Math.hypot(dx, dz), steps = Math.max(1, Math.ceil(distance / Math.max(.1, radius * .5)));
  const sx = dx / steps, sz = dz / steps;
  let blocked = false;
  const canStep = (x: number, z: number): number | null => {
    const height = availableHeight(world, x, z, radius);
    // Permit real SF grades and kerbs, but never snap down a cliff/through unloaded terrain.
    return height !== null && Math.abs(height - pose.y) <= .35 + Math.hypot(x - pose.x, z - pose.z) * 1.25 ? height : null;
  };
  for (let i = 0; i < steps; i++) {
    const x = pose.x + sx, z = pose.z + sz;
    let height = canStep(x, z);
    if (height !== null) { pose.x = x; pose.z = z; pose.y = height; continue; }
    blocked = true;
    if (!slide) break;
    height = canStep(x, pose.z);
    if (height !== null) { pose.x = x; pose.y = height; }
    height = canStep(pose.x, z);
    if (height !== null) { pose.z = z; pose.y = height; }
  }
  return !blocked;
}
