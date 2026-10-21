import { flags } from '@gtasf/shared/flags';

const KEY = 'gtasf.voice';
/** Hidden launch gate (flags.voicePublic off): voice UI/routes are active only in a tab opened with ?voice=1,
 *  remembered in sessionStorage for that tab. With voicePublic on, every proximityVoice client gets voice. */
export function voiceGateOpen(): boolean {
  if (!flags.proximityVoice) return false;
  if (flags.voicePublic) return true;
  try {
    if (new URLSearchParams(location.search).get('voice') === '1') sessionStorage.setItem(KEY, '1');
    return sessionStorage.getItem(KEY) === '1';
  } catch { return new URLSearchParams(location.search).get('voice') === '1'; }
}
/** Header the gated client sends on /api/voice/* so the worker can apply the same gate. */
export const VOICE_GATE_HEADER = 'X-GTASF-Voice';
