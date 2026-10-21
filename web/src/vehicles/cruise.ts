import { flags } from '@gtasf/shared/flags';
import { nearestCableStops, type CableStopChoice } from '@gtasf/shared/transit/cableCars';
import { nearestMuniStops } from '@gtasf/shared/transit/muni';

const storageKey = 'gtasf-cruise-mode';
export function savedCruiseMode(): boolean { try { return localStorage.getItem(storageKey) === '1'; } catch { return false; } }
/** Mount in the shared Game options modal. It adds no floating HUD button or independent modal. */
export function createTrafficControls(options: {
  parent: HTMLElement; setCruise(enabled: boolean): void; getPosition(): { x: number; z: number };
  serverNow(): number; onDestination(stop: CableStopChoice): void;
}) {
  const element = document.createElement('section'); element.className = 'gtasf-traffic-options';
  const heading = document.createElement('h3'); heading.textContent = 'Getting around'; element.append(heading);
  if (flags.traffic) {
    const label = document.createElement('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    checkbox.checked = savedCruiseMode(); checkbox.setAttribute('aria-label', 'Cruise mode');
    label.append(checkbox, ' Cruise mode — hide NPC cars'); element.append(label); options.setCruise(checkbox.checked);
    checkbox.addEventListener('change', () => { options.setCruise(checkbox.checked); try { localStorage.setItem(storageKey, checkbox.checked ? '1' : '0'); } catch { /* This session still works. */ } });
  }
  const stops = document.createElement('div'); stops.className = 'gtasf-cable-stops';
  if (flags.cableCars) {
    const hint = document.createElement('p'); hint.textContent = 'Cable cars stop along three real routes. Follow GPS to a stop; press E or tap Enter while the car is stopped. Exit anywhere with E.';
    element.append(hint);
  }
  if (flags.muni) {
    const hint = document.createElement('p'); hint.textContent = 'Muni 39 links Coit Tower and Fisherman’s Wharf on an accelerated game timetable. Follow GPS to a stop; press E or tap Enter while the bus is stopped.';
    element.append(hint);
  }
  if (flags.cableCars || flags.muni) element.append(stops);
  options.parent.append(element);
  const rows = new Map<string, { choice: CableStopChoice; detail: HTMLParagraphElement }>();
  function refresh(): void {
    if (!flags.cableCars && !flags.muni) return;
    const position = options.getPosition(), now = options.serverNow();
    const choices = [...(flags.cableCars ? nearestCableStops(position, now) : []), ...(flags.muni ? nearestMuniStops(position, now) : [])];
    for (const stop of choices) {
      let state = rows.get(stop.title);
      if (!state) {
        const row = document.createElement('div'), button = document.createElement('button'), detail = document.createElement('p');
        button.type = 'button'; button.textContent = `${stop.title} · GPS to stop`;
        const entry = { choice: stop, detail };
        button.addEventListener('click', () => options.onDestination(entry.choice));
        row.append(button, detail); stops.append(row); rows.set(stop.title, entry); state = entry;
      }
      state.choice = stop;
      const vehicle = stop.id.startsWith('muni-') ? 'bus' : 'car';
      state.detail.textContent = `${stop.stop} · ${Math.round(stop.distanceM)} m · ${stop.waitSeconds ? `next ${vehicle} ${Math.ceil(stop.waitSeconds / 60)} min` : 'boarding now'}`;
    }
  }
  refresh();
  const timer = flags.cableCars || flags.muni ? window.setInterval(() => {
    if (element.closest('dialog')?.open && document.visibilityState !== 'hidden') refresh();
  }, 1000) : undefined;
  return { element, refresh, destroy() { if (timer !== undefined) window.clearInterval(timer); element.remove(); rows.clear(); } };
}
