/**
 * Living map pitching hint (flag pitching, gtasf-y5vc): when the player is on foot within reach of a celeb angel or a VC
 * office (the same targets and radii the server judges: worker/src/pitch/pitch.ts), show "Hold 🎙 to pitch <name>".
 * Checked twice a second, not per frame; one small DOM chip.
 */
import { PITCH_VCS } from '@gtasf/shared/content/pitchVcs';
import { projectLocation, type MapFrame } from '../radar/projection';
import { angelSpots } from '@gtasf/shared/content/angels';
import { flags } from '@gtasf/shared/flags';
import './hint.css';

const ANGEL_M = 8, VC_M = 15;
export function createPitchHint(options: { frame: MapFrame; position(): { x: number; z: number } | null; touch: boolean; parent: HTMLElement }) {
  // gtasf-y5vc: no "Hold V to pitch <celeb>" for real-person celebrity NPCs — they are not voice-pitch
  // targets (pitch.ts pitchSpots). Only VC/accelerator offices and (under angelNpcs) fictional roaming angels.
  const spots = PITCH_VCS.map(v => ({ name: v.name, r: VC_M, ...projectLocation(v.lat, v.lon, options.frame) }));
  const chip = document.createElement('div'); chip.className = 'gt-pitch-hint'; chip.hidden = true; chip.setAttribute('role', 'status');
  options.parent.append(chip);
  let shown = '';
  const timer = setInterval(() => {
    const p = options.position();
    // Roaming angels (flags.angelNpcs) stand at a stop that changes every 20 minutes.
    const all = flags.angelNpcs ? [...spots, ...angelSpots(Date.now()).map(a => ({ name: a.angel.name, r: ANGEL_M, x: a.stop.x, z: a.stop.z }))] : spots;
    const near = p ? all.filter(s => Math.hypot(s.x - p.x, s.z - p.z) <= s.r).sort((a, b) => Math.hypot(a.x - p!.x, a.z - p!.z) - Math.hypot(b.x - p!.x, b.z - p!.z))[0] : undefined;
    const text = near ? `${options.touch ? 'Hold 🎙' : 'Hold V'} to pitch ${near.name}` : '';
    if (text === shown) return;
    shown = text; chip.textContent = text; chip.hidden = !text;
  }, 500);
  return { active: () => shown !== '', dispose() { clearInterval(timer); chip.remove(); } };
}
