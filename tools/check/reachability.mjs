#!/usr/bin/env node
/**
 * Reachability guard (gtasf-77nf). PLAN-v2 requires "every feature reachable in the game", yet the
 * overnight review found three features shipped dark — a built module that main.ts never calls
 * (whatsNew H3, angelInvestors M5, venues H4). This static check catches that class before the
 * playtest: it parses the enabled flags from shared/flags.ts and, for a curated map of client
 * features, confirms the entry point is actually wired in web/src.
 *
 * Fast, dependency-free, no browser/build. Report-only by default; `--strict` exits 1 on any
 * enabled-but-DARK feature so a pre-deploy/CI step can gate on it.
 *
 *   node tools/check/reachability.mjs            # print the report
 *   node tools/check/reachability.mjs --strict   # also fail on an enabled dark feature
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const strict = process.argv.includes('--strict');

// Enabled/disabled flags from the frozen object literal in shared/flags.ts.
const flagsSrc = readFileSync(resolve(root, 'shared/flags.ts'), 'utf8');
const flags = {};
for (const m of flagsSrc.matchAll(/(?:^|[\s,{])([a-zA-Z][a-zA-Z0-9]*)\s*:\s*(true|false)\b/g)) flags[m[1]] = m[2] === 'true';

// Curated client-feature reachability map.
//  kind 'module'  — the entry symbol must be referenced in `where` (default web/src/main.ts).
//  kind 'flagref' — `flags.<flag>` must be consumed somewhere under web/src (outside tests).
const CHECKS = [
  { flag: 'changelog', kind: 'module', symbol: 'createWhatsNew' },
  { flag: 'eventSubmission', kind: 'module', symbol: 'createEventSubmit' },
  { flag: 'feedback', kind: 'module', symbol: 'createFeedback' },
  { flag: 'fundDrops', kind: 'module', symbol: 'createDropsClient' },
  { flag: 'celebNpcs', kind: 'module', symbol: 'createAngelInvestors' },
  { flag: 'capTable', kind: 'module', symbol: 'createCapTable' },
  { flag: 'becomeAnAngel', kind: 'module', symbol: 'createBecomeAnAngel' },
  { flag: 'voiceChat', kind: 'module', symbol: 'createVoiceChat', where: 'web/src/chat/client.ts' },
  { flag: 'characterLooks', kind: 'flagref' },
  { flag: 'driveThroughFunding', kind: 'flagref' },
  { flag: 'saMapStyle', kind: 'flagref' },
  { flag: 'venueGrouping', kind: 'flagref' },
  { flag: 'eventFocus24h', kind: 'flagref' },
];

/** Count non-test .ts files under `path` that contain the fixed string `needle`. */
function fileHits(needle, path) {
  try {
    const out = execFileSync('grep', ['-rlF', '--include=*.ts', '--', needle, path], { cwd: root, encoding: 'utf8' });
    return out.split('\n').filter(line => line && !line.includes('.test.') && line !== 'shared/flags.ts');
  } catch {
    return []; // grep exits non-zero when there is no match
  }
}

let dark = 0;
const rows = [];
for (const check of CHECKS) {
  let status, detail;
  if (!(check.flag in flags)) { status = 'MISSING'; detail = `no '${check.flag}' key in shared/flags.ts`; }
  else if (!flags[check.flag]) { status = 'OFF'; detail = 'flag disabled'; }
  else if (check.kind === 'module') {
    const where = check.where ?? 'web/src/main.ts';
    const wired = fileHits(check.symbol, where).length > 0;
    status = wired ? 'WIRED' : 'DARK';
    detail = `${check.symbol}() ${wired ? 'called in' : 'NOT called in'} ${where}`;
  } else {
    const hits = fileHits(`flags.${check.flag}`, 'web/src');
    status = hits.length > 0 ? 'WIRED' : 'DARK';
    detail = `flags.${check.flag} ${hits.length ? `consumed in web/src (${hits.length} file${hits.length === 1 ? '' : 's'})` : 'NOT consumed in web/src'}`;
  }
  if (status === 'DARK') dark++;
  rows.push({ flag: check.flag, status, detail });
}

const pad = (s, n) => String(s).padEnd(n);
console.log('Feature reachability — enabled flags must have a wired client entry point:\n');
for (const r of rows) console.log(`  ${pad(r.status, 8)} ${pad(r.flag, 22)} ${r.detail}`);
const unchecked = Object.keys(flags).filter(f => !CHECKS.some(c => c.flag === f));
console.log(`\n${rows.length} checked · ${dark} DARK · ${unchecked.length} flags outside the client-feature map.`);
if (dark && strict) {
  console.error(`\nFAIL: ${dark} enabled feature(s) are DARK (built but not reachable in the game).`);
  process.exit(1);
}
