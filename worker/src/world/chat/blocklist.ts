import { matchForms } from '@gtasf/shared/chat/normalize';
import type { MatchForms } from '@gtasf/shared/chat/normalize';
import { BLOCKLIST_SOURCE } from './blocklist.generated';

export type BlocklistBoundary = 'word' | 'prefix';
export interface BlocklistRule {
  readonly stem: string;
  readonly boundary: BlocklistBoundary;
}
export type BlocklistHit = { hit: false } | { hit: true; rule: BlocklistRule; variant: 'tokens' | 'letters' };

const letter = /\p{L}/u;
const space = /\s/u;

/** Parses `blocklist.txt`. Every stem must already be in match form, or the file refuses to load. */
export function parseBlocklist(source: string): BlocklistRule[] {
  const rules: BlocklistRule[] = [];
  const seen = new Set<string>();
  source.split('\n').forEach((line, index) => {
    if (!line.trim() || line.startsWith('#')) return;
    const parts = line.split('\t');
    const [stem, boundary] = parts;
    if (parts.length !== 2 || !stem || (boundary !== 'word' && boundary !== 'prefix'))
      throw new Error(`blocklist line ${index + 1}: expected "<stem>\\t<word|prefix>"`);
    const forms = matchForms(stem);
    if (forms.leetSquashed !== stem || forms.lettersOnly !== stem)
      throw new Error(`blocklist line ${index + 1}: stem is not in letters-only match form`);
    if (seen.has(stem)) throw new Error(`blocklist line ${index + 1}: duplicate stem`);
    seen.add(stem);
    rules.push({ stem, boundary });
  });
  return rules;
}

function letterRuns(chars: readonly string[], into: string[]): void {
  let run = '';
  for (const ch of chars) {
    if (letter.test(ch)) run += ch;
    else if (run) {
      into.push(run);
      run = '';
    }
  }
  if (run) into.push(run);
}
function lettersOnlyTokens(chars: readonly string[], into: string[]): void {
  let singles = '';
  let word = '';
  const flushWord = () => {
    if (word.length === 1) singles += word;
    else {
      if (singles.length > 1) into.push(singles);
      singles = '';
      if (word) into.push(word);
    }
    word = '';
  };
  for (const ch of chars) {
    if (space.test(ch)) flushWord();
    else if (letter.test(ch)) word += ch;
  }
  flushWord();
  if (singles.length > 1) into.push(singles);
}

/**
 * Tokens of both match-form variants, each taken from the pre-leetspeak form and the leet/squashed
 * form (so "kike!" is caught although `!` maps to `i`). Variant 1: maximal letter runs. Variant 2
 * (letters only): each whitespace token with its non-letters removed, plus every run of single-letter
 * tokens joined ("n.i.x", "n i x"). Numeric words also keep the base punctuation boundaries while
 * folding leet, so "p1key!" does not become only "pikeyi" or the separate runs "p"/"key".
 * These additional word tokens do not change the letters-only joining rules. All passes are linear.
 */
export function blocklistTokens(forms: Pick<MatchForms, 'base' | 'leetSquashed'>): {
  tokens: string[];
  letters: string[];
} {
  const base = Array.from(forms.base),
    leet = Array.from(forms.leetSquashed);
  const tokens: string[] = [],
    letters: string[] = [];
  letterRuns(leet, tokens);
  letterRuns(base, tokens);
  if (/\p{N}/u.test(forms.base)) {
    const numericWords = forms.base.replace(/[^\p{L}\p{N}]+/gu, ' ');
    letterRuns(Array.from(matchForms(numericWords).leetSquashed), tokens);
  }
  lettersOnlyTokens(leet, letters);
  lettersOnlyTokens(base, letters);
  return { tokens: [...new Set(tokens)], letters: [...new Set(letters)] };
}

/** A precompiled matcher: a word set plus a trie of prefix stems, so matching never backtracks. */
export function compileBlocklist(rules: readonly BlocklistRule[]) {
  const words = new Map<string, BlocklistRule>();
  interface Node {
    rule?: BlocklistRule;
    next: Map<string, Node>;
  }
  const root: Node = { next: new Map() };
  for (const rule of rules) {
    if (rule.boundary === 'word') {
      words.set(rule.stem, rule);
      continue;
    }
    let node = root;
    for (const ch of rule.stem) {
      let child = node.next.get(ch);
      if (!child) node.next.set(ch, (child = { next: new Map() }));
      node = child;
    }
    node.rule = rule;
  }
  const matchToken = (token: string): BlocklistRule | undefined => {
    const exact = words.get(token);
    if (exact) return exact;
    let node: Node | undefined = root;
    for (const ch of token) {
      node = node.next.get(ch);
      if (!node) return undefined;
      if (node.rule) return node.rule;
    }
    return undefined;
  };
  return (forms: Pick<MatchForms, 'base' | 'leetSquashed'>): BlocklistHit => {
    const { tokens, letters } = blocklistTokens(forms);
    for (const token of tokens) {
      const rule = matchToken(token);
      if (rule) return { hit: true, rule, variant: 'tokens' };
    }
    for (const token of letters) {
      const rule = matchToken(token);
      if (rule) return { hit: true, rule, variant: 'letters' };
    }
    return { hit: false };
  };
}

export const BLOCKLIST_RULES = parseBlocklist(BLOCKLIST_SOURCE);
/** Loaded once per isolate (cold start). */
export const matchBlocklist = compileBlocklist(BLOCKLIST_RULES);
export const blocklistMatch = (display: string) => matchBlocklist(matchForms(display));
