import { CircleGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { flags } from '@gtasf/shared/flags';
import { Parts, lettering, palm, profile, roundRing, squareRing, type BuilderOptions, type V3 } from './primitives';
import { createFerryApron } from './ferryApron';
import { createCardTrees, type CardTree } from './cardTrees';

const STONE = '#d8d2bd', WHITE = '#e2ded2', WINDOW = '#35434a';

/** 260 m: quartz taper, 48 storeys, two vertical service wings and a solid spire. */
export function createTransamericaPyramid({ detail = 'near' }: BuilderOptions = {}): Group {
  const p = new Parts();
  p.box([0, 1, 0], [57, 2, 57], '#b6ae9a');
  // Open ground-level diagonal supports are a strong street-view cue.
  for (const side of [-1, 1]) for (let i = -2; i <= 2; i++) {
    const x = i*10;
    p.beam([x-5,2,side*24], [x+5,17,side*24], 1.1, WHITE);
    p.beam([x+5,2,side*24], [x-5,17,side*24], 1.1, WHITE);
    p.beam([side*24,2,x-5], [side*24,17,x+5], 1.1, WHITE);
  }
  p.box([0, 9, 0], [27, 16, 27], WINDOW);
  const half = (y: number) => 26 - y * 0.098;
  profile(p, [squareRing(17, half(17)*2), squareRing(212, half(212)*2)], WHITE);
  const step = detail === 'near' ? 4.1 : 8.2;
  for (let y = 21; y < 207; y += step) {
    const lower=half(y), upper=half(y+2.05), windowHeight=2.05;
    for (let side=0; side<4; side++) {
      const a = side*Math.PI/2, c=Math.cos(a), s=Math.sin(a);
      const map=(x:number,h:number,z:number):V3=>[x*c+z*s,h,-x*s+z*c];
      p.polygon([map(-lower+1,y,lower+0.04),map(lower-1,y,lower+0.04),
        map(upper-1,y+windowHeight,upper+0.04),map(-upper+1,y+windowHeight,upper+0.04)],WINDOW);
      if (detail === 'near') for (let x=-lower+3; x<lower-2; x+=3.2) {
        p.box(map(x,y+windowHeight/2,half(y+windowHeight/2)+0.12), [0.42,windowHeight+0.1,0.3], WHITE,a);
      }
    }
  }
  for (const sign of [-1,1]) {
    p.box([sign*10.2,164,0], [5.4,95,10], STONE);
    p.box([sign*12.95,164,0], [0.4,94,7], '#e8e3d5');
  }
  if (!flags.transamericaCrown) {
    profile(p,[squareRing(212,10.45),squareRing(259.99,0.12)], '#eae5d7');
    return p.finish('Transamerica Pyramid');
  }
  const tower = p.finish('Transamerica Pyramid');
  // Signature aluminium crown rebuilt UNLIT so the needle keeps its bright colour against the sky at any distance and
  // time of day, and ends in a solid beacon cap instead of a sub-pixel point. ALU = sunlit aluminium, BEACON = the red
  // aviation light at the tip (the "crown"). Night is still blued by the post-grade; this is the structural day read.
  const c = new Parts();
  const ALU = '#f3efe3', ALU_HI = '#f9f6ee', BEACON = '#e2412a';
  profile(c, [squareRing(212, 10.45), squareRing(252, 1.6)], ALU); // bright aluminium needle, stops short of a point
  c.box([0, 255.6, 0], [0.95, 7.4, 0.95], ALU_HI);                 // beacon mast
  c.box([0, 259.6, 0], [1.6, 1.7, 1.6], BEACON);                   // red aviation beacon (the crown light), readable solid
  const crown = c.finish('Transamerica crown');
  const mesh = crown.children[0] as Mesh | undefined;
  if (mesh) {
    (mesh.material as MeshLambertMaterial).dispose?.();
    mesh.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    mesh.name = 'Transamerica crown geometry';
    tower.add(mesh);
  }
  return tower;
}

/** Rounded-square facade, gradual taper, pale horizontal fins and a curved crown. */
export function createSalesforceTower({ detail = 'near' }: BuilderOptions = {}): Group {
  const p=new Parts(), sides=detail==='near'?24:16;
  const radius=(y:number)=> y<270 ? 31-4*(y/270)**2 : 27*Math.sqrt(Math.max(0.015,1-((y-270)/57)**2));
  const ring=(y:number,offset=0)=>roundRing(y,radius(y)+offset,(radius(y)+offset)*0.92,sides,0.68);
  const levels=[0,25,60,100,150,200,250,270,290,302,314,321,326];
  profile(p,levels.map(y=>ring(y)),'#7697a5');
  for (let y=5;y<325;y+=detail==='near'?4.75:9.5) profile(p,[ring(y,0.24),ring(Math.min(y+0.7,326),0.24)],'#c4cdd0',false);
  for(let i=0;i<sides;i++) for(let j=1;j<levels.length;j++) {
    const a=ring(levels[j-1]!,0.35)[i]!,b=ring(levels[j]!,0.35)[i]!;
    p.beam(a,b,detail==='near'?0.32:0.45,'#acbdc3');
  }
  p.box([0,2.5,0],[52,5,50],'#405762');
  p.box([0,5.3,27],[26,0.7,9],'#b6c6cb');
  return p.finish('Salesforce Tower');
}

/** 212 ft in the city brochure: pale fluted shaft, arched observation arcade. */
export function createCoitTower({detail='near'}: BuilderOptions={}): Group {
  const p=new Parts(), n=16;
  // coitFloodlight: warm floodlit-cream concrete, rendered unlit below so the tower reads as a bright pale fluted
  // column by day (noon + golden), HD and Low; dark recesses stay dark. Off = the original pale lit concrete.
  const flood=flags.coitFloodlight, SH=flood?'#ece3cc':STONE, WH=flood?'#f3ebd5':WHITE, RIB=flood?'#fcf5e1':'#e6e1d4';
  p.cylinder([0,1.2,0],9.5,9.5,2.4,SH,16);
  p.cylinder([0,3.4,0],7.4,7.4,2,WH,16);
  p.cylinder([0,29,0],6.4,5.5,49.2,WH,n);
  for(let i=0;i<8;i++) {
    const a=i*Math.PI/4,x=Math.sin(a),z=Math.cos(a);
    p.beam([x*6.1,4.4,z*6.1],[x*5.45,53.6,z*5.45],0.75,RIB,1.1);
    p.box([x*5.4,57.2,z*5.4],[1.3,7.2,1.2],WH,a);
    p.arch([x*5.52,53,z*5.52],3.0,7.0,'#303733',a);
    if(detail==='near') for(let j=-1;j<=1;j++) p.box([
      x*5.75+Math.cos(a)*j*0.68,54.0,z*5.75-Math.sin(a)*j*0.68], [0.15,1.7,0.15],SH,a);
  }
  // A recessed core keeps the arcade dark; the crown remains open around it.
  p.cylinder([0,57.2,0],3.7,3.7,7,'#464b43',12);
  p.cylinder([0,61,0],5.8,5.8,1.2,WH,16);
  for(let i=0;i<8;i++) {
    const a=i*Math.PI/4;
    p.box([Math.sin(a)*5.3,62.6,Math.cos(a)*5.3],[1.5,2.5,1.6],WH,a);
  }
  p.cylinder([0,64.25,0],5.9,5.6,0.73,WH,16);
  p.arch([0,2.4,9.51],3.0,4.2,'#4c514b');
  const tower=p.finish('Coit Tower');
  if(flood) {
    const m=tower.children[0] as Mesh|undefined;
    if(m) { (m.material as MeshLambertMaterial).dispose?.(); m.material=new MeshBasicMaterial({vertexColors:true,toneMapped:false}); }
  }
  return tower;
}

/** Three-legged hourglass, alternating aviation bands and three separate antenna masts. */
export function createSutroTower({detail='near'}: BuilderOptions={}): Group {
  // sutroAviationBands: brighter saturated aviation red + brighter white (rendered unlit below) so the alternating
  // bands read on the skyline instead of washing to a pale slab. Off = the original muted brick-red/pale.
  const bands=flags.sutroAviationBands;
  const p=new Parts(), red=bands?'#d2301c':'#b94b38', pale=bands?'#f3f2e7':'#dddcd1';
  const levels=[0,38,76,114,152,190,228];
  const r=(y:number)=>y<=140?26.4-(26.4-10.56)*y/140:10.56+(17.61-10.56)*(y-140)/88;
  const point=(leg:number,y:number):V3=>[Math.sin(leg*Math.PI*2/3)*r(y),y,Math.cos(leg*Math.PI*2/3)*r(y)];
  for(let leg=0;leg<3;leg++) {
    const b=point(leg,0);p.box([b[0],1.8,b[2]],[9,3.6,9],'#9e9b8a');
    for(let j=1;j<levels.length;j++) {
      const lo=levels[j-1]!,hi=levels[j]!,colour=j%2? pale:red;
      p.beam(point(leg,lo),point(leg,hi),2.2,colour);
      p.beam(point(leg,hi),point((leg+1)%3,hi),1.6,colour);
      p.beam(point(leg,lo),point((leg+1)%3,hi),detail==='near'?0.7:0.9,colour);
      if(detail==='near') p.beam(point(leg,hi),point((leg+1)%3,lo),0.7,colour);
    }
    const top=point(leg,228);
    for(let j=0;j<6;j++) p.cylinder([top[0],228+j*11.63+5.815,top[2]],j<2?1.8:0.85,j<2?1.55:0.6,11.63,j%2?pale:red,6);
    p.beam([top[0]*1.3,228,top[2]*1.3],[top[0]*1.3,242,top[2]*1.3],0.35,pale);
  }
  for(let i=0;i<3;i++) {
    const a=point(i,228),b=point((i+1)%3,228);
    p.beam([a[0]*1.4,228,a[2]*1.4],[b[0]*1.4,228,b[2]*1.4],4,red,7);
    p.beam([a[0]*1.4,232,a[2]*1.4],[b[0]*1.4,232,b[2]*1.4],0.45,red);
  }
  const tower=p.finish('Sutro Tower');
  if(bands) {
    const m=tower.children[0] as Mesh|undefined;
    if(m) { (m.material as MeshLambertMaterial).dispose?.(); m.material=new MeshBasicMaterial({vertexColors:true,toneMapped:false}); }
  }
  return tower;
}


type Footprint = { minX: number; maxX: number; minZ: number; maxZ: number };
/**
 * ferryPlazaDressing (Teleoperator/GTA street-detail push): the arrival plaza was a flat empty tile field. Dress it
 * like a real civic plaza — the Ferry Plaza farmers market (white peaked stall tents with produce), raised concrete
 * planters with shrubs + flowers, street-tree pits with grates, slatted benches, green Recology bins, a news kiosk
 * and a steel bollard line along the Embarcadero edge. All in the landmark's merged Parts mesh (no extra draws).
 * Keeps the spawn sight-line (|x| < 14) and the existing plaza actors' spots clear. Returns solid footprints.
 */
function dressFerryPlaza(p: Parts, cards?: CardTree[]): Footprint[] {
  const solid: Footprint[] = [];
  const block = (x: number, z: number, hx: number, hz: number) => solid.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });
  const concrete = '#b9b3a6', curb = '#a39d90', soil = '#4e3f30', grate = '#3b3f42';
  const leaf = ['#4f6b37', '#5d7a3f', '#44602f', '#6a8746'], bloom = ['#d9a441', '#c8553d', '#e7d9c4', '#a65a8f'];
  // Farmers market: two blocks of three-by-two white peaked stalls, north + south of the hall's centre.
  const produce = ['#c8553d', '#e0a33b', '#7da046', '#d9c06a', '#8d4f8a', '#e07b39'];
  let n = 0;
  // ferryStallsOffRoad (gtasf-hjjda, critic N19c): the routable Embarcadero lanes cross this deck at local z ~42-48, so the
  // outer stall row (z 43) and outer planters (z 44) stood on the carriageway (traffic, GPS line, event robotaxi drove
  // through them). Move them hall-side: rows z 31 + 22 (hall front at z ~14.5), planters z 30 + 22.
  const rows = flags.ferryStallsOffRoad ? [31, 22] : [31, 43], planterRows = flags.ferryStallsOffRoad ? [30, 22] : [30, 44];
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    const x = side * (34 + i * 9.5), z = rows[j]!, w = 3.4, h = 2.6;
    for (const dx of [-w / 2, w / 2]) for (const dz of [-w / 2, w / 2]) p.beam([x + dx, 0.18, z + dz], [x + dx, 0.18 + h, z + dz], 0.07, '#d8d8d4');
    // Peaked canopy: four sloped panels meeting at a ridge point.
    const top: [number, number, number] = [x, 0.18 + h + 0.9, z], y = 0.18 + h;
    const c = [[x - w / 2 - 0.15, y, z - w / 2 - 0.15], [x + w / 2 + 0.15, y, z - w / 2 - 0.15], [x + w / 2 + 0.15, y, z + w / 2 + 0.15], [x - w / 2 - 0.15, y, z + w / 2 + 0.15]] as [number, number, number][];
    for (let k = 0; k < 4; k++) { const a = c[k]!, b = c[(k + 1) % 4]!; p.polygon([a, b, top], n % 3 ? '#f1efe8' : '#e8e2d2'); p.polygon([top, b, a], '#d6d1c4'); }
    // Valance + trestle table with produce crates facing the plaza (+z).
    p.box([x, y - 0.18, z + w / 2 + 0.15], [w + 0.3, 0.32, 0.04], n % 2 ? '#2f6b4f' : '#b8432f');
    p.box([x, 0.95, z + 1.0], [w - 0.4, 0.08, 1.0], '#8a6a48');
    for (const dx of [-1.2, 1.2]) p.box([x + dx, 0.56, z + 1.0], [0.08, 0.76, 0.9], '#5d4a36');
    for (let k = 0; k < 4; k++) {
      p.box([x - 1.15 + k * 0.77, 1.08, z + 1.05], [0.62, 0.18, 0.5], '#9b7b55');
      p.box([x - 1.15 + k * 0.77, 1.2, z + 1.05], [0.54, 0.08, 0.42], produce[(n + k) % produce.length]!);
    }
    block(x, z + 1.0, w / 2, 0.6); n++;
  }
  // Raised planters framing the central approach (concrete box, shrub mass, flower heads), with a bench each side.
  for (const side of [-1, 1]) for (const z of planterRows) {
    const x = side * 18.5;
    p.box([x, 0.55, z], [8, 0.75, 3.2], concrete); p.box([x, 0.94, z], [8.3, 0.08, 3.5], curb);
    for (let k = 0; k < 5; k++) p.ellipsoid([x - 3.2 + k * 1.6, 1.25, z + (k % 2 ? 0.45 : -0.35)], [1.0, 0.6, 0.85], leaf[(k + z) % leaf.length]!, k, 0);
    for (let k = 0; k < 9; k++) p.ellipsoid([x - 3.4 + k * 0.85, 1.55 + (k % 3) * 0.06, z + (k % 2 ? 0.9 : -0.9)], [0.22, 0.18, 0.22], bloom[(k + z) % bloom.length]!);
    block(x, z, 4.15, 1.75);
    // Slatted bench on the plaza-facing (spawn-side) face of the planter.
    const bz = z + 2.6;
    for (let k = 0; k < 3; k++) p.box([x, 0.62, bz - 0.2 + k * 0.17], [3.4, 0.05, 0.12], '#8b6a45');
    for (let k = 0; k < 2; k++) p.box([x, 0.85 + k * 0.17, bz + 0.27], [3.4, 0.11, 0.04], '#8b6a45');
    for (const dx of [-1.5, 1.5]) p.box([x + dx, 0.4, bz], [0.08, 0.44, 0.55], '#2f3336');
    block(x, bz, 1.75, 0.35);
    // Recology bin beside it.
    p.cylinder([x + side * 4.9, 0.68, bz], 0.32, 0.3, 1.0, '#2f6b3b', 10); p.cylinder([x + side * 4.9, 1.2, bz], 0.34, 0.34, 0.05, '#23502c', 10);
  }
  // Street trees in grated pits along the Embarcadero edge (skip the Muni sign at x=-35 and the robotaxi lane x=25).
  for (const x of [-100, -88, -76, -64, -52, -22, 18, 40, 52, 64, 76, 88, 100]) {
    const z = 72;
    p.box([x, 0.19, z], [2.2, 0.02, 2.2], grate); p.box([x, 0.2, z], [1.4, 0.02, 1.4], soil);
    if (cards) {
      // landmarkCardTrees: the same photo cards as the street trees (plane / ficus alternating, varied height + yaw).
      const i = Math.abs(x) / 2;
      cards.push({ kind: i % 2 ? 'ficus' : 'plane', x, y: 0.2, z, height: 8.5 + (i % 3) * 0.9, yaw: (i % 5) * 0.63 });
    } else {
      p.beam([x, 0.2, z], [x + 0.15, 4.2, z], 0.28, '#6e5a44');
      const g = leaf[Math.abs(x) % leaf.length]!;
      p.ellipsoid([x + 0.2, 5.4, z], [2.4, 1.7, 2.3], g, x * 0.1, 1);
      p.ellipsoid([x - 0.9, 4.8, z + 0.6], [1.5, 1.1, 1.4], leaf[(Math.abs(x) + 1) % leaf.length]!, x * 0.2, 0);
      p.ellipsoid([x + 1.1, 4.9, z - 0.5], [1.4, 1.0, 1.5], leaf[(Math.abs(x) + 2) % leaf.length]!, x * 0.3, 0);
    }
    block(x, z, 0.3, 0.3);
  }
  // Steel bollards along the Embarcadero edge (pedestrian plaza / roadway separation), leaving the crossings open.
  for (let x = -114; x <= 114; x += 3) if (Math.abs(x) > 9 && Math.abs(Math.abs(x) - 60) > 4) p.cylinder([x, 0.65, 78.2], 0.13, 0.11, 0.95, '#3c4246', 8);
  // News kiosk mirroring the coffee cart across the axis.
  p.box([41, 1.4, 21], [3.0, 2.4, 1.9], '#2f5c4a'); p.box([41, 2.75, 21.4], [3.6, 0.18, 2.8], '#c9b27a');
  p.box([41, 1.5, 22.0], [2.4, 1.0, 0.04], '#d9d2bd'); p.box([41, 2.95, 21], [3.2, 0.3, 2.1], '#24483a');
  block(41, 21, 1.6, 1.05);
  return solid;
}

export function createFerryBuilding({detail='near'}: BuilderOptions={}): Group {
  // Vivid SF pass (pane 9, founder plaza review): cream-white sandstone walls, a grey-blue slate
  // roof and darker grey paving so the arrival plaza reads in real colour, not one khaki hue.
  const p=new Parts(), stone='#dbd4bf', trim='#ece7d6', roof='#5c6b7d';
  // ferryBuildingHd (gtasf-dtk5): extra authored detail on the spawn-view landmark (near detail only).
  const hd=flags.ferryBuildingHd&&detail==='near';
  // ferryArcadeLit (Teleoperator street-detail push): the ground-floor arcade + entrance arches were dark glass that
  // reads as pure BLACK voids under the grade — the spawn view's biggest flat patch. Route them into their own UNLIT
  // mesh as warm, lit marketplace interiors (a few shops dimmer for variety); the mullion bars stay in front.
  const arcade=flags.ferryArcadeLit?new Parts():p, shops=['#bfa27c','#cdb38c','#b39470','#7d6a55','#c7aa82','#a88d6c'];
  let shop=0;
  // The plaza is deliberately open on the central axis: this is the player's arrival view.
  p.box([0,-0.15,23],[234,0.5,112],'#8d8b85');
  p.box([0,0.12,48],[224,0.08,63],'#9b968b');
  // ferryPlazaSetts (critique #4): the deck's granite-slab course + grime are in the Ferry surface shader
  // (urbanSurfaces.ts); here only the clerestory glazing below.
  const paving=flags.ferryPlazaSetts&&detail==='near';
  for(let x=-108;x<=108;x+=9) p.box([x,0.17,48],[0.13,0.012,61],'#767269');
  for(let z=21;z<79;z+=9) p.box([0,0.17,z],[222,0.012,0.13],'#767269');
  p.box([0,0.2,78.8],[234,0.4,0.55],'#c6c1b4');
  // landmarkCardTrees: the six Embarcadero palms + the plaza tree pits as atlas photo cards instead of blob/frond geometry.
  const cards: CardTree[] | undefined = flags.landmarkCardTrees ? [] : undefined;
  for(const x of [-95,-70,-45,45,70,95]) {
    p.box([x,0.28,66],[5.6,0.25,5.6],'#8e8f73');
    if(cards) cards.push({ kind: 'palm', x, y: 0.4, z: 66, height: 12.5 + (Math.abs(x) % 3) * 0.8, yaw: (Math.abs(x) % 4) * 0.8 });
    else palm(p,x,0.4,66,10.5+(Math.abs(x)%3));
    p.box([x,0.65,38],[5.4,1.0,1.0],'#8a7966');
  }
  for(let x=-108;x<=108;x+=9) if(Math.abs(x)>15) p.cylinder([x,0.85,23],0.22,0.2,1.5,'#536364',6);
  p.box([0,8.5,0],[201,17,29],stone);
  p.box([0,17.5,0],[204,1.4,31],trim);
  p.box([0,19,0],[199,1.7,25],roof);
  const plazaSolid=flags.ferryPlazaDressing&&detail==='near'?dressFerryPlaza(p,cards):[];
  if(hd) {
    // Modillion course under the arcade cornice so the long roofline reads as moulded stone, not a flat lip.
    for(const side of [-1,1]) for(let x=-99;x<=99;x+=4.4) p.box([x,16.4,side*15.4],[2.2,1.0,0.55],trim);
  }
  for(const side of [-1,1]) for(let x=-92;x<=92;x+=detail==='near'?8:16) {
    // ferryArcadeLit: the hd glass (14.35) + mullions (14.42) sat INSIDE the wall box (face at 14.5), so the bays
    // rendered as plain stone; put the lit glass just proud of the wall, mullions in front, frame still outermost.
    const lit=flags.ferryArcadeLit&&hd, glz=lit?14.56:hd?14.35:14.55, mz=lit?14.62:hd?14.42:14.7;
    // Keep the glass DARK so it reads as glazing on the Low (ps2) path (no env/tonemap). The reveal frame is
    // the WALL stone colour, not bright trim, and the recess is shallow (glass just behind the wall face): at
    // the distant tower framing a pale proud ring + a deep recess made the small arches read as pale
    // wall-coloured outlines, so the frame now blends into the wall and the dark pane itself reads as the
    // window from far away, while the proud stone reveal + recess still set the window into the wall up close.
    arcade.arch([x,1.2,side*glz],5.4,9.6,flags.ferryArcadeLit?shops[shop++%shops.length]!:hd?'#33403f':'#3b4846',side===1?0:Math.PI);
    // ferryPlazaSetts: the clerestory arches read as black holes; glaze them (sky-grey glass + a mullion cross).
    p.arch([x,12,side*14.57],3.8,3.5,paving?'#7e8b93':'#485653',side===1?0:Math.PI);
    if(paving) { p.box([x,13.7,side*14.62],[0.14,3.3,0.06],trim); p.box([x,13.6,side*14.62],[3.7,0.14,0.06],trim); }
    p.box([x,6.1,side*14.65],[0.35,9.7,0.4],trim);
    p.box([x-3.75,6.5,side*14.8],[0.8,13,0.7],trim);
    p.box([x,10.8,side*14.75],[7.6,0.38,0.5],trim);
    if(hd) {
      // Stone (wall-coloured) arched reveal + side jambs, proud of the wall, so the opening reads set-in up
      // close without adding a pale ring that dominates the arch from a distance.
      p.archFrame([x,0.9,side*14.62],6.2,10.4,0.5,stone,side===1?0:Math.PI);
      for(const dx of [-2.75,2.75]) p.box([x+dx,5.0,side*14.45],[0.16,8.4,0.5],stone);
    }
    if(detail==='near') {
      for(const dy of [3.0,5.2,7.4]) p.box([x,dy,side*mz],[5.1,0.16,0.32],'#9baba7');
      for(const dx of [-1.6,1.6]) p.box([x+dx,5.4,side*mz],[0.16,8.2,0.32],'#9baba7');
    }
  }
  // ferryEndArcades (critic N17): the hall's two END faces (x = +-100.5, 29 m wide) were bare stone: from the Embarcadero south of
  // the plaza the player saw a windowless tan slab. Give each end the side arcade's treatment, rotated to face +-x.
  if(flags.ferryEndArcades) for(const end of [-1,1]) for(const z of [-8,0,8]) {
    const rot=end*Math.PI/2, lit=flags.ferryArcadeLit&&hd, gx=end*(lit?100.56:hd?100.35:100.55);
    arcade.arch([gx,1.2,z],5.4,9.6,flags.ferryArcadeLit?shops[shop++%shops.length]!:hd?'#33403f':'#3b4846',rot);
    p.arch([end*100.57,12,z],3.8,3.5,paving?'#7e8b93':'#485653',rot);
    if(paving) { p.box([end*100.62,13.7,z],[0.06,3.3,0.14],trim); p.box([end*100.62,13.6,z],[0.06,0.14,3.7],trim); }
    p.box([end*100.65,6.1,z],[0.4,9.7,0.35],trim);
    p.box([end*100.8,6.5,z-3.75],[0.7,13,0.8],trim);
    p.box([end*100.75,10.8,z],[0.5,0.38,7.6],trim);
    if(hd) p.archFrame([end*100.62,0.9,z],6.2,10.4,0.5,stone,rot);
    // Mullion grid in front of the glass, as on the long sides (critic: without it the end arches read as flat recesses on Low).
    if(detail==='near') {
      const mx=end*(lit?100.62:hd?100.42:100.7);
      for(const dy of [3.0,5.2,7.4]) p.box([mx,dy,z],[0.32,0.16,5.1],'#9baba7');
      for(const dz of [-1.6,1.6]) p.box([mx,5.4,z+dz],[0.32,8.2,0.16],'#9baba7');
    }
  }
  // Closing pilaster at each end's +z edge (the per-arch pilasters sit at z-3.75, so +z had none; review nit).
  if(flags.ferryEndArcades) for(const end of [-1,1]) p.box([end*100.8,6.5,12.25],[0.7,13,0.8],trim);
  // Projecting central entrance and paired end pavilions break up the long arcade rhythm.
  for(const x of [-96,0,96]) {
    p.box([x,1,16],[14,2,5],stone);
    for(const dx of [-6.6,6.6]) p.box([x+dx,8.5,16.1],[1.2,15,2.6],trim);
    p.box([x,16.1,16.1],[15.5,1.2,3.1],trim);
    arcade.arch([x,2,17.12],9.5,12,flags.ferryArcadeLit?'#d2bc98':'#334341');
    for(const dx of [-3,-1,1,3]) p.box([x+dx,6.5,17.17],[0.22,8.5,0.18],'#899e98');
    p.box([x,9.5,17.19],[9.3,0.24,0.18],'#aab5a9');
    // ferryArcadeLit: three dark door openings at the base of each lit entrance so it reads as a doorway, not a slab.
    if(flags.ferryArcadeLit) for(const dx of [-2,0,2]) p.box([x+dx,4.1,17.2],[1.5,4.2,0.12],'#4a3d31');
  }
  lettering(p,'PORT OF',-59,19.7,14.6,2.1,'#4a5a56');
  lettering(p,'SAN FRANCISCO',57,19.7,14.6,2.1,'#4a5a56');
  p.box([0,33.5,0],[13.8,31,13.8],stone);
  p.box([0,21,0],[16.4,2.3,16.4],trim);
  p.box([0,50.3,0],[15.6,1.6,15.6],trim);
  if(hd) {
    // Clean the plain shaft silhouette with vertical corner quoins, two string courses and a bed mould
    // below the top cornice, so the tall face reads as articulated stone rather than one voxel box.
    for(const sx of [-1,1]) for(const sz of [-1,1]) p.box([sx*6.95,35.5,sz*6.95],[1.5,27,1.5],trim);
    for(const y of [30,40]) p.box([0,y,0],[14.4,0.55,14.4],trim);
    p.box([0,49,0],[14.9,0.9,14.9],trim);
  }
  // ferryClockFaces: route the four dials into their own mesh (finished UNLIT below) with a brighter ivory face and
  // crisper hands so the signature clock reads from the spawn plaza; off, d===p and the dials build exactly as before.
  const brightClock=flags.ferryClockFaces, d=brightClock?new Parts():p;
  const FACE=brightClock?'#f3eddc':'#e6dfc4', BEZEL=brightClock?'#3c433c':'#4a514b',
    MARK=brightClock?'#2a302a':'#343c36', HAND=brightClock?'#262c26':'#30372f';
  for(let i=0;i<4;i++) {
    const a=i*Math.PI/2, s=Math.sin(a), c=Math.cos(a);
    // 22 ft dial. Layered circles + twelve markers + hands, all actual triangles.
    d.add(new CircleGeometry(3.65,32),BEZEL,[s*6.99,43.9,c*6.99],[1,1,1],a);
    d.add(new CircleGeometry(3.35,32),FACE,[s*7.04,43.9,c*7.04],[1,1,1],a);
    const onFace=(x:number,y:number):V3=>[s*7.09+c*x,y,c*7.09-s*x];
    for(let n=0;n<12;n++) {
      const t=n*Math.PI/6;
      d.beam(onFace(Math.sin(t)*2.75,43.9+Math.cos(t)*2.75),onFace(Math.sin(t)*3.08,43.9+Math.cos(t)*3.08),0.18,MARK,0.08);
    }
    d.beam(onFace(0,43.9),onFace(1.3,45.1),0.24,HAND,0.12);
    d.beam(onFace(0,43.9),onFace(-0.85,41.25),0.15,HAND,0.12);
    for(const x of [-4.8,-1.6,1.6,4.8]) p.box([s*5.9+c*x,55.3,c*5.9-s*x],[0.8,7.1,0.8],trim,a);
    p.box([s*6.92,31,c*6.92],[0.65,5.5,0.12],'#3b4846',a);
  }
  p.box([0,55.3,0],[7,7.4,7],'#58605a');
  p.box([0,59.3,0],[15.8,1,15.8],trim);
  profile(p,[squareRing(59.8,13.4),squareRing(64,8.8)],roof);
  p.box([0,64.5,0],[9.8,1,9.8],trim);
  for(let i=0;i<8;i++) {
    const a=i*Math.PI/4;
    p.cylinder([Math.sin(a)*3.1,67.5,Math.cos(a)*3.1],0.38,0.32,5,trim,6);
  }
  p.cylinder([0,70.3,0],4,3.4,1,trim,12);
  profile(p,[roundRing(70.8,3.3,3.3,12),roundRing(72.9,1.4,1.4,12),roundRing(73.6,0.15,0.15,12)],roof);
  p.beam([0,73.6,0],[0,74.676,0],0.16,trim);
  // Ferry basins are behind the hall, not on the Embarcadero spawn plaza.
  p.box([0,-2.2,-100],[260,0.15,140],'#568e98');
  for(const x of [-74,-36,35,74]) {
    p.box([x,0.0,-61],[13,0.5,78],'#aaa995');
    for(const side of [-1,1]) {
      p.beam([x+side*6,1.1,-23],[x+side*6,1.1,-100],0.11,'#c4cac1');
      for(let z=-25;z>=-100;z-=10) p.beam([x+side*6,0.2,z],[x+side*6,1.35,z],0.12,'#c4cac1');
    }
    // White arched terminal canopy, following the ROMA gate reference.
    for(let z=-34;z>=-79;z-=15) {
      for(const side of [-1,1]) p.beam([x+side*5.5,0.3,z],[x+side*5.5,5,z],0.28,'#e1dfd2');
      for(let s=0;s<8;s++) {
        const a=s*Math.PI/8,b=(s+1)*Math.PI/8;
        p.beam([x+Math.cos(a)*5.5,5+Math.sin(a)*2.6,z],[x+Math.cos(b)*5.5,5+Math.sin(b)*2.6,z],0.2,'#ede9da');
      }
    }
    for(let s=0;s<8;s++) {
      const a=s*Math.PI/8,b=(s+1)*Math.PI/8;
      p.polygon([[x+Math.cos(a)*5.5,5+Math.sin(a)*2.6,-79],[x+Math.cos(b)*5.5,5+Math.sin(b)*2.6,-79],
        [x+Math.cos(b)*5.5,5+Math.sin(b)*2.6,-34],[x+Math.cos(a)*5.5,5+Math.sin(a)*2.6,-34]],'#bbc8c5');
    }
  }
  const result=p.finish('Ferry Building');
  if(flags.ferryArcadeLit) {
    const lit=arcade.finish('Ferry Building arcade interiors');
    const mesh=lit.children[0] as Mesh | undefined;
    if(mesh) { (mesh.material as MeshLambertMaterial).dispose?.(); mesh.material=new MeshBasicMaterial({vertexColors:true,toneMapped:false}); mesh.name='Ferry Building arcade interiors geometry'; result.add(mesh); }
  }
  if(brightClock) {
    const dials=d.finish('Ferry Building clock faces');
    const mesh=dials.children[0] as Mesh | undefined;
    if(mesh) { (mesh.material as MeshLambertMaterial).dispose?.(); mesh.material=new MeshBasicMaterial({vertexColors:true,toneMapped:false}); mesh.name='Ferry Building clock faces geometry'; result.add(mesh); }
  }
  result.userData.solidFootprints=[{minX:-100.5,maxX:100.5,minZ:-14.5,maxZ:17.2},...plazaSolid];
  result.userData.walkableSurfaces=[{minX:-117,maxX:117,minZ:-33,maxZ:79,y:0.18},
    ...[-74,-36,35,74].map(x=>({minX:x-6.5,maxX:x+6.5,minZ:-100,maxZ:-22,y:0.25}))];
  if(cards?.length) result.add(createCardTrees(cards,'Ferry plaza trees'));
  const apron=createFerryApron();result.add(apron.mesh);
  result.userData.resampleTerrain=apron.resample;
  result.userData.dynamicSurfaceHeightAt=apron.heightAt;
  return result;
}
