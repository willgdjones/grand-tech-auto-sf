import { Group, Mesh } from 'three';
import { Parts, disposeLandmark } from './landmarks/primitives';

/** Original portable picnic props; reference photographs are never textures. */
export function createDoloresPicnic() {
  const root = new Group(); root.name = 'Dolores picnic blankets';
  const blankets: Group[] = [];
  for (const [x, z, colour] of [[-1.45, 0, '#aa684a'], [1.3, 1.3, '#537978']] as const) {
    const parts = new Parts();
    for (let ix = 0; ix < 8; ix++) for (let iz = 0; iz < 6; iz++) {
      const a = x - 1.2 + ix * .3, b = z - .9 + iz * .3;
      parts.polygon([[a, 0, b], [a, 0, b + .3], [a + .3, 0, b + .3], [a + .3, 0, b]],
        (ix + iz) % 2 ? colour : '#ddcba5');
    }
    const blanket = parts.finish('Original woven picnic blanket'); blankets.push(blanket); root.add(blanket);
  }
  const coolerParts = new Parts();
  coolerParts.box([0, .22, 0], [.66, .40, .43], '#547c91');
  coolerParts.box([0, .44, 0], [.72, .07, .48], '#e7ddc3');
  coolerParts.box([0, .27, .235], [.24, .07, .035], '#324757');
  for (const x of [-.37, .37]) coolerParts.box([x, .32, 0], [.06, .15, .25], '#d4d0bc');
  const cooler = coolerParts.finish('Picnic cooler'); cooler.position.set(.2, 0, -1.25); root.add(cooler);
  const bagParts = new Parts();
  bagParts.box([0, .22, 0], [.42, .43, .22], '#b79b68');
  for (const x of [-.13, .13]) bagParts.box([x, .49, 0], [.045, .18, .035], '#786748');
  bagParts.box([0, .575, 0], [.30, .035, .035], '#786748');
  for (const x of [-.14, .14]) {
    bagParts.cylinder([x, .09, .45], .06, .06, .18, '#dcbb64', 8);
    bagParts.cylinder([x, .185, .45], .045, .045, .012, '#c5c5b6', 8);
  }
  const bag = bagParts.finish('Picnic tote and cans'); bag.position.set(1.8, 0, 1.2); root.add(bag);
  return {
    root,
    /** Called only on near/loaded refresh. Cloth follows the actual hill without flattening it. */
    ground(heightAt: (x: number, z: number) => number | null) {
      for (const blanket of blankets) for (const object of blanket.children) {
        if (!(object instanceof Mesh)) continue;
        const positions = object.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          const y = heightAt(positions.getX(i), positions.getZ(i));
          if (y === null || !Number.isFinite(y)) return false;
          positions.setY(i, y + .025);
        }
        positions.needsUpdate = true; object.geometry.computeVertexNormals(); object.geometry.computeBoundingSphere();
      }
      for (const prop of [cooler, bag]) {
        const y = heightAt(prop.position.x, prop.position.z);
        if (y === null || !Number.isFinite(y)) return false;
        prop.position.y = y;
      }
      return true;
    },
    dispose() { disposeLandmark(root); },
  };
}
