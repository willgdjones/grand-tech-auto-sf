import { SUPPORTED_ASPECT, SUPPORTED_VFOV_DEG } from '@gtasf/shared/constants';
import { renderChannel } from '../render/events';

export type CameraMode = 'THIRD_PERSON' | 'DRONE' | 'GLIDE' | 'BUY';
export type CameraJumpReason = 'glide' | 'flyTo' | 'mapToggle' | 'deepLink' | 'spectatorSwitch';
const changes = renderChannel<CameraMode>(),
  jumps = renderChannel<CameraJumpReason>();
let mode: CameraMode = 'THIRD_PERSON';
export const cameraMode = (): CameraMode => mode;
export const onCameraModeChange = (listener: (mode: CameraMode) => void) => changes.on(listener);
export const onCameraJump = (listener: (reason: CameraJumpReason) => void) => jumps.on(listener);
export function setCameraMode(next: CameraMode): void {
  if (!['THIRD_PERSON', 'DRONE', 'GLIDE', 'BUY'].includes(next)) throw new RangeError('CAMERA_MODE');
  if (mode === next) return;
  mode = next;
  changes.emit(next);
}
export function emitCameraJump(reason: CameraJumpReason): void {
  jumps.emit(reason);
}
/** Vertical FOV in degrees. Zoom never enters this rule. */
export function vFovForAspect(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new RangeError('CAMERA_ASPECT');
  return Math.min(
    SUPPORTED_VFOV_DEG.max,
    Math.max(60, (2 * Math.atan(Math.tan((19 * Math.PI) / 180) / aspect) * 180) / Math.PI),
  );
}
/** Consumers share the protocol's projection window rather than maintaining separate thresholds. */
export function cameraProjectionEligible(aspect: number, verticalFov?: number): boolean {
  if (
    mode !== 'THIRD_PERSON' ||
    !Number.isFinite(aspect) ||
    aspect < SUPPORTED_ASPECT.min ||
    aspect > SUPPORTED_ASPECT.max
  )
    return false;
  const fov = verticalFov ?? vFovForAspect(aspect);
  return Number.isFinite(fov) && fov >= SUPPORTED_VFOV_DEG.min && fov <= SUPPORTED_VFOV_DEG.max;
}
