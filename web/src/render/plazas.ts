import { Vector4 } from 'three';

/** Authored plaza rectangles (gtasf-7moo) shared by the terrain shader and street-prop dressing.
 *  World metres [minX, minZ, maxX, maxZ]; mapped lawn inside one renders as civic granite paving. */
export const MAX_PLAZAS = 4;
export const PLAZA_UNIFORMS = {
  uPlazas: { value: Array.from({ length: MAX_PLAZAS }, () => new Vector4()) },
  uPlazaCount: { value: 0 },
};
export function registerPlaza(minX: number, minZ: number, maxX: number, maxZ: number): void {
  const count = PLAZA_UNIFORMS.uPlazaCount.value;
  if (count >= MAX_PLAZAS) return;
  PLAZA_UNIFORMS.uPlazas.value[count]!.set(minX, minZ, maxX, maxZ);
  PLAZA_UNIFORMS.uPlazaCount.value = count + 1;
}
