// Paid generation only through the project's resumable, capped fal client.
import { mkdir, writeFile } from 'node:fs/promises';
import { createFalClient } from '../fal.mjs';
import { stations, ads, talks } from './content.mjs';

process.env.FAL_MAX_USD = String(Math.min(30, Number(process.env.FAL_MAX_USD ?? 30)));
const prefix = 'tools/assets/cache/radio-jwxu/';
const recipes = [];
for (const station of stations) {
  station.tracks.forEach(([title, detail], i) => recipes.push({ title, kind: 'music', model: 'fal-ai/ace-step',
    input: { tags: `${station.style}, ${detail}`, lyrics: '[instrumental]', duration: 120, number_of_steps: 32, seed: 64000 + stations.indexOf(station) * 10 + i },
    estimatedUsd: 0.03, output: `${prefix}${station.id}-track-${i + 1}.wav` }));
  station.bits.forEach((prompt, i) => recipes.push({ title: `${station.host} ${i + 1}`, kind: 'dj', model: 'fal-ai/kokoro/american-english',
    input: { prompt, voice: station.voice, speed: station.speed }, estimatedUsd: 0.025,
    output: `${prefix}${station.id}-dj-${i + 1}.wav` }));
}
for (const [id, voice, prompt] of ads) recipes.push({ title: id, kind: 'ad', model: 'fal-ai/kokoro/american-english',
  input: { prompt, voice, speed: 1 }, estimatedUsd: 0.025, output: `${prefix}ad-${id}.wav` });
for (const [id, prompt] of talks) recipes.push({ title: id, kind: 'talk', model: 'fal-ai/kokoro/american-english',
  input: { prompt, voice: 'am_michael', speed: 1 }, estimatedUsd: 0.025, output: `${prefix}talk-${id}.wav` });

const estimate = recipes.reduce((sum, recipe) => sum + recipe.estimatedUsd, 0);
if (estimate > 15) throw new Error('Task estimate exceeds $15');
await mkdir('tools/art/radio', { recursive: true });
await writeFile('tools/art/radio/recipes.json', `${JSON.stringify(recipes, null, 2)}\n`);
console.log(`Radio plan: ${recipes.length} calls, conservative reservation $${estimate.toFixed(3)}; task cap $15, shared cap $30.`);
if (!process.argv.includes('--run')) process.exit(0);
const client = createFalClient();
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
for (const recipe of recipes) {
  if (only && !recipe.output.includes(only)) continue;
  const budget = await client.budget();
  const taskUsed = budget.calls.filter(call => call.output.startsWith(prefix)).reduce((sum, call) => sum + call.estimatedUsd, 0);
  const existing = budget.calls.some(call => call.output === recipe.output);
  if (!existing && taskUsed + recipe.estimatedUsd > 15) throw new Error('Radio task cap $15 reached');
  console.log(`Generating ${recipe.kind}: ${recipe.title} (reserved $${recipe.estimatedUsd})`);
  const result = await client.run(recipe);
  console.log(`${result.status}: ${recipe.output} (${result.bytes} bytes)`);
}
