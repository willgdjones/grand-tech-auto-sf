import {
  BufferGeometry, CanvasTexture, Float32BufferAttribute, Group, LinearFilter,
  Mesh, MeshBasicMaterial, SRGBColorSpace,
} from 'three';
import { flags } from '@gtasf/shared/flags';
import { isOutbidSnapshot, type OutbidEntry } from '@gtasf/shared/outbid';

const WIDTH=1024, HEIGHT=512;
export interface OutbidCrown {
  /** Only pass canonical HTTP/WorldDO state; the browser never awards a rank. */
  setSnapshot(snapshot:unknown):void;
  destroy():void;
}

/** Four curved displays follow the existing rounded Salesforce crown, 283–310 m. */
function crownGeometry():BufferGeometry {
  const positions:number[]=[],uv:number[]=[];
  const levels=[283,290,302,310];
  const point=(angle:number,y:number)=>{
    const radius=27*Math.sqrt(1-((y-270)/57)**2)+0.9;
    const s=Math.sin(angle),c=Math.cos(angle);
    return [Math.sign(s)*Math.abs(s)**0.68*radius,y,Math.sign(c)*Math.abs(c)**0.68*radius*0.92];
  };
  const add=(angle:number,y:number,u:number)=>{positions.push(...point(angle,y));uv.push(u,(y-283)/27);};
  for(let face=0;face<4;face++)for(let row=1;row<levels.length;row++)for(let segment=0;segment<8;segment++){
    const u=segment/8,v=(segment+1)/8,lo=levels[row-1]!,hi=levels[row]!;
    const a=(face+u)*Math.PI/2-Math.PI/4,b=(face+v)*Math.PI/2-Math.PI/4;
    add(a,lo,u);add(b,lo,v);add(b,hi,v);
    add(a,lo,u);add(b,hi,v);add(a,hi,u);
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  return geometry;
}

/** Wrap by measured glyphs so a long word, emoji or URL cannot escape its display. */
function textLines(context:CanvasRenderingContext2D,text:string,maxWidth:number):string[] {
  const lines:string[]=[];let line='';
  for(const glyph of Array.from(text.replace(/\s+/g,' ').trim())){
    const next=line+glyph;
    if(line&&context.measureText(next).width>maxWidth){
      const space=line.lastIndexOf(' ');
      if(space>0){lines.push(line.slice(0,space));line=line.slice(space+1)+glyph;}
      else{lines.push(line.trim());line=glyph.trimStart();}
    }
    else line=next;
  }
  if(line)lines.push(line.trim());
  return lines;
}

function drawWinner(canvas:HTMLCanvasElement,winner:OutbidEntry,testMode:boolean):void {
  const context=canvas.getContext('2d');
  if(!context)throw new Error('The Outbid crown requires a 2D canvas context.');
  context.fillStyle='#061b25';context.fillRect(0,0,WIDTH,HEIGHT);
  context.fillStyle='#2ce1ca';context.fillRect(0,0,WIDTH,9);context.fillRect(0,HEIGHT-9,WIDTH,9);
  context.textAlign='center';context.textBaseline='middle';
  context.font='700 27px system-ui, sans-serif';context.fillStyle='#7ce9dc';
  context.fillText(`CITY CROWN  ·  #1${testMode?'  ·  TEST':''}`,WIDTH/2,42);
  let nameSize=60,names:string[]=[];
  do{context.font=`800 ${nameSize}px system-ui, sans-serif`;names=textLines(context,winner.name,WIDTH-96);
    if(names.length<=2)break;nameSize-=2;
  }while(nameSize>28);
  let y=names.length===1?111:91;
  context.fillStyle='#ffffff';
  for(const line of names){context.fillText(line,WIDTH/2,y);y+=64;}
  const start=Math.max(188,y+19),space=HEIGHT-35-start;
  let size=56,lines:string[]=[];
  do{context.font=`700 ${size}px system-ui, sans-serif`;lines=textLines(context,winner.message,WIDTH-96);
    if(lines.length*size*1.13<=space)break;size-=2;
  }while(size>22);
  context.fillStyle='#ffdf91';
  const lineHeight=size*1.13,offset=start+(space-lines.length*lineHeight)/2+lineHeight/2;
  lines.forEach((line,index)=>context.fillText(line,WIDTH/2,offset+index*lineHeight));
}

/** Attach once; root forwards the same validated state used by the top banner. */
export function createOutbidCrown(landmarks:Group,{enabled=flags.outbidCrown}: {enabled?:boolean}={}):OutbidCrown {
  const tower=landmarks.userData.landmarkId==='salesforce-tower'?landmarks:
    landmarks.children.find(object=>object.userData.landmarkId==='salesforce-tower');
  let revision=-1,key='',disposed=false;
  let canvas:HTMLCanvasElement|undefined,texture:CanvasTexture|undefined;
  let mesh:Mesh<BufferGeometry,MeshBasicMaterial>|undefined;
  return {
    setSnapshot(snapshot){
      if(disposed||!enabled||!tower||!isOutbidSnapshot(snapshot)||snapshot.revision<=revision)return;
      revision=snapshot.revision;
      const winner=snapshot.entries[0];
      if(!winner){key='';if(mesh)mesh.visible=false;return;}
      // Payment-only, lower-rank and URL changes do not require a GPU upload.
      const nextKey=JSON.stringify([winner.bidderId,winner.name,winner.message,snapshot.mode]);
      if(nextKey===key)return;
      if(!mesh){
        canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;
        texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;texture.magFilter=LinearFilter;
        mesh=new Mesh(crownGeometry(),new MeshBasicMaterial({map:texture,toneMapped:false}));
        mesh.material.userData.gtasfUnlit=true; // full-bright ad; skip the realisticRender PBR conversion so it doesn't darken (gtasf-coum)
        mesh.name='Approved Outbid crown';mesh.userData.outbidCrown=true;
        tower.add(mesh);
      }
      drawWinner(canvas!,winner,snapshot.mode==='test');
      texture!.needsUpdate=true;mesh.visible=true;key=nextKey;
    },
    destroy(){
      if(disposed)return;disposed=true;
      mesh?.removeFromParent();mesh?.geometry.dispose();mesh?.material.dispose();texture?.dispose();
      mesh=undefined;texture=undefined;canvas=undefined;
    },
  };
}
