import assert from 'node:assert/strict';

/** Read admission without cookies first: public smoke must prove entry without an invite. */
export async function smokeAdmission(config, readInvite) {
  assert.ok(config?.launchMode === 'open' || config?.launchMode === 'invite', 'Playable release requires open or invite launch mode');
  const needsInvite = config.launchMode === 'invite';
  assert.equal(config.allowed, !needsInvite, 'Anonymous admission must match launch mode');
  const code = needsInvite ? (await readInvite()).trim() : '';
  if (needsInvite) assert.ok(code, 'Invite-mode smoke requires a nonempty invite code');
  return { mode: config.launchMode, code };
}
