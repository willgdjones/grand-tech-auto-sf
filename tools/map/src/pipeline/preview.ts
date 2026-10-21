import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_ROOT, settings } from './settings';

const args=process.argv.slice(2),value=(name:string,fallback:string)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]??fallback;};
const area=value('--area','lombard'),port=Number(value('--port','4177')),s=settings(area);
const threeRoot=resolve(fileURLToPath(import.meta.resolve('three')),'../..');
const meshoptRoot=resolve(fileURLToPath(import.meta.resolve('meshoptimizer')),'..');
const roots:{prefix:string;root:string}[]=[{prefix:'/map/',root:s.out},{prefix:'/vendor/three/',root:threeRoot},{prefix:'/vendor/meshoptimizer/',root:meshoptRoot}];
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.glb':'model/gltf-binary','.bin':'application/octet-stream'};
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url??'/','http://localhost');
    let path:string;
    if(url.pathname==='/')path=join(MAP_ROOT,'preview/index.html');
    else {
      const entry=roots.find(r=>url.pathname.startsWith(r.prefix));if(!entry){res.writeHead(404);res.end();return;}
      path=resolve(entry.root,decodeURIComponent(url.pathname.slice(entry.prefix.length)));
      if(!path.startsWith(resolve(entry.root)+sep)){res.writeHead(403);res.end();return;}
    }
    if(!(await stat(path)).isFile()){res.writeHead(404);res.end();return;}
    const bytes=await readFile(path);res.writeHead(200,{'content-type':types[extname(path)]??'application/octet-stream','cache-control':'no-cache'});res.end(bytes);
  }catch(error){res.writeHead(404,{'content-type':'text/plain'});res.end(error instanceof Error?error.message:'Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Map preview: http://127.0.0.1:${port} (${area}; static server, no watcher)`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(()=>process.exit(0)));
