import { readFile } from 'node:fs/promises';
import { generate, status } from './scenario.js';
import type { Recipe } from './scenario.js';

try {
  const [command, path, chosen] = process.argv.slice(2);
  if (command === 'status') console.log(JSON.stringify(await status(), null, 2));
  else if ((command === 'generate' || command === 'quote') && path) {
    const recipes = JSON.parse(await readFile(path, 'utf8')) as Recipe[];
    const selected = chosen ? recipes.filter(r => r.name === chosen) : recipes;
    if (!selected.length) throw new Error('No matching recipe');
    for (const recipe of selected) {
      const result = await generate(recipe, command === 'quote');
      const summary = command === 'quote' ? result : {
        id: result.id, model: result.model, status: result.status, output: result.output,
        jobId: result.jobId, estimatedCredits: result.estimatedCredits,
        actualCredits: result.actualCredits, usd: typeof result.actualCredits === 'number' ? result.actualCredits * result.usdPerCredit : undefined,
        bytes: result.bytes, sha256: result.sha256,
      };
      console.log(JSON.stringify({ name: recipe.name, result: summary }, null, 2));
      if (command === 'generate') console.log(JSON.stringify({ totals: (await status()).totals }));
    }
  } else throw new Error('Usage: node --import tsx tools/art/cli.ts status | quote|generate RECIPE.json [NAME]');
} catch (e) { console.error(e instanceof Error ? e.message : 'Art command failed'); process.exitCode = 1; }
