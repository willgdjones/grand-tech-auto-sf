/** Run through tools/heavy.sh. Produces an isolated experimental map; never activates or uploads. */
import { resolve } from 'node:path';
import { packMapTransport } from './src/pipeline/transport';

const [source, output, optIn] = process.argv.slice(2);
if (!source || !output || optIn !== '--experimental-compact-map') {
  throw new Error('Usage: tools/heavy.sh npx tsx tools/map/compact-runtime.mts SOURCE NEW_OUTPUT --experimental-compact-map');
}
const manifest = await packMapTransport(resolve(source), resolve(output), { enabled: true,
  meshes: process.argv.includes('--compact-meshes'), collisions: process.argv.includes('--compact-collisions'),
  buildingRecipes: process.argv.includes('--building-recipes'), joinRecipes: process.argv.includes('--join-recipes') });
console.log(JSON.stringify({ output: resolve(output), chunks: manifest.chunks.length, mapGzipBeforeManifest: manifest.stats.gzipBytes,
  requiresFeature: 'compactMapAssets', activated: false, published: false }));
