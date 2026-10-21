import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/** index.html paints before any module runs, so it can't import shared/flags. This stamps the build's flag values into
 *  `%FLAG_NAME%` placeholders at build time, read from the SAME flags module the bundle uses (shared/flags.ts in dev,
 *  the reviewed GTASF_FLAGS_FILE in deployment builds). Only flags listed here; a missing flag reads as off. */
const HTML_FLAGS = ['loadingHook', 'deepLinkPoster'] as const;

export function flagIsOn(source: string, flag: string): boolean {
  return new RegExp(`\\b${flag}["']?\\s*:\\s*true\\b`).test(source);
}

export function htmlFlags(flagsFile: string): Plugin {
  return {
    name: 'gtasf-html-flags',
    transformIndexHtml(html) {
      const source = readFileSync(flagsFile, 'utf8');
      let out = html;
      for (const flag of HTML_FLAGS) out = out.replaceAll(`%FLAG_${flag.toUpperCase()}%`, flagIsOn(source, flag) ? 'on' : 'off');
      return out;
    },
  };
}
