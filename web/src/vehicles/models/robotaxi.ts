import { loadVehicleTemplate } from './vehicle';

/** Generic white CC0 taxi with animated roof lidar; contains no real operator branding. */
export function loadRobotaxiTemplate() {
  return loadVehicleTemplate('robotaxi');
}
