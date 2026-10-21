export interface RobotsRule { allow: boolean; path: string }
export interface RobotsPolicy { rules: RobotsRule[]; crawlDelayMs: number }
interface Group extends RobotsPolicy { agents: string[] }

/** Longest matching product token wins; matching groups are merged; wildcard is fallback. */
export function parseRobots(text: string, userAgent = 'GTASFEvents'): RobotsPolicy {
  const groups: Group[] = [];
  let group: Group = { agents: [], rules: [], crawlDelayMs: 0 };
  let hasDirectives = false;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (hasDirectives) { groups.push(group); group = { agents: [], rules: [], crawlDelayMs: 0 }; hasDirectives = false; }
      if (value) group.agents.push(value.toLowerCase());
    } else if (group.agents.length) {
      hasDirectives = true;
      if ((key === 'allow' || key === 'disallow') && value.startsWith('/')) group.rules.push({ allow: key === 'allow', path: value });
      if (key === 'crawl-delay' && /^\d+(?:\.\d+)?$/.test(value)) group.crawlDelayMs = Math.max(group.crawlDelayMs, Number(value) * 1000);
    }
  }
  groups.push(group);
  const agent = userAgent.toLowerCase();
  const score = (g: Group): number => Math.max(-1, ...g.agents.map(a => a === '*' ? 0 : agent.includes(a) ? a.length : -1));
  const best = Math.max(-1, ...groups.map(score));
  const selected = best < 0 ? [] : groups.filter(g => score(g) === best);
  return { rules: selected.flatMap(g => g.rules), crawlDelayMs: Math.max(0, ...selected.map(g => g.crawlDelayMs)) };
}

function normalizedPath(value: string): string {
  // REP compares encoded reserved characters but decodes unreserved ASCII.
  return value.replace(/%[\da-f]{2}/gi, p => {
    const char = String.fromCharCode(parseInt(p.slice(1), 16));
    return /[\w.~-]/.test(char) ? char : p.toUpperCase();
  }).replace(/[^\x00-\x7F]/gu, c => encodeURIComponent(c));
}

export function robotsAllows(policy: RobotsPolicy, url: string): boolean {
  const u = new URL(url);
  const path = normalizedPath(u.pathname + u.search);
  let best = -1;
  let allowed = true;
  for (const rule of policy.rules) {
    const normalized = normalizedPath(rule.path);
    const anchored = normalized.endsWith('$');
    const body = anchored ? normalized.slice(0, -1) : normalized;
    const escaped = body.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    if (!new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(path)) continue;
    const specificity = new TextEncoder().encode(body.replace(/\*/g, '')).length;
    if (specificity > best || (specificity === best && rule.allow)) { best = specificity; allowed = rule.allow; }
  }
  return allowed;
}
