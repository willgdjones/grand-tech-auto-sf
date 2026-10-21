import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { RenderedGroundIndex } from './renderedGround';

describe('Scoped emitted-ground contact',()=>{
  it('uses normalized, transformed selected-LOD faces and keeps deck, visibility and eviction boundaries',()=>{
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new BufferAttribute(new Int16Array([
      -32767,0,-32767, -32767,32767,32767, 32767,0,-32767,
    ]),3,true));
    geometry.setIndex([0,1,2]);
    const material=new MeshBasicMaterial(),root=new Group();
    root.position.set(100,0,-200);root.rotation.y=Math.PI/2;
    const ground=new Mesh(geometry,material);ground.name='terrain_2';
    ground.position.set(5,2,7);ground.scale.set(10,20,10);root.add(ground);
    const deck=ground.clone();deck.name='roads';deck.position.y+=8;root.add(deck);
    const roof=ground.clone();roof.name='buildings';roof.position.y+=30;root.add(roof);
    const underside=ground.clone();underside.name='roads_underside';
    underside.geometry=geometry.clone();underside.geometry.setIndex([0,2,1]);underside.position.y+=40;root.add(underside);

    const index=new RenderedGroundIndex([{minX:98,maxX:115,minZ:-215,maxZ:-193}]);
    index.setChunk('a',root);
    // After node scale/translation and the rotated chunk transform, the lower
    // triangle is (97,2,-195), (117,22,-195), (97,2,-215). This point lies one
    // quarter along each edge: y=7. The second deck is eight metres higher.
    expect(index.heightAt(102,-200,7)).toBeCloseTo(7,10);
    expect(index.heightAt(102,-200,15)).toBeCloseTo(15,10);
    expect(index.heightAt(102,-200)).toBeCloseTo(15,10);
    expect(index.heightAt(102,-200,99)).toBeNull();
    expect(index.heightAt(97,-196)).toBeNull(); // Triangle exists outside opt-in region.
    expect(index.heightAt(114,-214)).toBeNull(); // Region exists outside the triangle.
    expect(index.stats.triangles).toBe(2); // Building roof and underside are excluded.

    ground.visible=false;
    expect(index.heightAt(102,-200,7)).toBeNull(); // Other deck cannot fill pending ground.
    ground.visible=true;root.visible=false;
    expect(index.heightAt(102,-200)).toBeNull();
    root.visible=true;
    const selectedLod=new Group(),coarser=ground.clone();selectedLod.copy(root,false);
    coarser.position.y+=.25;selectedLod.add(coarser);index.setChunk('a',selectedLod);
    expect(index.heightAt(102,-200,7)).toBeCloseTo(7.25,10);
    expect(index.stats.triangles).toBe(1);
    index.removeChunk('a');expect(index.heightAt(102,-200,7)).toBeNull();expect(index.stats.triangles).toBe(0);
    index.setChunk('b',root);index.clear();expect(index.heightAt(102,-200,7)).toBeNull();
    geometry.dispose();underside.geometry.dispose();material.dispose();
  });
});
