import { expect, test, vi } from 'vitest';
import { smokeAdmission } from './smokeAdmission.mjs';

test('public release requires anonymous admission and never reads an invite secret', async () => {
  const read = vi.fn().mockRejectedValue(new Error('No invite file'));
  expect(await smokeAdmission({ launchMode: 'open', allowed: true }, read)).toEqual({ mode: 'open', code: '' });
  expect(read).not.toHaveBeenCalled();
  await expect(smokeAdmission({ launchMode: 'open', allowed: false }, read)).rejects.toThrow('Anonymous admission');
});
test('invite release requires a gate and loads the invite only in that mode', async () => {
  const read = vi.fn().mockResolvedValue(' fixture-code\n');
  expect(await smokeAdmission({ launchMode: 'invite', allowed: false }, read)).toEqual({ mode: 'invite', code: 'fixture-code' });
  expect(read).toHaveBeenCalledOnce();
  await expect(smokeAdmission({ launchMode: 'invite', allowed: true }, read)).rejects.toThrow('Anonymous admission');
});
test('waitlist and malformed responses cannot silently skip admission checks', async () => {
  for (const config of [null, {}, { launchMode: 'waitlist', allowed: false }]) {
    await expect(smokeAdmission(config, vi.fn())).rejects.toThrow('Playable release');
  }
});
test('missing or empty invite configuration fails invite smoke', async () => {
  await expect(smokeAdmission({ launchMode: 'invite', allowed: false }, async () => '  ')).rejects.toThrow('nonempty');
  await expect(smokeAdmission({ launchMode: 'invite', allowed: false }, async () => { throw new Error('missing'); })).rejects.toThrow('missing');
});
