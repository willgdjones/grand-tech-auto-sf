import * as clipping from 'polyclip-ts';
import fast from 'polygon-clipping';
import type { Geom } from 'polyclip-ts';

// Adapted from BDTS ground/boolean.ts. Overlapping ribbons repeatedly subtract near-collinear
// edges. A micrometre orientation tolerance prevents floating-point spikes at shared edges.
// Precision is scoped to one synchronous operation; it does not change source coordinates.
function operation(kind:'intersection'|'difference',first:Geom,rest:Geom[]) {
  // ENU conversion leaves sub-nanometre differences on otherwise straight source edges.
  // Snap boolean inputs to the same millimetre lattice used by the mesh writer.
  const snap=(value:Geom):Geom=>{
    const polygon=(p:[number,number][][])=>p.map(r=>r.map(([x,z]):[number,number]=>[Math.round(x*1000)/1000,Math.round(z*1000)/1000]));
    return typeof value[0]?.[0]?.[0]==='number'?polygon(value as [number,number][][]):(value as [number,number][][][]).map(polygon);
  };
  const snapped=snap(first),more=rest.map(snap);
  try{return fast[kind](snapped,...more);}catch {
    // The exact-decimal implementation is a bounded fallback for difficult topology, not the
    // hot path for hundreds of thousands of terrain cells on the shared build machine.
    clipping.setPrecision(1e-12);
    try{return clipping[kind](snapped,...more);}finally{clipping.setPrecision();}
  }
}
export const intersection=(first:Geom,...rest:Geom[])=>operation('intersection',first,rest);
export const difference=(first:Geom,...rest:Geom[])=>operation('difference',first,rest);
