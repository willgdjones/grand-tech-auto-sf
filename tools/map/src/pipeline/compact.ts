import type { RoadGraph, XYZ } from './types';

/** Remove redundant dense samples with a strict 2 cm 3D error bound. */
export function simplifyProfile(points:XYZ[],tolerance=0.02):XYZ[] {
  if(points.length<3)return points;
  const keep=new Set([0,points.length-1]),stack:[[number,number]]|[number,number][]=[[0,points.length-1]];
  while(stack.length) {
    const [from,to]=stack.pop()!,a=points[from]!,b=points[to]!;
    const delta=b.map((v,k)=>v-a[k]!) as XYZ,den=delta.reduce((sum,v)=>sum+v*v,0);
    let far=tolerance*tolerance,index=-1;
    for(let i=from+1;i<to;i++) {
      const p=points[i]!,t=den?Math.max(0,Math.min(1,p.reduce((sum,v,k)=>sum+(v-a[k]!)*delta[k]!,0)/den)):0;
      const distance=p.reduce((sum,v,k)=>sum+(v-a[k]!-delta[k]!*t)**2,0);
      if(distance>far){far=distance;index=i;}
    }
    if(index>=0){keep.add(index);stack.push([from,index],[index,to]);}
  }
  return [...keep].sort((a,b)=>a-b).map(i=>points[i]!);
}

/** Keep the public graph shape, topology and source/control metadata; shorten repeated IDs. */
export function compactRoadGraph(graph:RoadGraph):RoadGraph {
  const nodes=new Map(graph.nodes.map((node,i)=>[node.id,`n${i.toString(36)}`]));
  const edges=new Map(graph.edges.map((edge,i)=>[edge.id,`${edge.kind==='lane'?'lane':'turn'}:${i.toString(36)}`]));
  return {...graph,
    nodes:graph.nodes.map(node=>({...node,id:nodes.get(node.id)!})),
    edges:graph.edges.map(edge=>({...edge,id:edges.get(edge.id)!,from:nodes.get(edge.from)!,to:nodes.get(edge.to)!,
      points:simplifyProfile(edge.points),next:edge.next?.map(id=>edges.get(id)!)})),
  };
}
