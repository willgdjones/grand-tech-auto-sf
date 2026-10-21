import { type Group, type Mesh, MeshBasicMaterial, type MeshLambertMaterial } from 'three';
import { Parts, lettering } from './primitives';

/**
 * VC office monument sign — the "you've arrived at <Firm>" marker the robotaxi drops the player at. The pitch
 * ladder sends players by robotaxi to real VC offices (shared/content/pitchVcs.ts), but those were visually
 * unmarked generic buildings; this plants a kerb-level monument so the arrival reads as a real firm's office.
 *
 * The WHOLE sign is UNLIT (MeshBasic, toneMapped off): a LIGHT STONE slab with DARK engraved letters, so the name
 * stays high-contrast and readable on HD and Low in any light — a lit dark slab washed to near-black in the office
 * canyons' deep shadow and the thin letters vanished on phone. Unlit holds both tones at face value (its own Low
 * floor). Orientation-robust: the name is on both broad faces (the back is a 180-degree clone of the front mesh),
 * so it reads whichever way the robotaxi approaches. A thin per-firm accent stripe sits clear above the name.
 */
function accentColour(id: string): string {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 58% 52%)`;
}
function nameLines(raw: string): string[] {
  const words = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words;
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}
function unlit(group: Group, name: string): Mesh | undefined {
  const mesh = group.children[0] as Mesh | undefined;
  if (mesh) {
    (mesh.material as MeshLambertMaterial).dispose?.();
    mesh.material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    mesh.name = name;
  }
  return mesh;
}

export function createVcOfficeSign(firmName: string, id = firmName): Group {
  const p = new Parts();
  const STONE = '#c6c0b1', BASE = '#aaa493', EDGE = '#8d8779', NAME = '#282b25';
  const accent = accentColour(id);
  const W = 3.0, H = 3.7, THICK = 0.34;

  // Light-stone monument: plinth + slab + a darker stone edge frame + top cap.
  p.box([0, 0.3, 0], [W + 0.5, 0.6, 1.0], BASE);
  p.box([0, 0.9 + H / 2, 0], [W, H, THICK], STONE);
  for (const sx of [-1, 1]) p.box([sx * (W / 2 - 0.04), 0.9 + H / 2, 0], [0.08, H, THICK + 0.02], EDGE);
  p.box([0, 0.9 + H + 0.05, 0], [W + 0.06, 0.14, THICK + 0.04], EDGE);
  const slabGroup = p.finish('VC office sign');
  unlit(slabGroup, 'VC office sign slab');   // light stone stays light in shadow

  // Unlit FRONT face (+Z): a thin per-firm accent stripe clear above the name, then the firm name (1–2 lines) in
  // dark engraved letters. The back face is a 180-degree clone so the whole thing reads from either approach.
  const s = new Parts();
  const lines = nameLines(firmName);
  const top = 0.9 + H, z = THICK / 2 + 0.02;
  s.box([0, top - 0.42, z], [W - 0.5, 0.12, 0.03], accent);              // accent stripe, above the name
  lines.forEach((line, i) => {
    const h = Math.min(0.5, (W - 0.46) / Math.max(1, line.length * 0.92));  // scale to fit the slab width
    const cy = top - 1.25 - (i - (lines.length - 1) / 2) * (h * 1.6);
    lettering(s, line, 0, cy, z, h, NAME);
  });
  const mesh = unlit(s.finish('VC office sign face'), 'VC office sign face geometry');
  if (mesh) {
    slabGroup.add(mesh);
    const back = mesh.clone();
    back.rotation.y = Math.PI;              // read correctly from the -Z approach
    back.name = 'VC office sign face back';
    slabGroup.add(back);
  }
  slabGroup.userData.solidFootprints = [{ minX: -(W + 0.5) / 2, maxX: (W + 0.5) / 2, minZ: -0.6, maxZ: 0.6 }];
  slabGroup.userData.walkableSurfaces = [{ minX: -(W + 0.5) / 2 - 2, maxX: (W + 0.5) / 2 + 2, minZ: -2.6, maxZ: 2.6, y: 0 }];
  return slabGroup;
}
