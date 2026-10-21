import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { flags } from '@gtasf/shared/flags';

// Generates local files only. Provisioning and deployment remain explicit later actions.
const root = fileURLToPath(new URL('../../', import.meta.url));
const resources = JSON.parse(await readFile(new URL('./staging-resources.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--d1-id' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(args[1] ?? '')
  || args[1] === '00000000-0000-0000-0000-000000000000') throw new Error('Usage: tsx tools/deploy/prepare-staging.ts --d1-id <actual GTASF staging D1 UUID>');
const output = join(root, 'worker/.wrangler/staging');
const flagPath = join(output, 'flags.ts');
const config = {
  $schema: join(root, 'node_modules/wrangler/config-schema.json'),
  name: resources.worker, account_id: resources.accountId,
  main: join(root, 'worker/src/index.ts'), compatibility_date: '2026-09-28', compatibility_flags: ['nodejs_compat'],
  workers_dev: true, vars: { ENVIRONMENT: 'staging' },
  alias: { '@gtasf/shared/flags': flagPath },
  routes: ['/api/*', '/claim/*'].map(path => ({ pattern: resources.hostname + path, zone_name: 'gtasf.com' })),
  durable_objects: { bindings: [{ name: 'WORLD', class_name: 'WorldDO' }, { name: 'LEDGER', class_name: 'LedgerDO' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['WorldDO', 'LedgerDO'] }],
  d1_databases: [{ binding: 'DB', database_name: resources.d1.name, database_id: args[1], migrations_dir: join(root, 'worker/migrations') }],
  r2_buckets: [{ binding: 'ASSETS', bucket_name: resources.r2 }],
  queues: { producers: [{ binding: 'JOBS', queue: resources.queue }], consumers: [{ queue: resources.queue, max_batch_size: 10, max_retries: 3 }] },
  // No jobs produced before their owning beads pass and flags are deliberately enabled.
  triggers: { crons: [] },
};
await mkdir(output, { recursive: true });
await writeFile(flagPath, `// Staging starts with every feature disabled. Enable only reviewed integrations.\nexport const flags = Object.freeze(${JSON.stringify(Object.fromEntries(Object.keys(flags).map(name => [name, false])), null, 2)});\nexport type Feature = keyof typeof flags;\n`);
await writeFile(join(output, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n');
console.log('Prepared worker/.wrangler/staging/wrangler.json and flags.ts; no remote resource was created or deployed.');
