/** World metres: +x east, +y up, -z north. Null means the chunk is not available. */
export interface HeightSampler { heightAt(x: number, z: number): number | null }
export const sampleHeightM = (terrain: HeightSampler, x: number, z: number): number | null => terrain.heightAt(x, z);
