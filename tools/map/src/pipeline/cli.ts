import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { acquireInputs, atomicWrite } from './sources';
import { MAP_ROOT, settings } from './settings';
import { buildMap, validateMap } from './build';
import { attachNeighbourhoods, writeNeighbourhoods } from './neighbourhoods';
import { packMapRuntime } from './runtime';
import { writeMapTransfer } from './transfer';
import type { Bbox } from './types';

const HELP=`GTASF map pipeline (all generated files stay in tools/map/out/)\n\n`+
  `npm run fetch -- --area lombard             Download/cache sources\n`+
  `npm run build -- --area lombard --fetch     Fetch missing sources and build\n`+
  `npm run build -- --area lombard             Rebuild offline from cache\n`+
  `npm run validate -- --area lombard          Check artifacts, seams and 100 routes\n\n`+
  `npx tsx src/pipeline/cli.ts activate --area sf  Validate/select local map (restart dev)\n\n`+
  `npx tsx src/pipeline/cli.ts pack --area sf  Pack an existing complete city bake\n\n`+
  `npx tsx src/pipeline/cli.ts transfer --area sf  Add a verified local Brotli sidecar only\n\n`+
  `Options: --area lombard|sf  --bbox west,south,east,north  --zoom 12..15\n`+
  `         --osm-pbf path/to/norcal.osm.pbf (requires osmium-tool; mandatory citywide)\n`+
  `         --fetch (build only)  --refresh (requires network access)\n`+
  `         --repair-tunnels (build: replace only affected chunks of the identical-source bake)\n`+
  `         --local-only (activate: retain a measured production-budget blocker for local v1)\n`;
export async function main(args:string[]):Promise<void> {
  const command=args.shift();
  if(!command||args.includes('--help')||command==='--help'){console.log(HELP);return;}
  if(!['fetch','build','validate','activate','pack','transfer'].includes(command))throw new Error(`Unknown command ${command}`);
  let area='lombard',bbox:Bbox|undefined,zoom=15,network=command==='fetch',refresh=false,pbf:string|undefined,repairTunnels=false,localOnly=false;
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(arg==='--fetch'){network=true;continue;}
    if(arg==='--refresh'){refresh=true;continue;}
    if(arg==='--repair-tunnels'){repairTunnels=true;continue;}
    if(arg==='--local-only'){localOnly=true;continue;}
    const value=args[++i];if(!value)throw new Error(`Missing value for ${arg}`);
    if(arg==='--area')area=value;
    else if(arg==='--osm-pbf')pbf=resolve(value);
    else if(arg==='--zoom')zoom=Number(value);
    else if(arg==='--bbox'){const values=value.split(',').map(Number);if(values.length!==4)throw new Error('bbox needs four values');bbox=values as unknown as Bbox;}
    else throw new Error(`Unknown option ${arg}`);
  }
  if(refresh&&!network)throw new Error('--refresh requires fetch or build --fetch');
  const s=settings(area,bbox,zoom);
  if(command==='pack'){await packMapRuntime(s.out);return;}
  if(command==='transfer'){console.log(JSON.stringify(await writeMapTransfer(s.out),null,2));return;}
  if(command==='activate') {
    const report=await validateMap(s.out);
    if(!report.withinBudget&&!localOnly)throw new Error('Map exceeds the production budget; --local-only selects a measured local-v1 bake without claiming production acceptance');
    const manifest=JSON.parse(await readFile(resolve(s.out,'manifest.json'),'utf8')) as {area:string};
    if(manifest.area!==area)throw new Error('Map area does not match its output directory');
    await atomicWrite(resolve(MAP_ROOT,'out/active-map.json'),JSON.stringify({area,localOnly,withinProductionMapBudget:report.withinBudget,activatedAt:new Date().toISOString()})+'\n');
    console.log(`Selected ${area}. Restart npm run dev to serve this complete map.`);return;
  }
  if(command==='validate'){console.log(JSON.stringify(await validateMap(s.out),null,2));return;}
  console.log(`Area ${area}, bounds ${s.bounds.join(', ')}, terrain z${s.zoom}`);
  const input=await acquireInputs(s,network,refresh,pbf);
  const neighbourhoods=await writeNeighbourhoods(s,network,refresh);
  if(command==='fetch'){console.log(`Cached ${input.sources.records.length} map sources plus city neighbourhoods in ${s.cache}`);return;}
  await buildMap(s,input,{repairTunnels});
  let manifest=await attachNeighbourhoods(s,neighbourhoods);
  if(s.detailBounds)manifest=await packMapRuntime(s.out);
  console.log(JSON.stringify(await validateMap(s.out),null,2));
  console.log(`Manifest: ${s.out}/manifest.json`);
  if(!manifest.stats.withinBudget)throw new Error(`Compressed payload exceeds ${manifest.stats.budgetBytes} bytes; see manifest statistics`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch((error:unknown)=>{console.error(error);process.exitCode=1;});
