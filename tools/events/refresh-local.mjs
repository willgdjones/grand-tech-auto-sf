/** Drive Wrangler's native local scheduled handler; never add a public refresh API. */
const base='http://127.0.0.1:8787';
const interval=3*60*60_000;
let timer,stopped=false;
async function refresh(){
  let delay=interval;
  try{
    const health=await fetch(`${base}/api/health`,{signal:AbortSignal.timeout(5000)});
    if(!health.ok)throw new Error(`Worker health HTTP ${health.status}`);
    const state=await health.json();
    if(state.environment!=='local')throw new Error('Local refresh requires a local Worker');
    if(state.flags?.eventsRefresh){
      const response=await fetch(`${base}/cdn-cgi/local/scheduled?cron=${encodeURIComponent('0 */3 * * *')}`,{signal:AbortSignal.timeout(15_000)});
      if(!response.ok)throw new Error(`Local event scheduler HTTP ${response.status}`);
      console.log('GTASF: real Tech Week event refresh queued; next refresh in three hours.');
    }
  }catch(error){delay=60_000;console.warn(`GTASF: event refresh deferred: ${error.message}. Seeded events remain available.`);}
  if(!stopped)timer=setTimeout(refresh,delay);
}
function stop(){stopped=true;clearTimeout(timer);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
timer=setTimeout(refresh,15_000);
