// Graphics v2 facade atlas, step 1 (docs/engineering/facade-atlas.md, owner Claude 0.2): generate ORIGINAL
// orthographic SF front elevations with fal (our own art only; never copied from other projects). Cached
// under tools/assets/cache/facades-v2/ and logged in tools/art/ledger.json by the shared fal client (cap
// enforced there; this batch stays under $10). Run: node tools/art/facade-atlas.mjs [style ...] [--only id]
import { createFalClient } from './fal.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const COMMON = 'rectified architectural facade texture, a perfectly flat straight-on orthographic elevation of ONE building front, '
  + 'the facade fills 100% of the image: cropped exactly at the building side edges, the roofline cornice touches the very top edge, '
  + 'the ground floor touches the very bottom edge, no sky, no neighbouring buildings, no sidewalk, no street, no trees, no people, no cars, '
  + 'no text, no signs, no logos, flat even overcast light, sharp realistic materials';
/** Style specs: true size in metres (width × height of the whole front), floors, and prompt variations. */
export const STYLES = {
  vic: { count: 16, width: 7.6, height: 11.5, floors: 3, size: { width: 576, height: 864 },
    base: 'San Francisco Victorian Italianate row house, three storeys, angled bay windows, ornate wooden trim, tall narrow sash windows, decorative bracketed cornice at the roofline, front door with stairs at street level',
    paints: ['pale cream body with white trim', 'soft sage green body with cream trim', 'dusty blue body with white trim', 'butter yellow body with white trim', 'pale lilac body with white trim', 'peach body with cream trim', 'light grey body with navy trim', 'mint body with white trim'] },
  edw: { count: 16, width: 7.6, height: 11, floors: 3, size: { width: 576, height: 864 },
    base: 'San Francisco Edwardian flat-front row house, three storeys, rounded bay windows, simpler classical trim, stucco and wood, flat cornice at the roofline, garage door and entry at street level',
    paints: ['off-white stucco', 'pale beige stucco', 'light terracotta stucco', 'soft grey stucco', 'pale pistachio stucco', 'warm sand stucco', 'pale pink stucco', 'light blue-grey stucco'] },
  shop: { count: 16, width: 7.6, height: 11, floors: 3, size: { width: 576, height: 864 },
    base: 'San Francisco mixed-use building, ground-floor shopfront with large display windows, recessed glass door and a striped fabric awning without lettering, two residential storeys above with sash windows and a modest cornice',
    paints: ['cream stucco upper floors, dark green shopfront', 'brick red upper floors, black shopfront', 'pale yellow upper floors, wooden shopfront', 'white upper floors, navy shopfront', 'tan upper floors, burgundy shopfront', 'grey upper floors, teal shopfront', 'salmon upper floors, black shopfront', 'beige upper floors, brown shopfront'] },
  office: { count: 16, width: 30, height: 36, floors: 10, size: { width: 768, height: 896 },
    base: 'downtown San Francisco Financial District mid-rise office building, ten storeys, regular grid of windows, stone or concrete facade, heavy cornice at the top, lobby with glass doors at street level',
    paints: ['beige limestone', 'grey granite', 'buff terracotta', 'pale concrete', 'red brick with stone trim', 'white glazed terracotta', 'dark granite base with light stone above', 'sandstone'] },
  mix: { count: 16, width: 15, height: 14, floors: 4, size: { width: 768, height: 720 },
    base: 'San Francisco 1920s mixed-use corner building, four storeys, two ground-floor shopfronts with display windows and plain awnings, three floors of apartments above with paired sash windows and fire escapes, decorative parapet at the roofline',
    paints: ['cream stucco', 'pale ochre stucco', 'light grey stucco', 'soft pink stucco', 'buff brick', 'white stucco with green trim', 'tan stucco', 'pale blue stucco'] },
  brk: { count: 16, width: 15, height: 14, floors: 4, size: { width: 768, height: 720 },
    base: 'San Francisco early 1900s red brick commercial loft building, four storeys, large arched and rectangular windows in a regular grid, stone sills and lintels, corbelled brick cornice at the roofline, wide ground floor openings',
    paints: ['red brick', 'dark brown brick', 'orange brick', 'painted cream brick', 'weathered red brick', 'painted grey brick', 'buff brick', 'deep red brick with black window frames'] },
  apt: { count: 16, width: 15, height: 17, floors: 5, size: { width: 768, height: 864 },
    base: 'San Francisco 1920s apartment building, five storeys, symmetrical facade with stacked bay windows, central entrance with a decorative surround, flat roof with a simple parapet, Spanish or classical revival details',
    paints: ['white stucco', 'cream stucco', 'pale yellow stucco', 'light pink stucco', 'pale green stucco', 'beige stucco', 'light grey stucco', 'peach stucco'] },
  tower: { count: 8, width: 36, height: 72, floors: 20, size: { width: 512, height: 1024 }, rev: 'p3',
    base: 'perfectly flat frontal curtain wall of a downtown San Francisco glass office high-rise, twenty storeys, a regular grid of glass panels and slim mullions edge to edge, glazed lobby at the bottom, the glass shows only soft even sky reflection, no reflected buildings, no trees, no cars, no perspective, no building edges visible',
    paints: ['blue-green reflective glass', 'dark smoked glass', 'silver glass with white mullions', 'bronze tinted glass', 'pale blue glass with grey spandrels', 'black glass with aluminium fins', 'green glass', 'grey glass with stone piers'] },
};

export function cells(styles = Object.keys(STYLES)) {
  return styles.flatMap(style => Array.from({ length: STYLES[style].count }, (_, i) => {
    const spec = STYLES[style], paint = spec.paints[i % spec.paints.length];
    const id = `${style}-${String(i).padStart(2, '0')}`;
    return { id, style, seed: 7300 + Object.keys(STYLES).indexOf(style) * 100 + i,
      prompt: `${COMMON}. ${spec.base}, ${paint}${i >= spec.paints.length ? ', slightly weathered, different window arrangement' : ''}.`,
      output: `tools/assets/cache/facades-v2/${STYLES[style].rev ?? 'p2'}/${id}.png`, size: spec.size };
  }));
}

// Exact entry check: importing this module (e.g. from pack-facade-atlas.mjs) must never start paid generation.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const styles = args.filter(a => a in STYLES);
  const fal = createFalClient();
  for (const cell of cells(styles.length ? styles : undefined)) {
    if (only && cell.id !== only) continue;
    const entry = await fal.run({ model: 'fal-ai/flux/dev', estimatedUsd: 0.03, output: cell.output,
      input: { prompt: cell.prompt, image_size: cell.size, seed: cell.seed, num_inference_steps: 28, guidance_scale: 3.5, num_images: 1, output_format: 'png', enable_safety_checker: true } });
    console.log(cell.id, entry.status, entry.bytes);
  }
  console.log(JSON.stringify((({ capUsd, reservedUsd, remainingUsd }) => ({ capUsd, reservedUsd, remainingUsd }))(await fal.budget())));
}
