/** Position transient awards in free HUD space. gtasf-xpifc: the phone STATION chip (.gt-radio-next) and the combat
 * vitals/wanted block (.gt-combat-hud) are obstacles too; notices drew over both on phones. QA #6.20: the founder
 * valuation pill / quest card / time-trial HUD too ("Hospital bill" covered the valuation pill). Runs only when the HUD,
 * viewport or toast changes, never from the simulation/render loop. */
const HUD = '.gt-outbid-banner,.gt-drop-banner,#app>header,#app>aside,#play-controls,.gt-hud,.gt-upcoming-open,.gt-chat-ambient,.gt-street-hud,.gt-radar,.gtasf-touch.on .stick,.gtasf-touch.on .buttons,.gtasf-touch.on .ride-hint,.gt-gps-status,.gt-funding-room,#app>footer,.gt-sa-hint,.gt-sa-mission,dialog,.gt-radio-next,.gt-combat-hud,.gt-founder-valuation,.gt-founder-quest,.gt-tt-hud';
type Rect = { left: number; right: number; top: number; bottom: number };
const GAP = 8;

export function layoutToasts(element: HTMLElement) {
  let dead = false, pending = 0;
  const observed = new Set<Element>();
  const resize = new ResizeObserver(schedule);
  // HUD writers may assign the same hidden/class/style value each game tick.
  // Only an actual change needs another obstacle search and layout measurement.
  function changed(entries: MutationRecord[]) {
    if (entries.some(entry => entry.oldValue !== (entry.target as Element).getAttribute(entry.attributeName!))) schedule();
  }
  // Existing layout modules publish measured notice heights on body.style.
  const bodyChanges = new MutationObserver(changed);
  bodyChanges.observe(document.body, { attributes: true, attributeOldValue: true, attributeFilter: ['style', 'class'] });
  const hudChanges = new MutationObserver(changed);
  function schedule() {
    if (!dead && !pending && element.childElementCount) pending = requestAnimationFrame(place);
  }
  function place() {
    pending = 0;
    if (dead || !element.childElementCount) return;
    const width = innerWidth, height = innerHeight;
    const obstacles: Rect[] = [];
    for (const node of document.querySelectorAll<HTMLElement>(HUD)) {
      if (!observed.has(node)) {
        observed.add(node); resize.observe(node);
        hudChanges.observe(node, { attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'class', 'style', 'open'] });
      }
      if (!node.checkVisibility({ visibilityProperty: true })) continue;
      const r = node.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) obstacles.push(r);
    }
    const preferredY = Math.max(110, ...obstacles.filter(r => r.top < 100).map(r => r.bottom + GAP));
    const widths = [...new Set([Math.min(520, width - 24), Math.min(360, width - 24), Math.min(240, width - 24), 156, 112])];
    for (const compact of width <= 700 || height < 500 ? [true] : [false, true]) {
      element.dataset.compact = String(compact);
      for (const w of widths) {
        if (w > width - GAP * 2 || (!compact && w < 220)) continue;
        element.style.width = `${w}px`;
        const h = Math.ceil(element.getBoundingClientRect().height);
        const xs = [...new Set([(width - w) / 2, GAP, width - w - GAP, ...obstacles.flatMap(r => [r.right + GAP, r.left - w - GAP])])];
        const ys = [...new Set([preferredY, GAP, height - h - GAP, ...obstacles.flatMap(r => [r.bottom + GAP, r.top - h - GAP])])];
        let best: { x: number; y: number; score: number } | undefined;
        for (const x of xs) for (const y of ys) {
          if (x < GAP || y < GAP || x + w > width - GAP || y + h > height - GAP) continue;
          if (obstacles.some(r => x < r.right + GAP && x + w > r.left - GAP && y < r.bottom + GAP && y + h > r.top - GAP)) continue;
          const score = Math.abs(y - preferredY) + Math.abs(x + w / 2 - width / 2) * .3;
          if (!best || score < best.score) best = { x, y, score };
        }
        if (best) {
          element.style.left = `${best.x}px`; element.style.top = `${best.y}px`;
          element.dataset.placed = 'true'; return;
        }
      }
    }
    // A fully occupied HUD (e.g. expanded map/dialog) keeps the accessible live
    // announcement without painting over controls. The next layout retries.
    element.dataset.placed = 'false';
  }
  window.addEventListener('resize', schedule);
  return {
    update: schedule,
    dispose() {
      dead = true; cancelAnimationFrame(pending); resize.disconnect(); bodyChanges.disconnect(); hudChanges.disconnect();
      observed.clear(); window.removeEventListener('resize', schedule);
    },
  };
}
