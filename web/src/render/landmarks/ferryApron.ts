import { BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshLambertMaterial } from 'three';

type HeightAt = (x:number,z:number)=>number|null;
export const FERRY_APRON = {minX:-117,maxX:117,minZ:79,maxZ:83,y:.18} as const;

/** The land-facing plaza exit is a four-metre ramp, not a cliff-rule exception. */
export function createFerryApron(){
  const {minX,maxX,minZ,maxZ,y}=FERRY_APRON,columns=maxX-minX,rows=maxZ-minZ,stride=columns+1;
  const geometry=new BufferGeometry(),positions=new Float32Array(stride*(rows+1)*3),colours=new Float32Array(positions.length),indices:number[]=[];
  const colour=new Color('#9a978e');
  for(let z=0;z<=rows;z++)for(let x=0;x<=columns;x++){
    const i=(z*stride+x)*3;positions[i]=minX+x;positions[i+1]=y;positions[i+2]=minZ+z;
    colour.toArray(colours,i);
    if(x<columns&&z<rows){const a=z*stride+x,b=a+1,c=a+stride,d=c+1;indices.push(a,c,b,b,c,d);}
  }
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new Float32BufferAttribute(colours,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const mesh=new Mesh(geometry,new MeshLambertMaterial({vertexColors:true,flatShading:true}));
  mesh.name='Ferry plaza terrain transition';mesh.visible=false;
  const attribute=geometry.getAttribute('position');let ready=false;
  function resample(sample:HeightAt){
    // No invented support across an unloaded chunk. Streaming calls us again.
    const heights=new Float32Array(stride*(rows+1));
    for(let z=0;z<=rows;z++)for(let x=0;x<=columns;x++){
      const ground=sample(minX+x,minZ+z);if(ground===null||!Number.isFinite(ground)){ready=false;mesh.visible=false;return;}
      heights[z*stride+x]=y+(ground-y)*(z/rows);
    }
    let changed=!ready;
    for(let i=0;i<heights.length;i++)if(Math.abs(attribute.getY(i)-heights[i]!)>1e-5){attribute.setY(i,heights[i]!);changed=true;}
    ready=true;mesh.visible=true;
    if(changed){attribute.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingSphere();}
  }
  function heightAt(x:number,z:number):number|null {
    if(!ready||x<minX||x>maxX||z<minZ||z>maxZ)return null;
    const u=x-minX,v=z-minZ,ix=Math.min(columns-1,Math.floor(u)),iz=Math.min(rows-1,Math.floor(v)),fx=u-ix,fz=v-iz;
    const a=iz*stride+ix,b=a+1,c=a+stride,d=c+1;
    // Same diagonal and planar interpolation as the visible triangles.
    return fx+fz<=1?attribute.getY(a)+(attribute.getY(b)-attribute.getY(a))*fx+(attribute.getY(c)-attribute.getY(a))*fz:
      attribute.getY(d)+(attribute.getY(b)-attribute.getY(d))*(1-fz)+(attribute.getY(c)-attribute.getY(d))*(1-fx);
  }
  return {mesh,resample,heightAt};
}
