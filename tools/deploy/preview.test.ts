import { expect, test, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parsePreviewArgs, previewFlags, previewCommands, assertPreviewCommand, assertPreviewProject, executePreviewCommand } from './preview.mjs';

test('preview can only build client and publish fixed preview Pages branch, never production services/data', async () => {
  const commit = 'a'.repeat(40), run = vi.fn(async () => {});
  const commands = previewCommands(commit);
  for (const command of commands) await executePreviewCommand(command, commit, run);
  expect(run.mock.calls).toHaveLength(3);
  expect(commands.map(command => command.tool)).toEqual(['node', 'vite', 'wrangler']);
  expect(commands[0]!.args).toEqual(['tools/changelog/build.mjs']);
  expect(commands[1]!.args).toEqual(['build', '--config', 'web/vite.staging.config.ts']);
  expect(commands[2]!.args).toEqual(['pages', 'deploy', 'dist-production', '--project-name', 'gtasf', '--branch', 'preview', '--commit-hash', commit]);
  expect(previewCommands(commit, true).map(command => command.tool)).toEqual(['node', 'vite']);
  for (const args of [
    ['deploy', '--config', 'worker/wrangler.production.jsonc'],
    ['deploy', '--dry-run'], ['d1', 'migrations', 'apply', 'DB', '--remote'],
    ['d1', 'execute', 'DB', '--remote'], ['r2', 'object', 'put', 'bucket/key'], ['secret', 'bulk'],
    [...commands[2]!.args.map(arg => arg === 'preview' ? 'main' : arg)],
    [...commands[2]!.args, '--branch', 'main'],
  ]) await expect(executePreviewCommand({ tool: 'wrangler', args, cwd: 'web' }, commit, run)).rejects.toThrow('Forbidden');
  for (const script of ['tools/events/export-seed.ts', 'tools/deploy/production/secrets.mjs', 'tools/deploy/production/prepare.ts', 'tools/map/src/pack/publication.ts']) {
    expect(() => assertPreviewCommand({ tool: 'node', args: [script], cwd: '.' }, commit)).toThrow('Forbidden');
  }
  expect(run.mock.calls).toHaveLength(3); // rejected commands never reach the process runner
  expect(() => assertPreviewProject({ name: 'gtasf', production_branch: 'preview' })).toThrow();
  expect(() => assertPreviewProject({ name: 'gtasf' })).toThrow();
  expect(() => assertPreviewProject({ name: 'gtasf', production_branch: 'main' })).not.toThrow();
  for (const option of ['--skip-map', '--skip-seed', '--branch', '--config', '--upload-secrets']) {
    expect(() => parsePreviewArgs(['--preview', option])).toThrow();
  }
  expect(parsePreviewArgs(['--preview', '--flags', 'groundTextures,graphicsV2', '--commit', 'HEAD', '--dry-run']))
    .toEqual({ revision: 'HEAD', dryRun: true, flags: ['graphicsV2', 'groundTextures'] });
  const source = 'export const flags = Object.freeze({ graphicsV2: false, hud: true, groundTextures: false, stripe: true } as const);';
  const policy = "const reviewed = new Set(['hud']);";
  expect(previewFlags(source, policy, ['groundTextures'])).toEqual({ graphicsV2: true, hud: true, groundTextures: true, stripe: false });
  expect(() => previewFlags(source, policy, ['typo'])).toThrow('Unknown');
  expect(() => previewFlags(source, 'const reviewed = getFlags();', [])).toThrow();
  // The CLI branches before production snapshot/config/secret/Worker operations, with no fallthrough.
  const entry = await readFile(new URL('./production/deploy.mjs', import.meta.url), 'utf8');
  expect(entry).toContain("if (args.includes('--preview')) {\n  await runPreview(args, root);\n} else {");
});
