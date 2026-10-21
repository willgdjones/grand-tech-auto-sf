/**
 * Renders the tiny inline-markdown subset our changelog bullets use — `**bold**` and
 * `[label](url)` links — as DOM nodes, never `innerHTML`, so an authored bullet can never
 * inject markup (M6: the /changelog page and the What's new panel previously showed
 * `**H**` and `[text](url)` verbatim because they used `textContent`).
 *
 * `parseInline` is pure (no DOM), so the tokeniser is unit-tested in the node test env;
 * `renderInline` is the thin DOM applier used by page.ts and whatsNew.ts.
 */

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; href: string; external: boolean };

// Non-greedy so adjacent spans don't merge; links take a non-space, non-")" href.
const INLINE = /\*\*([^*]+?)\*\*|\[([^\]]+?)\]\(([^)\s]+)\)/g;

/**
 * Hrefs we turn into a real `<a>`: absolute http(s), or a root-relative path (`/changelog`),
 * never a protocol-relative `//host`. Anything else (javascript:, data:, bare words) is
 * rendered as its visible label only, so a bullet can't smuggle a dangerous scheme.
 */
function safeHref(href: string): boolean {
  return /^https?:\/\//i.test(href) || (href.startsWith('/') && !href.startsWith('//'));
}

/** Pure: split a bullet into text / bold / link spans. Unmatched `**` or `[]()` stay literal text. */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(text); m; m = INLINE.exec(text)) {
    if (m.index > last) tokens.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) {
      tokens.push({ kind: 'bold', text: m[1] });
    } else {
      const label = m[2]!;
      const href = m[3]!;
      if (safeHref(href)) tokens.push({ kind: 'link', text: label, href, external: /^https?:/i.test(href) });
      else tokens.push({ kind: 'text', text: label });
    }
    last = INLINE.lastIndex;
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) });
  return tokens;
}

/** Append `text` to `parent` with its inline markdown rendered as DOM nodes (no innerHTML). */
export function renderInline(parent: HTMLElement, text: string): void {
  for (const token of parseInline(text)) {
    if (token.kind === 'text') {
      parent.appendChild(document.createTextNode(token.text));
    } else if (token.kind === 'bold') {
      const strong = document.createElement('strong');
      strong.textContent = token.text;
      parent.appendChild(strong);
    } else {
      const a = document.createElement('a');
      a.textContent = token.text;
      a.href = token.href;
      if (token.external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      parent.appendChild(a);
    }
  }
}
