export function smokeAdmission(
  config: unknown,
  readInvite: () => Promise<string>,
): Promise<{ mode: 'open' | 'invite'; code: string }>;
