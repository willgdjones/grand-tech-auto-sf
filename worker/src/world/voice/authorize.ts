// WS VOICE_PUBLISH is only a claim: the world accepts it when the Worker voice proxy (gtasf-bdzy,
// worker/src/voice/realtime.ts) authorised exactly this {sessionId, trackName} for this device after its
// verified-email / ban / rate gate (voiceTrackState in worker/src/voice/store.ts). refuseVoice is the
// flag-off default.
import type { VoiceState } from '@gtasf/shared/protocol/types';

export type VoiceAuthorizer = (deviceId: string | undefined, sessionId: string, trackName: string,
  intent: 'publish' | 'recheck') => Promise<VoiceState>;

export const refuseVoice: VoiceAuthorizer = async () => 'refused-off';
