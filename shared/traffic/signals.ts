function hash(value:string):number {
  let result=2166136261;
  for(const character of value)result=Math.imul(result^character.charCodeAt(0),16777619);
  return result>>>0;
}

/** Existing authoritative 28-second cycle: 13s per axis, with 1s all-red gaps.
 * Use the original OSM junction ID and the synchronized server clock on clients.
 */
export function signalGreen(nowMs:number,junction:string,yaw:number):boolean {
  const phase=((nowMs+hash(junction)%28000)%28000+28000)%28000;
  const eastWest=Math.abs(Math.sin(yaw))>Math.abs(Math.cos(yaw));
  return eastWest?phase>=14000&&phase<27000:phase<13000;
}
