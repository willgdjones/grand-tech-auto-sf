import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry, Quaternion, TorusGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Point = readonly [number, number, number];
/** Original instanced street furniture, using the existing 4x2 prop atlas. */
export function hdFurnitureGeometry(kind: 'bicycle' | 'planter' | 'treeWell'): BufferGeometry {
  const parts: BufferGeometry[] = [];
  function add(input: BufferGeometry, p: Point, colour: string, tile = 7) {
    const g = input.index ? input.toNonIndexed() : input;
    if (g !== input) input.dispose();
    g.translate(...p);
    const c = new Color(colour), colours = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colours.length; i += 3) c.toArray(colours, i);
    g.setAttribute('color', new Float32BufferAttribute(colours, 3));
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, ((tile % 4) * 256 + 8 + uv.getX(i) * 240) / 1024, 1 - (Math.floor(tile / 4) * 256 + 8 + (1 - uv.getY(i)) * 240) / 512);
    parts.push(g);
  }
  function tube(a: Point, b: Point, radius: number, colour: string, tile = 4) {
    const start = new Vector3(...a), end = new Vector3(...b), delta = end.clone().sub(start);
    const g = new CylinderGeometry(radius, radius, delta.length(), 6);
    g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize()));
    add(g, start.add(end).multiplyScalar(.5).toArray() as [number, number, number], colour, tile);
  }
  if (kind === 'bicycle') {
    // Street-parallel commuter, complete with open spoked wheels, diamond frame and lock hoop.
    for (const x of [-.57, .57]) {
      add(new TorusGeometry(.32, .035, 5, 16), [x, .355, 0], '#272c2a');
      add(new TorusGeometry(.285, .012, 4, 16), [x, .355, 0], '#b9c2bc', 4);
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        tube([x, .355, 0], [x + Math.cos(a) * .28, .355 + Math.sin(a) * .28, 0], .006, '#9ba9a5');
      }
    }
    const rear: Point = [-.57, .355, 0], crank: Point = [-.08, .29, 0], seat: Point = [-.2, .83, 0], head: Point = [.38, .83, 0], front: Point = [.57, .355, 0];
    for (const [a, b] of [[rear, crank], [crank, seat], [seat, rear], [seat, head], [head, crank], [head, front]] as [Point, Point][]) tube(a, b, .027, '#557e79');
    tube(seat, [-.22, .98, 0], .022, '#b0b8af');
    add(new BoxGeometry(.27, .055, .15), [-.23, 1, 0], '#382f28');
    tube(head, [.32, 1.02, 0], .025, '#b0b8af');
    tube([.32, 1.02, -.23], [.32, 1.02, .23], .024, '#a5b1ad');
    for (const z of [-.23, .23]) tube([.32, 1.02, z], [.23, 1.02, z], .035, '#30342e');
    tube([-.08, .29, -.16], [-.08, .29, .16], .02, '#a5b1ad');
    add(new BoxGeometry(.15, .04, .09), [-.08, .29, .2], '#30342e');
    add(new BoxGeometry(.15, .04, .09), [-.08, .29, -.2], '#30342e');
    for (const x of [-.3, .3]) tube([x, .02, -.23], [x, .75, -.23], .035, '#8d9c97');
    tube([-.3, .75, -.23], [.3, .75, -.23], .035, '#8d9c97');
    tube([-.15, .55, -.23], [-.15, .55, .04], .023, '#393a31');
  } else if (kind === 'treeWell') {
    // Shallow square stone surround and open iron spokes over dark soil.
    add(new BoxGeometry(1.8, .025, 1.8), [0, .016, 0], '#534a37', 4);
    for (const side of [-1, 1]) {
      add(new BoxGeometry(2.05, .09, .13), [0, .045, side * .96], '#b6ad96', 4);
      add(new BoxGeometry(.13, .09, 1.8), [side * .96, .045, 0], '#b6ad96', 4);
    }
    for (const radius of [.35, .62, .87]) {
      const ring = new TorusGeometry(radius, .018, 4, 16); ring.rotateX(Math.PI / 2);
      add(ring, [0, .052, 0], '#52605a', 4);
    }
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8;
      tube([Math.cos(a) * .35, .052, Math.sin(a) * .35], [Math.cos(a) * .89, .052, Math.sin(a) * .89], .018, '#59655c');
    }
  } else {
    // Tapered terracotta tub, rolled rim, visible soil and varied clipped shrub clusters.
    add(new CylinderGeometry(.55, .43, .65, 10), [0, .325, 0], '#b68b69', 4);
    add(new CylinderGeometry(.59, .59, .1, 10), [0, .64, 0], '#d0ae85', 4);
    add(new CylinderGeometry(.51, .51, .025, 10), [0, .7, 0], '#4f4735');
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4, r = i === 0 ? 0 : .3;
      const g = new IcosahedronGeometry(.28 + (i % 3) * .04, 1);
      g.scale(1, 1.1 + (i % 2) * .3, 1).rotateY(a);
      add(g, [Math.cos(a) * r, .87 + (i % 3) * .1, Math.sin(a) * r], ['#62754b', '#7c8857', '#4f6844'][i % 3]!);
    }
  }
  const result = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  return result;
}
