import type { ArtEntry } from './ledger';
export interface FalRecipe {
  model: string;
  input: Record<string, unknown>;
  estimatedUsd: number;
  output: string;
  resultPath?: string;
}
export interface FalEntry extends ArtEntry { provider: 'fal'; estimatedUsd: number; statusUrl?: string; responseUrl?: string }
export function createFalClient(options?: {
  root?: string;
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  pollMs?: number;
  timeoutMs?: number;
}): {
  run(recipe: FalRecipe): Promise<FalEntry>;
  resume(id: string): Promise<FalEntry>;
  budget(): Promise<{ capUsd: number; reservedUsd: number; remainingUsd: number; calls: Array<Pick<FalEntry, 'id' | 'model' | 'status' | 'estimatedUsd' | 'output'>> }>;
};
