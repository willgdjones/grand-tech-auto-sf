import { DISTRICT_REGIONS, type FacadeStyle } from '../../../tools/map/src/districts';

// Existing atlas slots differ between the PS2 and PBR render paths. The PS2
// atlas's Edwardian and brick cells are the closest stucco/concrete treatments.
const SLOTS: Record<'ps2' | 'realistic', Record<FacadeStyle, number>> = {
  ps2: { brick: 4, stone: 3, stucco: 1, clapboard: 0, glass: 2, concrete: 4, mural: 5 },
  realistic: { brick: 0, stone: 1, stucco: 2, clapboard: 3, glass: 4, concrete: 5, mural: 7 },
};
const SHOP_DISTRICTS = new Set(['fidi', 'soma', 'moscone']);

/** Compile the same priority-ordered art regions used by the source bake into
 * a shader lookup. No textures, uniforms, downloads or per-frame JS are added.
 * x = atlas slot, y = district-wide shop floors; source retail/office still win.
 */
export function districtFacadeGlsl(path: keyof typeof SLOTS): string {
  const slots = SLOTS[path];
  const regions = DISTRICT_REGIONS.map(({ profile, bounds }) => {
    const [x0, z0, x1, z1] = bounds.map(n => n.toFixed(3));
    const styles = profile.facades.filter(style => style !== 'mural');
    let selection = String(slots[styles.at(-1) ?? 'stucco']);
    for (let i = styles.length - 2; i >= 0; i--) {
      selection = `variant < ${((i + 1) / styles.length).toFixed(6)} ? ${slots[styles[i]!]} : (${selection})`;
    }
    const mural = profile.facades.includes('mural')
      ? `if (groundReady && height >= -0.1 && height < 5.5 && variant < 0.12) style = ${slots.mural};` : '';
    return `  // ${profile.id}
  if (position.x >= ${x0} && position.x <= ${x1} && position.y >= ${z0} && position.y <= ${z1}) {
    int style = ${selection};
    ${mural}
    return ivec2(style, ${SHOP_DISTRICTS.has(profile.id) ? 1 : 0});
  }`;
  });
  return `ivec2 districtFacade(vec2 position, float variant, bool groundReady, float height, int fallback) {
${regions.join('\n')}
  return ivec2(fallback, 0);
}`;
}
