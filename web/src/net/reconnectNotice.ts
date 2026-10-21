// gtasf-j7wvv (orchestrator 2026-10-16, flag reconnectNotice): say so when the world socket is down for more than 1 s.
// Cloudflare replaces the WorldDO instance every ~8-40 min, so every player sees a ~1-3 s reconnect; the small status
// text in the menu was the only sign, and a frozen world with no explanation reads as the game hanging. A sub-second
// blip (the usual fast retry) shows nothing. Client-only.

const SHOW_AFTER_MS = 1000, RECONNECTED_MS = 1400;
const CSS = `.gt-reconnecting{position:fixed;z-index:60;top:calc(14px + var(--gt-outbid-bar-height, 0px) + env(safe-area-inset-top));left:50%;transform:translateX(-50%);
padding:7px 14px;border:2px solid #000;background:#151515e6;color:#f6a81e;font:800 13px/1.2 Arial,sans-serif;letter-spacing:.04em;
text-transform:uppercase;pointer-events:none}.gt-reconnecting[hidden]{display:none!important}.gt-reconnecting.ok{color:#9fe08a}`;

export interface ReconnectNotice { set(connected: boolean): void; dispose(): void }

export function createReconnectNotice(parent: HTMLElement = document.body): ReconnectNotice {
  const style = document.createElement('style'); style.textContent = CSS;
  const el = document.createElement('div'); el.className = 'gt-reconnecting'; el.hidden = true; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  parent.append(style, el);
  let wasConnected = false, shown = false, timer: ReturnType<typeof setTimeout> | undefined, hideTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    set(connected) {
      if (connected) {
        clearTimeout(timer); timer = undefined;
        if (shown) { // say it's back, briefly
          shown = false; el.classList.add('ok'); el.textContent = 'Reconnected'; el.hidden = false;
          clearTimeout(hideTimer); hideTimer = setTimeout(() => { el.hidden = true; el.classList.remove('ok'); }, RECONNECTED_MS);
        }
        wasConnected = true; return;
      }
      if (!wasConnected || timer !== undefined || shown) return; // the first join has its own loading UI
      timer = setTimeout(() => {
        timer = undefined; shown = true; clearTimeout(hideTimer);
        el.classList.remove('ok'); el.textContent = 'Reconnecting…'; el.hidden = false;
      }, SHOW_AFTER_MS);
    },
    dispose() { clearTimeout(timer); clearTimeout(hideTimer); el.remove(); style.remove(); },
  };
}
