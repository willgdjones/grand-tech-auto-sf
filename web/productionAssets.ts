import { access, readFile, readdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import ts from 'typescript';

/** Read literal booleans without executing a deployment's module. Any spread,
 * duplicate key or unrecognised initializer retains the conditional asset packs.
 */
function literalFlags(source: string): Record<string, boolean | undefined> {
  const file = ts.createSourceFile('flags.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = file.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'flags');
  let value = declarations.length === 1 ? declarations[0]!.initializer : undefined;
  while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value))) value = value.expression;
  if (value && ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)
    && ts.isIdentifier(value.expression.expression) && value.expression.expression.text === 'Object'
    && value.expression.name.text === 'freeze' && value.arguments.length === 1) value = value.arguments[0];
  while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value))) value = value.expression;
  if (!value || !ts.isObjectLiteralExpression(value)) return {};
  const result: Record<string, boolean | undefined> = Object.create(null);
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property) || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
      || Object.hasOwn(result, property.name.text)) return {};
    result[property.name.text] = property.initializer.kind === ts.SyntaxKind.FalseKeyword ? false
      : property.initializer.kind === ts.SyntaxKind.TrueKeyword ? true : undefined;
  }
  return result;
}

async function treeBytes(path: string): Promise<number> {
  const info = await stat(path).catch(() => undefined);
  if (!info) return 0;
  if (!info.isDirectory()) return info.size;
  let bytes = 0;
  for (const name of await readdir(path)) bytes += await treeBytes(resolve(path, name));
  return bytes;
}

/** Authoring inputs stay in public for the art tools; only packed runtime images ship. */
export function runtimeAssetsOnly(): Plugin {
  let output = '', publicDir = '', root = '';
  let compiledFlags: Record<string, boolean | undefined> = {}, flagsId = '';
  return {
    name: 'gtasf-runtime-assets-only', apply: 'build',
    configResolved(config) {
      root = resolve(config.root); output = resolve(config.root, config.build.outDir);
      publicDir = config.publicDir ? resolve(config.publicDir) : '';
    },
    async buildStart() {
      // Vite resolution sees the exact deployment alias, so local flags cannot
      // accidentally strip assets from a reviewed realistic-render build.
      const module = await this.resolve('@gtasf/shared/flags', resolve(root, 'src/main.ts'), { skipSelf: true });
      compiledFlags = module && !module.external
        ? literalFlags(await readFile(module.id, 'utf8').catch(() => '')) : {};
      flagsId = module && !module.external ? module.id : '';
    },
    // Re-read the flags from the code actually bundled: a capture build's enforce:'pre' transform can force flags
    // without touching the file (tools/_buildcap.mjs FORCE_FLAGS). Identical to the file in production builds.
    transform(code, id) { if (id === flagsId) compiledFlags = literalFlags(code); return null; },
    async writeBundle() {
      if (!publicDir) return;
      if (output === root || output === publicDir || output.startsWith(publicDir + '/')) {
        throw new Error('Refusing to prune authoring assets inside the source/public directory');
      }
      let removedBytes = 0;
      async function omit(relative: string) {
        const path = resolve(output, relative); removedBytes += await treeBytes(path);
        await rm(path, { recursive: true, force: true });
      }
      // gtasf-tr62l: one DataSF street-tree set ships, the one streetProps fetches (treesOffCarriageway picks the filtered file).
      await omit(compiledFlags.treesOffCarriageway === true ? 'art/trees/street-trees.bin' : 'art/trees/street-trees-offroad.bin');
      // The facade runtime reads manifest.json and packed JPG atlases, never src/.
      await omit('art/facades-pbr/src');
      // Match every consumer gate, independently of the runtime quality preset.
      if (compiledFlags.realisticRender === false) await omit('assets/vehicles-pbr');
      if (compiledFlags.realisticRender === false || compiledFlags.realisticFacades === false) await omit('art/facades-pbr');
      // Storefront pieces also have a non-realistic-render consumer in buildingDetail.
      if (compiledFlags.realisticFacades === false || compiledFlags.storefrontPieces === false) await omit('assets/facades-pbr');
      // CC0 pedestrian bodies (web/src/avatar/people.ts PEOPLE_BODIES): only loaded when cc0People is on.
      if (compiledFlags.cc0People === false) for (const id of ['business-man', 'casual-woman', 'casual-man', 'formal-woman', 'worker-man', 'beach-man', 'punk-woman', 'punk-man']) await omit(`assets/avatars/${id}.glb`);
      // Only the VAT set the build uses ships: crowd-vat.* (CC0) or crowd-vat-meshy* (meshyPeople).
      if (compiledFlags.crowdVat === false || compiledFlags.meshyPeople === true) { await omit('assets/avatars/crowd-vat.bin'); await omit('assets/avatars/crowd-vat.json'); }
      if (compiledFlags.crowdVat === false || compiledFlags.meshyPeople === false) for (const file of await readdir(resolve(output, 'assets/avatars')).catch(() => [] as string[])) if (file.startsWith('crowd-vat-meshy')) await omit(`assets/avatars/${file}`);
      // meshyPeople replaces the CC0 bodies, so they don't ship alongside it.
      if (compiledFlags.meshyPeople === true) for (const id of ['business-man', 'casual-woman', 'casual-man', 'formal-woman', 'worker-man', 'beach-man', 'punk-woman', 'punk-man']) await omit(`assets/avatars/${id}.glb`);
      // Meshy character bodies (avatars/meshy-*.glb): only loaded when meshyPeople is on.
      // With meshyPeople on, meshyHeadMaps picks ONE body set: meshy-<id>.hm.glb (head-mapped) or meshy-<id>.glb (the crowd VAT
      // is baked offline from the latter, so it never needs them at runtime).
      for (const file of await readdir(resolve(output, 'assets/avatars')).catch(() => [] as string[])) {
        if (!/^meshy-.*\.glb$/.test(file)) continue;
        const omitIt = compiledFlags.meshyPeople === false
          // Death clips only play on rigged Meshy walkers, which need cc0People (people.ts loads no bodies without it).
          || (file === 'meshy-idle-clips.glb' ? compiledFlags.pedIdleVariety !== true || compiledFlags.meshyDeathClips !== true || compiledFlags.cc0People === false
          : file === 'meshy-clips.glb' ? compiledFlags.meshyDeathClips !== true || compiledFlags.cc0People === false
            // Without cc0People only the officer body is ever loaded (meshyOfficerTemplate); one set per meshyHeadMaps.
            : (compiledFlags.cc0People === false && !file.startsWith('meshy-sfpd-officer.')) || file.endsWith('.hm.glb') !== (compiledFlags.meshyHeadMaps === true));
        if (omitIt) await omit(`assets/avatars/${file}`);
      }
      // Exact source→runtime pairs from prepare-loading.ts and the onboarding slides.
      const pairs = [
        ['ferry-comic', 'ferry-title'], ['lombard-comic', 'lombard-title'], ['golden-gate-comic', 'golden-gate-title'],
        ['round-closed', 'round-closed'], ['onboarding-controls', 'onboarding-controls'],
        ['onboarding-events', 'onboarding-events'], ['onboarding-raise', 'onboarding-raise'],
      ];
      for (const [source, runtime] of pairs) {
        const input = resolve(output, `art/loading/${source}.png`);
        try { await access(resolve(output, `art/loading/${runtime}.webp`)); removedBytes += (await stat(input)).size; }
        catch { continue; }
        await rm(input);
      }
      this.info(`Omitted ${removedBytes} bytes of authoring inputs and disabled feature packs; source files retained.`);
    },
  };
}
