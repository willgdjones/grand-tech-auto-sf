import {
  AnimationMixer, Box3, BoxGeometry, BufferGeometry, Color, CylinderGeometry,
  Float32BufferAttribute, Group, Matrix4, Mesh, MeshLambertMaterial, Object3D, SkinnedMesh,
  SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import type { Material } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ResolvedLook } from '@gtasf/shared/content/cosmetics';

const choices = (labels: readonly string[]) => labels.map((label, index) => ({ index, label }));
/** Only installed choices: the wardrobe must not advertise unrendered variants. */
export const avatarLookChoices = {
  outfit: choices(['Ocean', 'Mission red', 'Golden Gate green', 'Sunset cream', 'Ink', 'Plum', 'Rust', 'Fog']),
  hair: choices(['Original crop', 'Close crop', 'Side part', 'Swept back', 'Curls', 'Bob', 'Ponytail', 'Shaved']),
  hairColor: choices(['Chestnut', 'Black', 'Brown', 'Blond', 'Silver', 'Auburn', 'Copper', 'Blue']),
  accessory: choices(['None', 'Glasses', 'Sunglasses', 'Headphones', 'Cap', 'Beanie', 'Scarf', 'Backpack']),
} as const;

const clothColours = [0x477d99, 0x9d3938, 0x4b7352, 0xc5b792, 0x262b35, 0x765069, 0xad643d, 0xa1b0b4];
const hairColours = [0x56341f, 0x171b21, 0x37271f, 0xc4a365, 0xb5b5ae, 0x783e2e, 0xa45e34, 0x35576e];
const variant = (n: number) => Math.max(0, Math.min(7, Math.trunc(Number.isFinite(n) ? n : 0)));
type SocketName = 'Head' | 'Chest' | 'Hips' | 'WristL' | 'WristR';
type Part = { geometry: BufferGeometry; material: MeshLambertMaterial };
interface Reference {
  sockets: Map<SocketName, Matrix4>;
  hair: Box3;
  female: Map<BufferGeometry, BufferGeometry>;
}

/** Geometry is authored in metres, then attached in each bone's neutral frame. */
function referenceFor(gltf: GLTF): Reference {
  const figure = clone(gltf.scene), mixer = new AnimationMixer(figure);
  mixer.clipAction(gltf.animations.find(clip => clip.name === 'idle')!).play();
  mixer.update(0); figure.updateMatrixWorld(true);
  const sockets = new Map<SocketName, Matrix4>();
  for (const name of ['Head', 'Chest', 'Hips', 'WristL', 'WristR'] as const) {
    const bone = figure.getObjectByName(name);
    if (!bone) throw new Error(`Appearance requires avatar bone ${name}`);
    const origin = bone.getWorldPosition(new Vector3());
    sockets.set(name, bone.matrixWorld.clone().invert().multiply(new Matrix4().makeTranslation(origin.x, origin.y, origin.z)));
  }
  const hair = new Box3(), headOrigin = figure.getObjectByName('Head')!.getWorldPosition(new Vector3());
  const female = new Map<BufferGeometry, BufferGeometry>();
  figure.traverse(node => {
    if (!(node instanceof SkinnedMesh)) return;
    const material = node.material as Material;
    if (material.name === 'Hair') {
      node.skeleton.update(); node.computeBoundingBox();
      hair.union(node.boundingBox!.clone().applyMatrix4(node.matrixWorld));
    }
    const head = node.name === 'Casual_Head_1';
    if (!node.name.startsWith('Casual_Head') || head) {
      const geometry = node.geometry.clone(), position = geometry.getAttribute('position');
      const point = new Vector3(), inverse = node.matrixWorld.clone().invert();
      // A second fitted body mesh, sharing the animation skeleton and feet/hand
      // anchors. Deform in the source mesh frame, never mutate shared male data.
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
        if (head) {
          const jaw = Math.max(0, 1 - Math.abs(point.y - 1.43) / .10);
          point.x *= 1 - .16 * jaw;
        } else {
          const waist = Math.max(0, 1 - Math.abs(point.y - 1.08) / .25);
          const shoulder = Math.max(0, 1 - Math.abs(point.y - 1.43) / .22);
          const hip = Math.max(0, 1 - Math.abs(point.y - .88) / .17);
          const centre = Math.max(0, 1 - Math.max(0, Math.abs(point.x) - .22) / .16);
          point.x *= 1 + centre * (-.16 * waist - .11 * shoulder + .07 * hip);
        }
        point.applyMatrix4(inverse); position.setXYZ(i, point.x, point.y, point.z);
      }
      geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      female.set(node.geometry, geometry);
    }
  });
  hair.translate(headOrigin.negate());
  mixer.stopAllAction(); mixer.uncacheRoot(figure);
  figure.traverse(node => { if (node instanceof SkinnedMesh) node.skeleton.dispose(); });
  return { sockets, hair, female };
}

/** One reference/body pair per loaded template; no downloads or frame-time skin work. */
export function createAvatarAppearanceTemplate(gltf: GLTF) {
  let reference: Reference | undefined;
  return {
    create(figure: Object3D) {
      reference ??= referenceFor(gltf);
      return createLayer(figure, reference);
    },
    dispose() {
      reference?.female.forEach(geometry => geometry.dispose());
      reference = undefined;
    },
  };
}

function createLayer(figure: Object3D, reference: Reference) {
  const originals = new Map<Mesh, { geometry: BufferGeometry; visible: boolean; colours: Color[] }>();
  figure.traverse(node => {
    if (!(node instanceof Mesh)) return;
    originals.set(node, { geometry: node.geometry, visible: node.visible,
      colours: (Array.isArray(node.material) ? node.material : [node.material]).map(material => (material as MeshLambertMaterial).color.clone()) });
  });
  const sockets = new Map<SocketName, Group>();
  for (const [name, matrix] of reference.sockets) {
    const socket = new Group(); socket.name = `appearance-${name}`;
    matrix.decompose(socket.position, socket.quaternion, socket.scale);
    figure.getObjectByName(name)!.add(socket); sockets.set(name, socket);
  }
  const materials = new Set<MeshLambertMaterial>(), geometries = new Set<BufferGeometry>();
  const handProps: Object3D[] = [], bulkyProps: Object3D[] = [];
  let signature = '', opacity = 1, seated = false, dead = false;
  const colour = (hex: number) => { const material = new MeshLambertMaterial({ color: hex, flatShading: true }); materials.add(material); return material; };

  function clear() {
    for (const socket of sockets.values()) socket.clear();
    materials.forEach(material => material.dispose()); materials.clear();
    geometries.forEach(geometry => geometry.dispose()); geometries.clear();
    handProps.length = 0; bulkyProps.length = 0;
  }
  function batch(socket: SocketName, label: string, build: (add: (geometry: BufferGeometry, material: MeshLambertMaterial, at?: readonly number[], rotation?: readonly number[]) => void) => void) {
    const parts: Part[] = [];
    build((geometry, material, at = [0, 0, 0], rotation = [0, 0, 0]) => {
      const pose = new Object3D(); pose.position.set(at[0]!, at[1]!, at[2]!); pose.rotation.set(rotation[0]!, rotation[1]!, rotation[2]!); pose.updateMatrix();
      geometry.applyMatrix4(pose.matrix); parts.push({ geometry, material });
    });
    const group = new Group(); group.name = label;
    for (const material of new Set(parts.map(part => part.material))) {
      const matching = parts.filter(part => part.material === material).map(part => part.geometry);
      const geometry = mergeGeometries(matching, false);
      matching.forEach(part => part.dispose());
      if (!geometry) throw new Error(`Could not build avatar ${label}`);
      geometries.add(geometry); const mesh = new Mesh(geometry, material); mesh.name = label; group.add(mesh);
    }
    sockets.get(socket)!.add(group); return group;
  }
  const box = (x: number, y: number, z: number) => new BoxGeometry(x, y, z);
  const sphere = (x: number, y: number, z: number) => new SphereGeometry(1, 10, 6).scale(x, y, z);
  const disc = (r: number, h: number) => new CylinderGeometry(r, r, h, 12);
  const ring = (r: number, tube: number) => new TorusGeometry(r, tube, 4, 12);
  const panel = (points: readonly (readonly [number, number, number])[]) => {
    const both = [...points, ...points];
    const geometry = new BufferGeometry().setFromPoints(both.map(point => new Vector3(...point)));
    const indices: number[] = [];
    for (let i = 1; i < points.length - 1; i++) indices.push(0, i, i + 1, points.length, points.length + i + 1, points.length + i);
    geometry.setIndex(indices); geometry.computeVertexNormals();
    geometry.setAttribute('uv', new Float32BufferAttribute(both.flatMap(point => [point[0], point[1]]), 2));
    return geometry;
  };

  function apply(look: ResolvedLook) {
    if (dead) return;
    const next = [look.sex, look.archetype.id, look.tier.index, look.outfitVariant, look.hair, look.hairColor, look.accessory].join(':');
    if (next === signature) return;
    signature = next; clear();
    const tier = Math.max(0, Math.min(5, look.tier.index));
    const hat = look.accessory === 4 || look.accessory === 5 || look.archetype.id === 'climate';
    const tint = clothColours[variant(look.outfitVariant)]!, hairTint = hairColours[variant(look.hairColor)]!;
    const fabric = colour(tint), dark = colour(0x222b36), light = colour(0xe6e0cd), metal = colour(tier >= 4 ? 0xcfa851 : 0xadb7bb);
    const hairMaterial = colour(hairTint), accent = colour(0xe9a63b), paper = colour(0xf0ebda), lens = colour(0x567981);
    for (const [mesh, original] of originals) {
      mesh.geometry = look.sex === 'female' ? reference.female.get(original.geometry) ?? original.geometry : original.geometry;
      mesh.visible = original.visible;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      list.forEach((material, index) => {
        const mat = material as MeshLambertMaterial; mat.color.copy(original.colours[index]!);
        if (mat.name === 'Purple') mat.color.set(tier >= 3 ? [0, 0, 0, 0x26313c, 0xc4b79c, tint][tier]! : tint);
        if (mat.name === 'Purple' && mesh.name.startsWith('Casual_Body') && look.archetype.id === 'biotech') mat.color.set(0xe6e0cd);
        if (mat.name === 'LightBlue' || (mat.name === 'Skin' && mesh.name.startsWith('Casual_Legs') && tier > 0)) mat.color.set(tier >= 3 ? 0x222b36 : 0x354458);
        if (mat.name === 'Hair' || mat.name === 'Eyebrows') mat.color.set(hairTint);
        if (mat.name === 'Hair' && (look.hair !== 0 || hat)) mesh.visible = false;
      });
    }

    const hairStyle = variant(look.hair), hb = reference.hair;
    const hx = Math.max(.10, (hb.max.x - hb.min.x) / 2), hz = Math.max(.10, (hb.max.z - hb.min.z) / 2);
    const hy = hb.max.y - .045, hc = (hb.max.z + hb.min.z) / 2;
    if (hairStyle > 0 && hairStyle < 7) batch('Head', `hair-${hairStyle}`, add => {
      const cap = new SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI * .57).scale(hx, hairStyle === 1 ? .055 : .083, hz);
      if (!hat) add(cap, hairMaterial, [0, hy - .025, hc]); else cap.dispose();
      if (!hat && (hairStyle === 2 || hairStyle === 3)) {
        add(sphere(hx * .85, .06, hz * .75), hairMaterial, [hairStyle === 2 ? -.035 : 0, hy + .015, hc + (hairStyle === 2 ? .015 : -.04)], [0, 0, hairStyle === 2 ? -.23 : 0]);
      } else if (!hat && hairStyle === 4) {
        for (let i = 0; i < 9; i++) { const angle = i * Math.PI * 2 / 9; add(sphere(.049, .049, .045), hairMaterial, [Math.cos(angle) * hx * .7, hy + .02 + (i % 2) * .02, hc + Math.sin(angle) * hz * .65]); }
      } else if (hairStyle === 5) {
        for (const side of [-1, 1]) add(sphere(.055, hat ? .12 : .15, hz * .8), hairMaterial, [side * hx * .83, hy - (hat ? .155 : .13), hc - .012]);
        add(sphere(hx * .9, hat ? .11 : .13, .055), hairMaterial, [0, hy - (hat ? .145 : .12), hc - hz * .83]);
      } else if (hairStyle === 6) {
        add(sphere(.058, .16, .065), hairMaterial, [0, hy - .15, hc - hz - .035], [.25, 0, 0]);
        add(disc(.034, .025), accent, [0, hy - .015, hc - hz], [Math.PI / 2, 0, 0]);
      }
    });

    // Visible shirt front, stitching, collar, lapels and pockets make each tier
    // read as a garment over the retained animated body rather than a tint alone.
    batch('Chest', `garment-${look.outfit}`, add => {
      const front = .143;
      if (tier === 0) {
        for (const side of [-1, 1]) add(box(.009, .13, .009), light, [side * .044, .004, front]);
      } else {
        add(panel([[-.105, .09, front], [0, -.17, front + .015], [.105, .09, front]]), light);
        const lapel = tier === 1 ? fabric : dark;
        for (const side of [-1, 1]) {
          add(panel([[side * .04, -.16, front + .025], [side * .17, .07, front], [side * .075, .115, front], [side * .04, -.02, front + .015]]), lapel);
          add(box(.08, .012, .015), light, [side * .12, -.17, front]);
          add(box(.01, .28, .012), tier === 5 ? metal : fabric, [side * .20, -.09, front * .7]);
        }
        if (tier >= 3) add(panel([[-.026, .065, front + .032], [-.035, -.105, front + .032], [0, -.155, front + .032], [.035, -.105, front + .032], [.026, .065, front + .032]]), tier === 5 ? accent : fabric);
        if (tier >= 4) add(disc(.014, .012), metal, [-.13, .035, front + .015], [Math.PI / 2, 0, 0]);
      }
      if (look.archetype.id === 'dropout') {
        add(box(.032, .11, .015), light, [-.12, -.015, front + .012]);
        add(box(.07, .018, .015), light, [-.12, .028, front + .02]);
      }
      if (look.archetype.id === 'deep-tech') for (const side of [-1, 1]) add(box(.07, .075, .02), dark, [side * .125, -.06, front]);
    });

    if (tier >= 2 || look.accessory === 2) batch('WristL', 'watch', add => {
      add(ring(.041, .009), dark, [0, -.025, 0], [Math.PI / 2, 0, 0]);
      add(box(.032, .018, .039), metal, [0, -.025, .04]);
      add(box(.025, .005, .03), dark, [0, -.014, .041]);
    });

    const eyewear = (sun: boolean) => batch('Head', sun ? 'sunglasses' : 'glasses', add => {
      const y = hy - .13, z = hb.max.z + .004;
      for (const side of [-1, 1]) {
        add(box(.095, .014, .012), dark, [side * .061, y + .035, z]);
        add(box(.095, .01, .012), dark, [side * .061, y - .025, z]);
        for (const edge of [-1, 1]) add(box(.009, .06, .012), dark, [side * .061 + edge * .044, y + .005, z]);
        if (sun) add(box(.083, .047, .008), lens, [side * .061, y + .005, z]);
        add(box(.012, .012, .14), dark, [side * .112, y + .028, z - .063]);
      }
      add(box(.033, .011, .012), dark, [0, y + .018, z]);
    });
    if (look.accessory === 1 || look.accessory === 2) eyewear(look.accessory === 2);
    if (look.accessory === 3) batch('Head', 'headphones', add => {
      const hoop = new TorusGeometry(hx + .025, .014, 4, 12, Math.PI); add(hoop, dark, [0, hy - .10, hc]);
      for (const side of [-1, 1]) { add(sphere(.035, .065, .043), dark, [side * (hx + .017), hy - .10, hc]); add(disc(.026, .008), metal, [side * (hx + .047), hy - .10, hc], [0, 0, Math.PI / 2]); }
    });
    if (look.accessory === 4 || look.accessory === 5 || look.archetype.id === 'climate') batch('Head', look.accessory === 4 ? 'cap' : 'beanie', add => {
      add(new SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI * .5).scale(hx * 1.06, .105, hz * 1.06), fabric, [0, hy + .01, hc]);
      add(new CylinderGeometry(hx * 1.06, hx * 1.06, .035, 10).scale(1, 1, hz / hx), dark, [0, hy - .0075, hc]);
      if (look.accessory === 4) add(sphere(.12, .014, .1), fabric, [0, hy, hc + hz]);
    });
    if (look.accessory === 6) batch('Chest', 'scarf', add => {
      add(new TorusGeometry(.105, .028, 4, 10).scale(1.1, 1, .8), fabric, [0, .12, .018], [Math.PI / 2, 0, 0]);
      add(box(.065, .29, .02), fabric, [.075, -.035, .164]); add(box(.06, .035, .025), light, [.075, -.16, .166]);
    });
    const backpack = () => {
      const prop = batch('Chest', 'backpack', add => {
        add(sphere(.18, .245, .10), dark, [0, -.10, -.17]);
        add(box(.22, .15, .026), fabric, [0, -.18, -.259]); add(box(.18, .012, .015), metal, [0, -.105, -.276]);
        for (const side of [-1, 1]) add(box(.036, .38, .024), fabric, [side * .14, -.06, -.08]);
      }); bulkyProps.push(prop);
    };
    if (look.accessory === 7 || look.archetype.id === 'hacker' || look.archetype.id === 'climate') backpack();

    const held = (label: string, build: Parameters<typeof batch>[2]) => { const prop = batch('WristL', label, build); handProps.push(prop); return prop; };
    switch (look.prop) {
      case 'laptop': held('prop-laptop', add => {
        add(box(.245, .018, .32), metal, [0, -.04, .025]); add(box(.222, .012, .29), dark, [0, -.054, .025]);
        add(box(.07, .006, .07), accent, [0, -.028, .025]);
      }); break;
      case 'lanyard-tote': {
        batch('Chest', 'prop-lanyard', add => {
          for (const side of [-1, 1]) add(box(.016, .27, .012), accent, [side * .05, -.018, .158], [0, 0, side * .27]);
          add(box(.085, .11, .012), light, [0, -.185, .172]); add(box(.052, .032, .012), fabric, [0, -.16, .18]);
        });
        held('prop-tote', add => { add(box(.23, .25, .07), light, [0, -.22, .025]); add(ring(.072, .009), fabric, [0, -.075, .025]); add(box(.14, .085, .01), fabric, [0, -.20, .064]); }); break;
      }
      case 'hardware-wallet': batch('Chest', 'prop-hardware-wallet', add => {
        add(box(.012, .27, .012), dark, [0, -.03, .16]); add(box(.037, .10, .015), metal, [0, -.20, .165]); add(box(.024, .035, .007), lens, [0, -.19, .177]);
      }); break;
      case 'soldering-iron': batch('Hips', 'prop-tool-roll', add => {
        add(box(.14, .17, .055), dark, [-.18, -.065, .10]);
        add(disc(.012, .16), accent, [-.21, .04, .125]); add(disc(.004, .07), metal, [-.21, .15, .125]);
        add(box(.026, .13, .025), metal, [-.15, .03, .127]);
      }); break;
      case 'sketchbook': held('prop-sketchbook', add => {
        add(box(.20, .032, .26), fabric, [0, -.04, .025]); add(box(.185, .023, .245), paper, [.004, -.04, .025]);
        for (let i = 0; i < 5; i++) add(ring(.012, .003), metal, [-.094, -.04, -.075 + i * .043], [Math.PI / 2, 0, 0]);
      }); break;
      case 'airpods': batch('Head', 'prop-earbuds', add => {
        for (const side of [-1, 1]) { add(sphere(.016, .016, .012), light, [side * hx, hy - .13, hc]); add(disc(.006, .04), light, [side * hx, hy - .15, hc + .008]); }
      }); break;
      case 'lab-coat': batch('Chest', 'prop-lab-coat', add => {
        for (const side of [-1, 1]) {
          add(panel([[side * .025, -.35, .157], [side * .215, -.35, .08], [side * .20, .07, .10], [side * .065, .115, .155]]), light);
          add(box(.075, .065, .012), paper, [side * .115, -.21, .165]);
        }
        add(box(.009, .055, .011), accent, [-.115, -.178, .18]);
      }); break;
      case 'bike': {
        const prop = batch('Chest', 'prop-folding-bike', add => {
          for (const x of [-.13, .13]) { add(ring(.12, .015), dark, [x, -.19, -.31]); add(disc(.018, .02), metal, [x, -.19, -.31], [Math.PI / 2, 0, 0]); }
          add(box(.32, .025, .025), fabric, [0, -.18, -.32], [0, 0, -.35]); add(box(.025, .28, .025), metal, [.13, -.04, -.32]); add(box(.12, .024, .024), dark, [.13, .10, -.32]);
        }); bulkyProps.push(prop); break;
      }
      case 'phone-gimbal': held('prop-phone-gimbal', add => {
        add(disc(.015, .14), dark, [0, -.02, .035]); add(box(.11, .016, .018), metal, [.035, .06, .035]);
        add(box(.075, .14, .012), dark, [.08, .13, .035]); add(box(.062, .117, .007), lens, [.08, .13, .043]);
      }); break;
      case 'company-swag': batch('Chest', 'prop-company-swag', add => {
        add(box(.12, .075, .015), accent, [-.105, -.015, .162]); add(box(.075, .012, .018), light, [-.105, -.015, .172]);
        for (const side of [-1, 1]) add(box(.02, .30, .014), light, [side * .185, -.045, .115]);
      }); break;
      case 'varsity': batch('Chest', 'prop-varsity', add => {
        add(box(.033, .15, .018), light, [-.115, -.015, .165]); add(box(.10, .026, .018), light, [-.085, -.077, .165]);
        add(box(.035, .13, .014), fabric, [-.115, -.015, .178]);
      }); break;
      case 'coffee': held('prop-coffee', add => {
        add(new CylinderGeometry(.039, .028, .115, 10), light, [0, -.015, .048]); add(disc(.041, .014), dark, [0, .045, .048]);
        add(new CylinderGeometry(.035, .032, .04, 10), fabric, [0, -.015, .048]);
      }); break;
    }
    setOpacity(opacity); setSeated(seated);
  }
  function setOpacity(value: number) {
    opacity = value;
    for (const material of materials) {
      const transparent = value < .999;
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
      material.opacity = value; material.depthWrite = !transparent;
    }
  }
  function setSeated(value: boolean) {
    seated = value;
    for (const prop of handProps) prop.visible = !value;
    for (const prop of bulkyProps) prop.visible = !value;
  }
  return { apply, setOpacity, setSeated,
    dispose() {
      if (dead) return; dead = true; clear();
      for (const [mesh, original] of originals) { mesh.geometry = original.geometry; mesh.visible = original.visible; }
      sockets.forEach(socket => socket.removeFromParent());
    },
  };
}
