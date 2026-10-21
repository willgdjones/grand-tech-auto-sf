import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import ts from 'typescript';
import { cloudflare, ACCOUNT } from './production/api.mjs';

export const PREVIEW_BRANCH = 'preview';
export const PREVIEW_URL = 'https://preview.gtasf.pages.dev';
export function parsePreviewArgs(args) {
  let revision = 'HEAD', dryRun = false;
  const flags = new Set(['graphicsV2']);
  if (!args.includes('--preview')) throw new Error('Preview mode requires --preview');
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--preview') continue;
    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg !== '--commit' && arg !== '--flags') throw new Error(`Unsafe or unknown preview option: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`);
    if (arg === '--commit') revision = value;
    else for (const name of value.split(',')) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error(`Invalid preview flag: ${name}`);
      flags.add(name);
    }
  }
  return { revision, dryRun, flags: [...flags] };
}

// Parse only literal policy data. Never execute production prepare.ts (it reads secrets and
// generates Worker/D1/R2 configuration). Fail closed if the policy stops being a literal Set.
function initializer(source, name) {
  const file = ts.createSourceFile('policy.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = file.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations]);
  const value = declarations.find(d => ts.isIdentifier(d.name) && d.name.text === name)?.initializer;
  if (!value) throw new Error(`Missing literal ${name} policy`);
  return value;
}
function unwrap(value) {
  while (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value)) value = value.expression;
  return value;
}
export function previewFlags(flagsSource, prepareSource, extra) {
  let object = unwrap(initializer(flagsSource, 'flags'));
  if (ts.isCallExpression(object) && object.expression.getText() === 'Object.freeze' && object.arguments.length === 1) object = unwrap(object.arguments[0]);
  if (!ts.isObjectLiteralExpression(object)) throw new Error('Expected literal source flags');
  const known = new Set();
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) throw new Error('Nonliteral source flag');
    const value = unwrap(property.initializer);
    if (value.kind !== ts.SyntaxKind.TrueKeyword && value.kind !== ts.SyntaxKind.FalseKeyword) throw new Error('Nonboolean source flag');
    if (known.has(property.name.text)) throw new Error('Duplicate source flag');
    known.add(property.name.text);
  }
  const reviewed = initializer(prepareSource, 'reviewed');
  if (!ts.isNewExpression(reviewed) || reviewed.expression.getText() !== 'Set' || reviewed.arguments?.length !== 1 || !ts.isArrayLiteralExpression(reviewed.arguments[0])) throw new Error('Expected literal reviewed Set');
  const enabled = new Set();
  for (const item of reviewed.arguments[0].elements) {
    if (!ts.isStringLiteral(item)) throw new Error('Nonliteral reviewed flag');
    enabled.add(item.text);
  }
  for (const name of ['graphicsV2', ...extra]) enabled.add(name);
  for (const name of enabled) if (!known.has(name)) throw new Error(`Unknown preview flag: ${name}`);
  return Object.fromEntries([...known].map(name => [name, enabled.has(name)]));
}

export function previewCommands(commit, dryRun = false) {
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Preview requires a resolved Git commit');
  return [
    { tool: 'node', args: ['tools/changelog/build.mjs'], cwd: '.' },
    { tool: 'vite', args: ['build', '--config', 'web/vite.staging.config.ts'], cwd: '.' },
    ...dryRun ? [] : [{ tool: 'wrangler', args: ['pages', 'deploy', 'dist-production', '--project-name', 'gtasf', '--branch', PREVIEW_BRANCH, '--commit-hash', commit], cwd: 'web' }],
  ];
}
export function assertPreviewCommand(command, commit) {
  // Exact allowlist: no Worker deploy (even dry-run), D1, seed, R2, secret upload, npm hooks,
  // arbitrary executable/arguments, production branch, or extra CLI switches can pass here.
  if (!previewCommands(commit).some(allowed => JSON.stringify(allowed) === JSON.stringify(command))) throw new Error('Forbidden preview command');
}
export function assertPreviewProject(project) {
  if (project.name !== 'gtasf' || typeof project.production_branch !== 'string' || project.production_branch === PREVIEW_BRANCH) throw new Error('Preview branch must not be the Pages production branch');
}
export async function executePreviewCommand(command, commit, run) {
  assertPreviewCommand(command, commit);
  await run(command);
}

export async function runPreview(args, root) {
  const options = parsePreviewArgs(args);
  const commit = execFileSync('git', ['rev-parse', '--verify', `${options.revision}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
  const commands = previewCommands(commit, options.dryRun);
  const snapshot = await mkdtemp(join(tmpdir(), 'gtasf-preview-'));
  execFileSync('git', ['archive', '--format=tar', `--output=${join(snapshot, 'source.tar')}`, commit], { cwd: root });
  execFileSync('tar', ['-xf', 'source.tar'], { cwd: snapshot });
  await mkdir(join(snapshot, 'node_modules/@gtasf'), { recursive: true });
  for (const entry of await readdir(join(root, 'node_modules'))) {
    if (entry !== '@gtasf') await symlink(join(root, 'node_modules', entry), join(snapshot, 'node_modules', entry));
  }
  for (const workspace of ['shared', 'web', 'worker', 'tools']) {
    const metadata = JSON.parse(await readFile(join(snapshot, workspace, 'package.json'), 'utf8'));
    await symlink(join(snapshot, workspace), join(snapshot, 'node_modules', metadata.name));
  }
  const selected = previewFlags(await readFile(join(snapshot, 'shared/flags.ts'), 'utf8'),
    await readFile(join(snapshot, 'tools/deploy/production/prepare.ts'), 'utf8'), options.flags);
  await mkdir(join(snapshot, '.preview-build'));
  await writeFile(join(snapshot, '.preview-build/flags.ts'), `export const flags = Object.freeze(${JSON.stringify(selected, null, 2)});\nexport type Feature = keyof typeof flags;\n`);
  // The sole Pages service binding routes browser API/map traffic to the EXISTING game Worker.
  // No D1/R2 bindings, secrets, or production Pages configuration are read/copied/patched.
  const services = [{ binding: 'API', service: 'gtasf-production' }];
  await writeFile(join(snapshot, 'web/wrangler.jsonc'), JSON.stringify({ name: 'gtasf', pages_build_output_dir: './dist-production',
    compatibility_date: '2026-09-28', services, env: { preview: { services } } }, null, 2));
  const environment = { ...process.env, GTASF_FLAGS_FILE: '.preview-build/flags.ts',
    NODE_TLS_REJECT_UNAUTHORIZED: '1', CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CI: 'true' };
  // Only the explicitly enabled Google Tiles spike receives its browser-restricted key.
  // Never copy .env/.dev.vars or log its value; other VITE_* keys remain excluded.
  for (const key of Object.keys(environment)) {
    if (key.startsWith('VITE_') && !(selected.googleTiles && key === 'VITE_GOOGLE_MAPS_KEY')) delete environment[key];
  }
  const run = command => new Promise((done, fail) => {
    const executable = command.tool === 'node' ? process.execPath : join(snapshot, 'node_modules/.bin', command.tool);
    const child = spawn(executable, command.args, { cwd: resolve(snapshot, command.cwd), env: environment, stdio: 'inherit' });
    child.once('error', fail); child.once('exit', code => code === 0 ? done() : fail(new Error(`Preview ${command.tool} failed (${code}); snapshot: ${snapshot}`)));
  });
  console.log(`Preview source: ${commit}\nIsolated build: ${snapshot}\nExtra flags: ${options.flags.join(', ')}\nTarget: ${PREVIEW_URL}`);
  for (const command of commands) {
    if (command.tool === 'wrangler') {
      // Read-only check immediately before publish; never PATCH the Pages project or its bindings.
      assertPreviewProject(await cloudflare(`/accounts/${ACCOUNT}/pages/projects/gtasf`));
    }
    await executePreviewCommand(command, commit, run);
    if (command.tool === 'vite') {
      await copyFile(join(snapshot, 'tools/deploy/production/pages-worker.js'), join(snapshot, 'web/dist-production/_worker.js'));
      await writeFile(join(snapshot, 'web/dist-production/_routes.json'), JSON.stringify({ version: 1, include: ['/api/*', '/map/*'], exclude: [] }));
      await writeFile(join(snapshot, 'web/dist-production/_headers'), '/*\n  Referrer-Policy: same-origin\n  X-Content-Type-Options: nosniff\n  X-Robots-Tag: noindex\n');
    }
  }
  console.log(options.dryRun ? `Preview web build ready at ${snapshot}; no remote calls.` : `Preview published: ${PREVIEW_URL}. Production Worker and data untouched by this deploy.`);
}
