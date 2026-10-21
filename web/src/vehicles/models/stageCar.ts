import { tierForRound } from '@gtasf/shared/content/cosmetics';
import type { FundingRound } from '@gtasf/shared/funding';
import type { VehicleAssetId } from '../../assets/manifest';
import { loadVehicleTemplate, type VehicleTemplate } from './vehicle';

export interface StageCarChoice { readonly assetId: VehicleAssetId; readonly label: string }
export const LEGACY_PERK_CAR: StageCarChoice = { assetId: 'vc-supercar', label: 'VC coupe' };
// Reuse the shipped fleet while the authored SA car replacement is in progress.
// Bootstrapping's scooter is a personal ride, not a car with invisible car-sized collision.
const CARS: Readonly<Record<string, StageCarChoice>> = {
  commuter: { assetId: 'prius', label: 'Hybrid commuter' },
  tesla: { assetId: 'model3', label: 'Electric sedan' },
  sports: { assetId: 'vc-supercar', label: 'Sports coupe' },
  supercar: { assetId: 'vc-supercar', label: 'VC supercar' },
  chauffeur: { assetId: 'model3', label: 'Executive sedan' },
};
export function stageCarForRound(round: Pick<FundingRound, 'id'>): StageCarChoice | null {
  return CARS[tierForRound(round).car] ?? null;
}

/** One owned template. A late stage load cannot replace a newer choice or survive teardown. */
export function createStageCarSlot(options: {
  beforeReplace(): void;
  changed(): void;
  failed(): void;
}, load = loadVehicleTemplate) {
  let current: VehicleTemplate | undefined, target: VehicleAssetId | undefined;
  let generation = 0, busy = false, disposed = false;
  function clear() { options.beforeReplace(); current?.dispose(); current = undefined; }
  return {
    get template() { return current; },
    get busy() { return busy; },
    select(choice: StageCarChoice | null): void {
      if (disposed) return;
      const next = choice?.assetId;
      if (next === target && (busy || current?.assetId === next)) return;
      target = next; const token = ++generation;
      if (!next) { busy = false; clear(); options.changed(); return; }
      busy = true; options.changed();
      void load(next).then(value => {
        if (disposed || token !== generation) { value?.dispose(); return; }
        if (!value) { options.failed(); return; }
        clear(); current = value;
      }).catch(() => { if (!disposed && token === generation) options.failed(); })
        .finally(() => { if (!disposed && token === generation) { busy = false; options.changed(); } });
    },
    destroy(): void { if (disposed) return; disposed = true; generation++; busy = false; clear(); },
  };
}
