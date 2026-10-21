import { expect, it } from 'vitest';
import type { RoadEdge, RoadGraph } from '@gtasf/shared/roadgraph';
import { createLocationNameLookup } from './locationNames';

it('names the occupied road level while preserving hills, radius and district lookup', () => {
  const edges:(RoadEdge&{name:string;osmWay:number})[]=[
    {id:'under',from:'a',to:'b',lane:0,lengthM:40,speedMps:10,points:[[-20,0,0],[20,0,0]],name:'Under Street',osmWay:1},
    {id:'over',from:'c',to:'d',lane:0,lengthM:40,speedMps:10,points:[[0,14,-20],[0,14,20]],name:'Bridge Road',osmWay:2},
    {id:'hill',from:'e',to:'f',lane:0,lengthM:40,speedMps:10,points:[[80,4,0],[120,24,0]],name:'Hill Street',osmWay:3},
  ];
  const graph:RoadGraph={version:1,nodes:[],edges};
  const lookup=createLocationNameLookup(graph,{version:1,neighbourhoods:[
    {id:'district',name:'North District',polygons:[[[[-50,-50],[150,-50],[150,50],[-50,50]]]]},
  ]});
  expect(lookup(.2,1,80,.3)).toMatchObject({street:'Under Street',osmWay:1,distanceM:1,neighbourhood:'North District'});
  expect(lookup(.2,1,80,14.5)).toMatchObject({street:'Bridge Road',osmWay:2});
  expect(lookup(.2,1).street).toBe('Bridge Road'); // Legacy map queries remain planar.
  expect(lookup(100,1,20,14.2).street).toBe('Hill Street');
  expect(lookup(.2,1,20,7)).toMatchObject({street:null,distanceM:null,neighbourhood:'North District'});
  expect(lookup(100,10,2,14)).toMatchObject({street:null,neighbourhood:'North District'});
  expect(lookup(.2,1,80,NaN)).toMatchObject({street:null,neighbourhood:'North District'});
});

it('preserves grid-first ties, named segment filtering and district boundaries across repeated queries', () => {
  const edge=(id:string, points:RoadEdge['points'], name:string, osmWay?:number, kind='lane') =>
    ({id,from:'a',to:'b',lane:0,lengthM:64,speedMps:10,points,name,osmWay,kind});
  const graph:RoadGraph={version:1,nodes:[],edges:[
    // Source order differs from cell visitation order at x=64: West must win.
    edge('east',[[64,0,0],[128,0,0]],'East Street',1),
    edge('west',[[0,0,0],[64,0,0]],'  West Street  ',0),
    edge('twin',[[64,0,0],[128,0,0]],'Later Twin',2),
    edge('connector',[[0,0,-10],[128,0,10]],'Connector',3,'connector'),
    edge('blank',[[0,0,-10],[128,0,10]],'   ',4),
    edge('vertical',[[64,0,0],[64,20,0]],'Zero Length',5),
  ]};
  const lookup=createLocationNameLookup(graph,{version:1,neighbourhoods:[
    {id:'z',name:'Later District',polygons:[[[[0,-20],[128,-20],[128,20],[0,20]]]]},
    {id:'a',name:'First District',polygons:[
      [[[0,-20],[128,-20],[128,20],[0,20]],[[50,5],[70,5],[70,15],[50,15]]],
    ]},
  ]});
  for (let repeat=0;repeat<3;repeat++) {
    expect(lookup(64,0)).toEqual({street:'West Street',osmWay:0,distanceM:0,neighbourhood:'First District'});
    expect(lookup(96,0).street).toBe('East Street');
    expect(lookup(64,10,10)).toEqual({street:null,osmWay:null,distanceM:null,neighbourhood:'Later District'});
    expect(lookup(64,9.99,10).street).toBe('West Street');
    expect(lookup(64,5).neighbourhood).toBe('Later District'); // Hole boundary.
    expect(lookup(0,-20).neighbourhood).toBe('First District'); // Outer boundary.
    expect(lookup(64,256,512).street).toBeNull(); // Radius capped at 256, strict edge.
    expect(lookup(64,0,80,4)).toMatchObject({street:null,neighbourhood:'First District'});
  }
});
