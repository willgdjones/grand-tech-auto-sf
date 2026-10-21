// GTA V pivot — LANE B police presence (flag policePresence, critique #16): the police get a voice. A one-line DISPATCH
// radio ticker (with a squelch blip) each time a new star lands, and SFPD barks — speech lines from the officers and
// cruisers near you: arrest lines at 1★, combat lines from 2★ (when they shoot). With sampledAudio (critique #8) some barks
// are VOICED from Kenney's CC0 Voiceover Pack (PROVENANCE.md): the caption is then exactly what's said. Client-only, cosmetic.
import { flags } from '@gtasf/shared/flags';
import { playSample, type SampleName } from '../audio/samples';
import { audioContext, releaseAudioContext } from '../audio/context';

const DISPATCH: readonly (readonly string[])[] = [
  [],
  ['All units, report of a disturbance. Suspect last seen on foot.', 'Units in the area, be advised: possible 459 in progress.', 'Any unit, respond to a report of an armed suspect.'],
  ['Shots fired, shots fired. All available units respond.', 'Officers requesting backup. Suspect is armed and dangerous.', 'Code 3, all units: suspect fleeing, weapons authorised.'],
  ['Suspect has evaded units. Set up a perimeter, block all exits.', 'Roadblocks authorised. Repeat, roadblocks authorised.', 'All units converge. Do not let the suspect leave the district.'],
  ['Air unit SFPD-1 is up. Tracking the suspect from above.', 'Helicopter en route. Ground units hold the perimeter.', 'Air support on station, spotlight on the suspect.'],
  ['SWAT is rolling. Lethal force authorised.', 'Tactical units deployed. All units, weapons free.', 'This is a citywide alert. SWAT has command.'],
];
const ARREST = ['Freeze! SFPD!', 'Hands where I can see them!', 'On the ground, now!', 'You\'re under arrest!', 'Stop right there!'];
const COMBAT = ['Drop the weapon!', 'Shots fired! Take cover!', 'Suspect is armed!', 'Officer needs assistance!', 'Put it down, now!'];
const PULL_OVER = ['Pull over! Pull over now!', 'SFPD, stop the vehicle!', 'Pull it over to the side!'];
/** Voiced barks: the caption is the spoken line (no 'Freeze!' caption over a 'Get down!' voice). */
type Voiced = { text: string; sample: SampleName };
const ARREST_VOICED: readonly Voiced[] = [{ text: 'Hold!', sample: 'bark-hold' }, { text: 'Get down!', sample: 'bark-getdown' }];
const COMBAT_VOICED: readonly Voiced[] = [{ text: 'Get down!', sample: 'bark-getdown' }, { text: 'Look out!', sample: 'bark-lookout' }, { text: 'Call for backup!', sample: 'bark-backup' }];
const VOICED_SHARE = 0.6;

const BARK_MS = 2600, DISPATCH_MS = 4800, BARK_GAP_MS = 6500, OFFICER_RANGE_M = 22, CRUISER_RANGE_M = 35;

export interface PoliceBarks {
  /** A WANTED update from the server. */
  onWanted(level: number): void;
  /** Per frame: the nearest officer on foot / cruiser (metres, Infinity when none) and whether you're driving. */
  update(now: number, near: { officerM: number; cruiserM: number; inVehicle: boolean }): void;
  dispose(): void;
}

export function createPoliceBarks(parent: HTMLElement): PoliceBarks {
  const bark = document.createElement('div'); bark.className = 'gt-police-bark'; bark.hidden = true; bark.setAttribute('aria-live', 'polite');
  const dispatch = document.createElement('div'); dispatch.className = 'gt-dispatch'; dispatch.hidden = true; dispatch.setAttribute('aria-live', 'polite');
  parent.append(bark, dispatch);
  let level = 0, barkUntil = 0, dispatchUntil = 0, nextBarkAt = 0, lastLine = '';
  let audio: AudioContext | undefined;
  const pick = (lines: readonly string[]) => { // never the same line twice in a row
    const options = lines.filter(line => line !== lastLine);
    const line = options[Math.floor(Math.random() * options.length)] ?? lines[0]!;
    lastLine = line; return line;
  };
  function squelch(): void { // a short band-passed noise burst: the radio keying up
    try {
      audio ??= audioContext();
      if (audio.state === 'suspended') void audio.resume();
      const t = audio.currentTime, buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * .12), audio.sampleRate), data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const source = audio.createBufferSource(), band = audio.createBiquadFilter(), gain = audio.createGain();
      source.buffer = buffer; band.type = 'bandpass'; band.frequency.value = 1800; band.Q.value = 2.5; gain.gain.value = .06;
      source.connect(band).connect(gain).connect(audio.destination); source.start(t);
    } catch { /* no audio */ }
  }
  function say(element: HTMLElement, who: string, text: string): void {
    element.replaceChildren();
    const badge = document.createElement('b'); badge.textContent = who;
    element.append(badge, ` ${text}`); element.hidden = false;
  }
  return {
    onWanted(next) {
      const n = Math.max(0, Math.min(5, Math.floor(next)));
      if (n > level) {
        say(dispatch, 'DISPATCH', pick(DISPATCH[n] ?? DISPATCH[1]!));
        dispatchUntil = performance.now() + DISPATCH_MS; squelch();
        nextBarkAt = Math.max(nextBarkAt, performance.now() + 1200); // let the radio finish its first beat
      }
      level = n;
      if (n === 0) { bark.hidden = true; dispatch.hidden = true; }
    },
    update(now, near) {
      if (!bark.hidden && now >= barkUntil) bark.hidden = true;
      if (!dispatch.hidden && now >= dispatchUntil) dispatch.hidden = true;
      if (level === 0 || now < nextBarkAt) return;
      const lines = near.officerM <= OFFICER_RANGE_M ? (level >= 2 ? COMBAT : ARREST)
        : near.cruiserM <= CRUISER_RANGE_M ? (near.inVehicle ? PULL_OVER : level >= 2 ? COMBAT : ARREST) : null;
      if (!lines) return;
      // A voiced bark when the officer is close enough to hear (a cruiser's crew shouts too), at a distance-scaled volume.
      const voiced = lines === ARREST ? ARREST_VOICED : lines === COMBAT ? COMBAT_VOICED : null;
      const distance = Math.min(near.officerM, near.cruiserM), range = near.officerM <= OFFICER_RANGE_M ? OFFICER_RANGE_M : CRUISER_RANGE_M;
      const line = flags.sampledAudio && voiced && Math.random() < VOICED_SHARE ? voiced[Math.floor(Math.random() * voiced.length)]! : null;
      if (line && playSample(line.sample, { volume: 0.25 + 0.55 * Math.max(0, 1 - distance / range), rate: 0.97 + Math.random() * 0.06 })) { lastLine = line.text; say(bark, 'SFPD', line.text); }
      else say(bark, 'SFPD', pick(lines));
      barkUntil = now + BARK_MS; nextBarkAt = now + BARK_GAP_MS + Math.random() * 2500;
    },
    dispose() { bark.remove(); dispatch.remove(); releaseAudioContext(audio); },
  };
}
