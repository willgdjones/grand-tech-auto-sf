import { flags } from '@gtasf/shared/flags';
import type { AngelInvestors, PitchResult } from '../render/angelInvestors';
import type { createFundingClient } from './client';

type FundingClient = NonNullable<ReturnType<typeof createFundingClient>>;

/** Keep E-to-pitch retryable until the authoritative funding response arrives. */
export function createAngelPitch(options: {
  angels: Pick<AngelInvestors, 'pitchedIds' | 'setPitched'>;
  funding: Pick<FundingClient, 'pitchCelebrity'> | null;
  persist(ids: string[]): void;
  onReply(result: PitchResult, firstTime: boolean): void;
  onError(message: string): void;
}) {
  const pending = new Map<string, Promise<void>>();
  let disposed = false;

  async function submit(result: PitchResult): Promise<void> {
    if (disposed) return;
    try {
      if (!options.funding) throw new Error('Funding is unavailable. Try pitching again in a moment.');
      const response = await options.funding.pitchCelebrity(result.npc.id);
      if (disposed) return;
      if (!response.pitchedIds.includes(result.npc.id)) throw new Error('Pitch not confirmed. Press E to try again.');
      // Another investor may confirm while this response is in flight. Preserve both records.
      const ids = [...new Set([...options.angels.pitchedIds(), ...response.pitchedIds])];
      options.angels.setPitched(ids);
      try { options.persist(ids); } catch { /* Server state survives unavailable browser storage. */ }
      options.onReply(result, response.firstTime);
    } catch (error) {
      if (!disposed) options.onError(error instanceof Error && !(error instanceof TypeError)
        ? error.message : 'Pitch could not connect. Press E to try again.');
    } finally { pending.delete(result.npc.id); }
  }

  return {
    pitch(result: PitchResult): Promise<void> {
      if (disposed || !flags.celebNpcs || !result.firstTime) return Promise.resolve();
      const existing = pending.get(result.npc.id);
      if (existing) return existing;
      // Start after storing the promise so even an immediate failure releases its pending entry.
      const work = Promise.resolve().then(() => submit(result));
      pending.set(result.npc.id, work);
      return work;
    },
    dispose() { disposed = true; pending.clear(); },
  };
}
