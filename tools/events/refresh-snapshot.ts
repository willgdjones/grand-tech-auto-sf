import { writeFile, mkdir, rename } from 'node:fs/promises';
import { fetchOfficialEvents } from '../../worker/src/events/official-feed';

// Explicit bundled-seed update; live refresh uses the same reader through Cron/Queues.
const snapshot=await fetchOfficialEvents({onPage:(page,received,total)=>console.log(`page ${page}: ${received}/${total}`)});
const output=new URL('../../worker/src/events/data/sf-tech-week.json',import.meta.url),temporary=new URL(`${output.href}.tmp`);
await mkdir(new URL('.',output),{recursive:true});
await writeFile(temporary,JSON.stringify(snapshot)+'\n');await rename(temporary,output);
console.log(`Saved ${snapshot.events.length} public events, ${snapshot.events.filter(event=>event.lat!==null).length} approximate physical markers. No private addresses retained.`);
