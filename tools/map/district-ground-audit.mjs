/** Diagnose emitted ground at source arrivals; no map, app or server mutation.
 * tools/heavy.sh node --import tsx tools/map/district-ground-audit.mjs <map-root> <new-report.json>
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Matrix4, Vector3 } from 'three';
import { readGlb } from './src/glb.ts';
import { DISTRICTS } from './src/districts/index.ts';
import { project } from './src/pipeline/settings.ts';

assert.equal(process.argv.length, 4, 'Supply completed map root and new report path');
const root = resolve(process.argv[2]), output = resolve(process.argv[3]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(join(root, 'manifest.json')), manifest = JSON.parse(manifestBytes);
const receipt = JSON.parse(await readFile(join(root, 'district-rollout.json'), 'utf8'));
assert.equal(sha(manifestBytes), receipt.manifestSha256, 'Completed candidate matches its receipt');
const chunks = new Map(manifest.chunks.map(chunk => [chunk.id, chunk]));
function height([a, b, c], x, z) {
  const denominator = (b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
  if (Math.abs(denominator) < 1e-10) return null;
  const u = ((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/denominator;
  const v = ((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/denominator;
  return u < -1e-6 || v < -1e-6 || u+v > 1+1e-6 ? null : u*a.y+v*b.y+(1-u-v)*c.y;
}
const records = [];
for (const district of DISTRICTS) {
  const [x,z] = project(district.spawn.lon,district.spawn.lat);
  // The five points stay within half a metre of the configured surface lane.
  const probes = [[0,0],[.5,0],[-.5,0],[0,.5],[0,-.5]].map(([dx,dz]) => ({x:x+dx,z:z+dz}));
  for (const id of new Set(probes.map(p => `${Math.floor(p.x/256)}_${Math.floor(p.z/256)}`))) {
    const chunk = chunks.get(id); assert(chunk, `Arrival chunk exists: ${district.id} ${id}`);
    const local = probes.filter(p => `${Math.floor(p.x/256)}_${Math.floor(p.z/256)}` === id);
    for (const artifact of [...new Map(chunk.lods.map(lod => [lod.path,lod])).values()]) {
      const bytes = await readFile(join(root,artifact.path)); assert.equal(sha(bytes),artifact.sha256);
      const doc = await readGlb(bytes);
      const samples = local.map(p => ({...p,roads:[],terrain:[]}));
      for (const node of doc.getRoot().listNodes().filter(n => ['roads','terrain'].includes(n.getName()))) {
        const matrix = new Matrix4().fromArray(node.getWorldMatrix());
        for (const primitive of node.getMesh().listPrimitives()) {
          const position = primitive.getAttribute('POSITION'), indices = primitive.getIndices();
          const vertices = [new Vector3(),new Vector3(),new Vector3()], element = [];
          for (let i=0;i<indices.getCount();i+=3) {
            for (let j=0;j<3;j++) {
              position.getElement(indices.getScalar(i+j),element);
              vertices[j].set(element[0],element[1],element[2]).applyMatrix4(matrix);
              vertices[j].x+=chunk.bounds[0];vertices[j].z+=chunk.bounds[1];
            }
            for (const sample of samples) {
              const y = height(vertices,sample.x,sample.z);
              if (y!==null) sample[node.getName()].push(y);
            }
          }
        }
      }
      for (const sample of samples) sample.passed = sample.roads.length>0 && sample.terrain.length===0;
      records.push({district:district.id,chunk:id,path:artifact.path,sha256:artifact.sha256,samples,
        passed:samples.every(sample=>sample.passed)});
    }
  }
}
const report = {checkedAt:new Date().toISOString(),root,manifestSha256:receipt.manifestSha256,
  scope:'Actual quantized road/terrain triangles at source arrivals and four nearby points, every distinct LOD. No browser, driving, device or full-scene acceptance.',
  passed:records.every(record=>record.passed),records};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,passed:report.passed,records:records.length,
  failed:records.filter(record=>!record.passed).map(record=>({district:record.district,path:record.path,samples:record.samples.filter(sample=>!sample.passed)}))}));
if(!report.passed)process.exitCode=1;
