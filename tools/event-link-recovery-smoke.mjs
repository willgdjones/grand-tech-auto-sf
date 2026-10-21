/** Actual spawn/feed and AST-selected main callbacks; controlled transport/actions, no browser or World. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const out = resolve(process.env.GTASF_EVENT_LINK_OUT ?? 'artifacts/event-link-recovery/current');
await mkdir(out, { recursive: true });
const mainText = await readFile(process.env.GTASF_EVENT_MAIN_SOURCE ?? 'web/src/main.ts', 'utf8');
const ast = ts.createSourceFile('main.ts', mainText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const nodes = [];
function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(ast);
const boot = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'boot');
assert.ok(boot?.body, 'Inspect the actual boot function');
const declarations = nodes.filter(ts.isVariableDeclaration);
const named = name => declarations.find(node => ts.isIdentifier(node.name) && node.name.text === name);
const statement = node => {
  while (node && !ts.isStatement(node)) node = node.parent;
  assert.ok(node, 'Extract a real source statement'); return node.getText(ast);
};
const functionText = name => {
  const node = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `Actual ${name} function is required`); return node.getText(ast);
};
const property = (factory, name) => {
  const call = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === factory);
  assert.ok(call && ts.isObjectLiteralExpression(call.arguments[0]), `Actual ${factory} options required`);
  const node = call.arguments[0].properties.find(value => value.name?.getText(ast) === name);
  assert.ok(node, `Actual ${factory}.${name} required`); return node.getText(ast);
};
const listener = id => {
  const call = nodes.find(node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'addEventListener' && node.arguments[0]?.getText(ast) === "'click'"
    && node.expression.expression.getText(ast).includes(`'#${id}'`));
  assert.ok(call?.arguments[1], `Actual ${id} click listener required`); return call.arguments[1].getText(ast);
};
const linkDeclaration = declarations.find(node => node.initializer && ts.isCallExpression(node.initializer)
  && node.initializer.expression.getText(ast) === 'createLinkedDestination');
const linkName = linkDeclaration?.name.getText(ast);
const containsCall = (node, receiver, method) => {
  let matched = false;
  function check(value) {
    if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)
      && value.expression.expression.getText(ast) === receiver && value.expression.name.text === method) matched = true;
    ts.forEachChild(value, check);
  }
  check(node); return matched;
};
let start;
if (linkName) {
  const matches = boot.body.statements.filter(node => containsCall(node, linkName, 'start'));
  assert.equal(matches.length, 1, 'Start linked selection from exactly one actual boot statement');
  start = matches[0].getText(ast);
} else {
  const matches = boot.body.statements.filter(node => ts.isIfStatement(node) && node.expression.getText(ast) === 'request.place.eventId');
  assert.equal(matches.length, 1, 'Preserve the original one-shot link callback for baseline');
  start = matches[0].getText(ast);
}
const routingReady = boot.body.statements.find(node => ts.isExpressionStatement(node)
  && node.getText(ast).includes('routingReady = true'));
assert.ok(routingReady, 'Use actual routing readiness callback');
let disposeLink = '';
if (linkName) {
  const pagehides = nodes.filter(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'addEventListener'
    && node.arguments[0]?.getText(ast) === "'pagehide'" && containsCall(node, linkName, 'cancel'));
  assert.equal(pagehides.length, 1, 'Exactly one gameplay teardown must cancel the link; cinematic teardown is separate');
  const pagehide = pagehides[0];
  const cancels = [];
  function findCancel(node) {
    if (ts.isExpressionStatement(node) && containsCall(node, linkName, 'cancel')) cancels.push(node.getText(ast));
    ts.forEachChild(node, findCancel);
  }
  findCancel(pagehide); assert.equal(cancels.length, 1); disposeLink = cancels[0];
}
const wiring = {
  feed: statement(named('eventFeed')), link: linkDeclaration ? statement(linkDeclaration) : '', start,
  routingReady: routingReady.getText(ast), selectEvent: functionText('selectEvent'), hail: functionText('hail'),
  mapSelect: property('createRadar', 'onSelect'), mapHail: property('createRadar', 'onHail'),
  transit: property('createTrafficControls', 'onDestination'), city: statement(named('onCityDestination')),
  ferry: listener('destination-ferry'), lombard: listener('destination-lombard'), disposeLink,
};
const source = `
import { createEventFeed } from './web/src/events/feed.ts';
import { createLinkedDestination } from './web/src/events/linkedDestination.ts';
import { projectLocation } from './web/src/radar/projection.ts';
import { SF_FRAME } from './tools/map/src/config.ts';
export { resolveSpawn } from './web/src/spawn/locations.ts';
export function mount(request, routeReady) {
  const committed = [], fundingSelections = [], errors = [], notices = [], viewCounts = { markers: 0, upcoming: 0 };
  const ferry = { id:'ferry', title:'Ferry', x:0,y:0,z:0 }, lombard = { id:'lombard', title:'Lombard',x:10,y:0,z:0 };
  let selectedDestination = ferry, mode = 'on-foot', routingReady = false, rejectRoute = false, rejectHail = false;
  const world = { manifest:{frame:SF_FRAME}, surfaceHeightAt(){return 0;} };
  const statusLine = {textContent:'Requested trip unavailable'};
  const gameOptions = {hide(){},setStatus(){}};
  const notify = text => notices.push(text);
  const guidance = {setDestination(){}};
  const funding = {selectEvent(id){fundingSelections.push(id);return Promise.resolve(null);}};
  const taxi = {active:false,hail(){return !rejectHail;},toggle(){return !rejectHail;}};
  const radar = {events:[],routingReady:routeReady,setEvents(events){this.events=[...events];},
    setDestination(target,accept){
      const route={approach:{x:target.x,y:target.y,z:target.z}};
      if(rejectRoute||accept?.(route)===false)return null;
      committed.push({...target});return route;
    }};
  const markers = {setEvents(events){viewCounts.markers=events.length;}};
  const upcoming = {setEvents(events){viewCounts.upcoming=events.length;},setError(message){errors.push(message);}};
  ${wiring.selectEvent}
  ${wiring.hail}
  ${wiring.link}
  ${wiring.routingReady}
  const map={${wiring.mapSelect},${wiring.mapHail}};
  const transit={${wiring.transit}};
  ${wiring.city}
  const chooseFerry=${wiring.ferry},chooseLombard=${wiring.lombard};
  ${wiring.feed}
  ${wiring.start}
  return {eventFeed,radar,committed,fundingSelections,errors,viewCounts,
    get destination(){return selectedDestination;},
    rejectNextHail(value){rejectHail=value;},rejectNextRoute(value){rejectRoute=value;},
    act(kind,event){
      const target={id:'manual-place',title:'Manual place',x:20,y:0,z:0,stop:'Test stop',description:'Test direction'};
      if(kind==='map')map.onSelect(target);
      else if(kind==='map-hail')return map.onHail(target);
      else if(kind==='event')return selectEvent(event);
      else if(kind==='event-hail')return selectEvent(event,true);
      else if(kind==='transit')transit.onDestination(target);
      else if(kind==='city')return onCityDestination(target);
      else if(kind==='ferry')chooseFerry();
      else if(kind==='lombard')chooseLombard();
      else if(kind==='hail')hail();
      else throw new Error('Unknown manual action');
    },
    dispose(){${wiring.disposeLink}eventFeed?.destroy();},
  };
}
`;
await writeFile(resolve(out, 'main-wiring.json'), JSON.stringify(wiring, null, 2) + '\n');
await build({ stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},outfile:resolve(out,'probe-entry.mjs'),
  bundle:true,platform:'node',format:'esm',logLevel:'error' });
const { resolveSpawn, mount } = await import(pathToFileURL(resolve(out,'probe-entry.mjs')).href);
const report = {at:new Date().toISOString(),scope:'Actual spawn/feed and AST-extracted main navigation callbacks, controlled calendar transport and route/taxi/view sinks; no native GPS, browser or World gate.',
  linkedHelperWired:Boolean(linkName),mainWiringSha256:createHash('sha256').update(JSON.stringify(wiring)).digest('hex'),checks:[],passed:false};
const originalFetch=globalThis.fetch;
const event={id:'linked-event',title:'Linked public event',start:'2026-10-05T16:00:00Z',end:null,lat:37.7955,lon:-122.3937,approx:false,url:'https://events.example/linked-event'};
const manual={...event,id:'manual-event',title:'Manual event',lat:37.8};
const tick=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function deferred(){let resolve;return {promise:new Promise(done=>{resolve=done;}),resolve:value=>resolve(value)};}
const scenarios=['ordinary-link','initial-feed-503','calendar-before-routing','routing-before-calendar','latest-before-routing',
  ...['map','map-hail','event','event-hail','transit','city','ferry','lombard','hail'].map(kind=>'manual-'+kind),
  ...['map-hail','event-hail','event-route','transit','city','ferry','lombard','hail'].map(kind=>'rejected-'+kind),
  'dispose-before-routing'];
for(const scenario of scenarios){
  let reads=0,client,latest=event;
  const row={name:scenario,passed:false},routing=deferred(),calendar=deferred();
  const delayRouting=['calendar-before-routing','latest-before-routing','dispose-before-routing'].includes(scenario);
  const delayCalendar=scenario==='routing-before-calendar'||scenario.startsWith('manual-')||scenario.startsWith('rejected-');
  try{
    globalThis.fetch=async url=>{
      assert.equal(url,'/api/events');reads++;
      if(scenario==='initial-feed-503'&&reads===2)return Response.json({error:'Temporary failure'},{status:503});
      if(delayCalendar&&reads===2)await calendar.promise;
      return Response.json({events:[latest]});
    };
    const request=await resolveSpawn(new URL('https://gtasf.test/go/linked-event'));
    assert.equal(request.place.eventId,event.id);
    client=mount(request,routing.promise);assert.ok(client.eventFeed);
    if(!delayRouting)routing.resolve();
    await tick();
    let manualDestination;
    if(scenario.startsWith('manual-')){
      const result=client.act(scenario.slice(7),manual);
      assert.notEqual(result,false,'The manual fixture action must be accepted');
      assert.notEqual(typeof result,'string','The manual fixture route must be available');
      manualDestination=client.destination;
    } else if(scenario.startsWith('rejected-')){
      const kind=scenario==='rejected-event-route'?'event':scenario.slice(9);
      const before=client.destination,count=client.fundingSelections.length;
      if(['map-hail','event-hail','hail'].includes(kind))client.rejectNextHail(true);else client.rejectNextRoute(true);
      const result=client.act(kind,manual);
      if(['map-hail','event-hail','event'].includes(kind))assert.equal(typeof result,'string','The actual callback must reject honestly');
      assert.equal(client.destination,before,'Rejected actions must retain the active destination');
      assert.equal(client.fundingSelections.length,count,'Rejected actions must not change funding selection');
      client.rejectNextRoute(false);client.rejectNextHail(false);
    }
    if(delayCalendar){assert.equal(client.fundingSelections.filter(id=>id===event.id).length,0);calendar.resolve();}
    await client.eventFeed.ready;await tick();
    if(scenario==='initial-feed-503')await client.eventFeed.refresh();
    if(scenario==='latest-before-routing'){
      latest={...event,title:'Moved canonical event',lat:37.8,lon:-122.4};await client.eventFeed.refresh();
    }
    if(delayRouting){
      assert.equal(client.fundingSelections.filter(id=>id===event.id).length,0,'Routing must be ready before selection');
      if(scenario==='dispose-before-routing')client.dispose();
      routing.resolve();await tick();
    }
    await tick();
    const linkedSelections=client.fundingSelections.filter(id=>id===event.id).length;
    Object.assign(row,{calendarReads:reads,linkedSelections,destinationId:client.destination.id,
      recoveredEventIds:client.radar.events.map(value=>value.id),...client.viewCounts,reportedErrors:client.errors.length});
    if(scenario.startsWith('manual-')){
      assert.equal(linkedSelections,0,'Calendar recovery must not replace an accepted manual intent');
      assert.equal(client.destination,manualDestination,'Even selecting the same initial destination must cancel the pending link');
    }else if(scenario==='dispose-before-routing')assert.equal(linkedSelections,0,'Teardown must prevent late routing readiness from selecting');
    else{
      assert.equal(linkedSelections,1,'The linked event must reach the actual funding/navigation selection exactly once');
      assert.deepEqual(client.destination.event,latest,'Use the latest canonical event fields');
      assert.equal(client.destination.id,event.id);
      await client.eventFeed.refresh();await tick();
      assert.equal(client.fundingSelections.filter(id=>id===event.id).length,1,'Later feeds must not repeat the accepted selection');
    }
    row.calendarReads=reads;row.passed=true;
  }catch(error){row.error=String(error);}
  finally{
    client?.dispose();calendar.resolve();routing.resolve();await tick();
    globalThis.fetch=originalFetch;report.checks.push(row);
  }
}
report.passed=report.checks.every(row=>row.passed);
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
if(!report.passed)process.exitCode=1;
