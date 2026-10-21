import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute,
  Group, IcosahedronGeometry, Matrix4, Mesh, MeshLambertMaterial, Quaternion,
  Shape, ShapeGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type V3 = readonly [number, number, number];
export type Detail = 'near' | 'far';
export interface BuilderOptions { detail?: Detail }

/** One material/draw call per landmark. All colours enter as sRGB and are stored linear. */
export class Parts {
  private readonly pieces: BufferGeometry[] = [];
  private vertices=0;
  get vertexCount():number { return this.vertices; }

  add(input: BufferGeometry, colour: string, position: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], rotationY = 0): void {
    const geometry = input.index ? input.toNonIndexed() : input;
    if (geometry !== input) input.dispose();
    geometry.scale(...scale).rotateY(rotationY).translate(...position);
    geometry.deleteAttribute('uv');
    const count = geometry.getAttribute('position').count;
    this.vertices+=count;
    const colourValue = new Color(colour), values = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colourValue.toArray(values, i * 3);
    geometry.setAttribute('color', new Float32BufferAttribute(values, 3));
    this.pieces.push(geometry);
  }

  box(position: V3, size: V3, colour: string, rotationY = 0): void {
    this.add(new BoxGeometry(...size), colour, position, [1, 1, 1], rotationY);
  }

  cylinder(position: V3, bottomRadius: number, topRadius: number, height: number, colour: string, sides = 10): void {
    this.add(new CylinderGeometry(topRadius, bottomRadius, height, sides), colour, position);
  }

  ellipsoid(position: V3, scale: V3, colour: string, rotationY = 0, detail = 0): void {
    this.add(new IcosahedronGeometry(1, detail), colour, position, scale, rotationY);
  }

  beam(a: V3, b: V3, width: number, colour: string, depth = width): void {
    const from = new Vector3(...a), to = new Vector3(...b);
    const delta = to.clone().sub(from);
    if (delta.lengthSq() < 1e-12) return;
    const matrix = new Matrix4().compose(
      from.add(to).multiplyScalar(0.5),
      new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.clone().normalize()),
      new Vector3(1, 1, 1),
    );
    this.add(new BoxGeometry(width, delta.length(), depth).applyMatrix4(matrix), colour);
  }

  /** Clock faces and windows are coloured geometry, never canvas textures. */
  polygon(points: readonly V3[], colour: string): void {
    if (points.length < 3) return;
    const vertices: number[] = [];
    for (let i = 1; i < points.length - 1; i++) vertices.push(...points[0]!, ...points[i]!, ...points[i + 1]!);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    this.add(geometry, colour);
  }

  arch(position: V3, width: number, height: number, colour: string, rotationY = 0): void {
    const r = width / 2, spring = height - r;
    const shape = new Shape().moveTo(-r, 0).lineTo(r, 0).lineTo(r, spring);
    shape.absarc(0, spring, r, 0, Math.PI, false);
    shape.lineTo(-r, 0);
    this.add(new ShapeGeometry(shape, 5), colour, position, [1, 1, 1], rotationY);
  }

  /** An arched surround/reveal: the outer arch outline minus an inset arched opening, so when it sits proud of a
   *  recessed glass arch the window reads with depth (a framed opening, not a flat painted arch). `inset` is the
   *  face width of the frame; the opening keeps a sill of `inset` at the bottom. */
  archFrame(position: V3, width: number, height: number, inset: number, colour: string, rotationY = 0): void {
    const r = width / 2, spring = height - r;
    const shape = new Shape().moveTo(-r, 0).lineTo(r, 0).lineTo(r, spring);
    shape.absarc(0, spring, r, 0, Math.PI, false);
    shape.lineTo(-r, 0);
    const ir = r - inset, isp = Math.max(0, spring - inset);
    const hole = new Shape().moveTo(ir, inset).lineTo(ir, isp);
    hole.absarc(0, isp, ir, 0, Math.PI, false);
    hole.lineTo(-ir, inset).lineTo(ir, inset);
    shape.holes.push(hole);
    this.add(new ShapeGeometry(shape, 6), colour, position, [1, 1, 1], rotationY);
  }

  finish(name: string): Group {
    const group = new Group(); group.name = name;
    const geometry = this.pieces.length ? mergeGeometries(this.pieces, false) : null; // empty Parts -> empty group
    for (const piece of this.pieces) piece.dispose();
    this.pieces.length = 0;
    if (geometry) {
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
      material.name = 'Landmark linear vertex colours';
      const mesh = new Mesh(geometry, material); mesh.name = `${name} geometry`;
      group.add(mesh);
    }
    group.userData.landmark = true;
    return group;
  }
}

/** Ring profile with outward faces; equal point counts allow noncircular tapering. */
export function profile(parts: Parts, rings: readonly (readonly V3[])[], colour: string, cap = true): void {
  for (let r = 1; r < rings.length; r++) {
    const low = rings[r - 1]!, high = rings[r]!;
    for (let i = 0; i < low.length; i++) {
      const j = (i + 1) % low.length;
      parts.polygon([low[i]!, low[j]!, high[j]!, high[i]!], colour);
    }
  }
  if (cap) {
    parts.polygon([...rings[0]!].reverse(), colour);
    parts.polygon(rings[rings.length - 1]!, colour);
  }
}

export function roundRing(y: number, rx: number, rz: number, sides = 16, exponent = 1): V3[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = i / sides * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
    return [Math.sign(s) * Math.abs(s) ** exponent * rx, y, Math.sign(c) * Math.abs(c) ** exponent * rz];
  });
}

export function squareRing(y: number, width: number, depth = width): V3[] {
  return [[-width/2,y,depth/2], [width/2,y,depth/2], [width/2,y,-depth/2], [-width/2,y,-depth/2]];
}

export function roof(parts: Parts, x: number, base: number, z: number, width: number, depth: number, rise: number, colour: string): void {
  const l = x-width/2, r = x+width/2, f=z+depth/2, b=z-depth/2;
  parts.polygon([[l,base,f],[r,base,f],[x,base+rise,f]], colour);
  parts.polygon([[r,base,b],[l,base,b],[x,base+rise,b]], colour);
  parts.polygon([[l,base,b],[l,base,f],[x,base+rise,f],[x,base+rise,b]], colour);
  parts.polygon([[r,base,f],[r,base,b],[x,base+rise,b],[x,base+rise,f]], colour);
}

/** Small architectural lettering: simple vector strokes, not a font atlas. */
export function lettering(parts: Parts, text: string, x: number, y: number, z: number, height: number, colour: string): void {
  const glyphs: Record<string, number[][][]> = {
    A:[[[0,0],[0.5,1],[1,0]],[[0.22,0.42],[0.78,0.42]]],
    B:[[[0,0],[0,1],[0.72,1],[0.96,0.82],[0.74,0.52],[0,0.5]],[[0,0.5],[0.8,0.49],[1,0.27],[0.72,0],[0,0]]],
    C:[[[1,0.9],[0.75,1],[0.15,1],[0,0.8],[0,0.2],[0.15,0],[0.75,0],[1,0.1]]],
    D:[[[0,0],[0,1],[0.55,1],[0.88,0.78],[1,0.5],[0.88,0.22],[0.55,0],[0,0]]],
    E:[[[1,1],[0,1],[0,0],[1,0]],[[0,0.5],[0.8,0.5]]],
    F:[[[0,0],[0,1],[1,1]],[[0,0.5],[0.8,0.5]]],
    G:[[[1,0.78],[0.8,1],[0.2,1],[0,0.8],[0,0.2],[0.2,0],[0.8,0],[1,0.2],[1,0.5],[0.55,0.5]]],
    H:[[[0,0],[0,1]],[[1,0],[1,1]],[[0,0.5],[1,0.5]]],
    I:[[[0,1],[1,1]],[[0.5,1],[0.5,0]],[[0,0],[1,0]]],
    L:[[[0,1],[0,0],[1,0]]],
    M:[[[0,0],[0,1],[0.5,0.45],[1,1],[1,0]]],
    N:[[[0,0],[0,1],[1,0],[1,1]]],
    O:[[[0.15,0],[0,0.2],[0,0.8],[0.15,1],[0.85,1],[1,0.8],[1,0.2],[0.85,0],[0.15,0]]],
    P:[[[0,0],[0,1],[0.85,1],[1,0.8],[1,0.6],[0.85,0.5],[0,0.5]]],
    R:[[[0,0],[0,1],[0.85,1],[1,0.8],[1,0.6],[0.85,0.5],[0,0.5]],[[0.5,0.5],[1,0]]],
    S:[[[1,0.85],[0.85,1],[0.15,1],[0,0.85],[0,0.6],[1,0.4],[1,0.15],[0.85,0],[0.15,0],[0,0.15]]],
    T:[[[0,1],[1,1]],[[0.5,1],[0.5,0]]],
    U:[[[0,1],[0,0.2],[0.18,0],[0.82,0],[1,0.2],[1,1]]],
    V:[[[0,1],[0.5,0],[1,1]]],
    W:[[[0,1],[0.25,0],[0.5,0.55],[0.75,0],[1,1]]],
    Y:[[[0,1],[0.5,0.52],[1,1]],[[0.5,0.52],[0.5,0]]],
    K:[[[0,0],[0,1]],[[1,1],[0,0.5],[1,0]]],
    X:[[[0,0],[1,1]],[[0,1],[1,0]]],
    Z:[[[0,1],[1,1],[0,0],[1,0]]],
    '3':[[[0,1],[0.8,1],[1,0.8],[0.6,0.5],[1,0.2],[0.8,0],[0,0]],[[0.4,0.5],[0.6,0.5]]],
    '9':[[[1,0.5],[0.15,0.5],[0,0.7],[0,0.85],[0.15,1],[0.85,1],[1,0.85],[1,0],[0.1,0]]],
  };
  const advance=height*0.88, left=x-(text.length*advance)/2;
  [...text].forEach((char,index)=> {
    for(const stroke of glyphs[char]??[]) for(let i=1;i<stroke.length;i++) {
      const a=stroke[i-1]!,b=stroke[i]!;
      parts.beam([left+index*advance+a[0]!*height*0.65,y+a[1]!*height,z],
        [left+index*advance+b[0]!*height*0.65,y+b[1]!*height,z],height*0.085,colour,height*0.07);
    }
  });
}

export function palm(parts: Parts, x: number, base: number, z: number, height=10): void {
  parts.beam([x,base,z],[x+0.7,base+height,z],0.55,'#998168');
  parts.ellipsoid([x+0.7,base+height,z],[1.1,0.8,1.1],'#546b40');
  for(let i=0;i<9;i++) {
    const a=i*Math.PI*2/9,c=Math.cos(a),s=Math.sin(a);
    const centre:V3=[x+0.7,base+height,z], tip:V3=[x+0.7+c*4.6,base+height-1.7,z+s*4.6];
    const left:V3=[x+0.7+c*2.5-s*0.55,base+height+0.45,z+s*2.5+c*0.55];
    const right:V3=[x+0.7+c*2.5+s*0.55,base+height+0.45,z+s*2.5-c*0.55];
    parts.polygon([centre,left,tip,right],i%2?'#59763e':'#6d8745');
    parts.polygon([right,tip,left,centre],i%2?'#59763e':'#6d8745');
  }
}

export function disposeLandmark(root: Group): void {
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
  });
  root.removeFromParent();
}
