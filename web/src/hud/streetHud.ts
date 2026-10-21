import { flags } from '@gtasf/shared/flags';
import './streetHud.css';

export interface StreetLocation { street: string | null; neighbourhood: string | null }
/** Caller samples the sourced map lookup at ~4 Hz, not once per rendered frame. */
export function createStreetHud(parent: HTMLElement = document.body) {
  if (!flags.hud) return null;
  const root = document.createElement('section');
  root.className = 'gt-street-hud'; root.hidden = true;
  root.setAttribute('aria-label', 'Current location'); root.setAttribute('aria-live', 'polite');
  const district = document.createElement('div'), street = document.createElement('div');
  district.className = 'gt-street-district'; street.className = 'gt-street-name';
  root.append(district, street); parent.append(root);
  let current = '', candidate = '', candidateSince = 0, first = true;
  // SA minimalism (founder): the area/street name is big on ENTERING a new area, then fades out so the
  // default screen stays clean. It only reappears when you cross into a different area.
  const VISIBLE_MS = 3000;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let fade: Animation | undefined;
  const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    element: root,
    update(location: StreetLocation | null, now = performance.now()) {
      const name = location?.street?.trim() ?? '', neighbourhood = location?.neighbourhood?.trim() ?? '';
      const key = name || neighbourhood ? `${name}\n${neighbourhood}` : '';
      if (key === current && !first) { candidate = key; return; }
      if (key !== candidate) { candidate = key; candidateSince = now; }
      if (!first && now - candidateSince < (key ? 600 : 1200)) return;
      first = false; current = key;
      clearTimeout(hideTimer); hideTimer = undefined; fade?.cancel(); fade = undefined;
      root.hidden = !key;
      street.textContent = name; street.hidden = !name; district.textContent = neighbourhood; district.hidden = !neighbourhood;
      if (!key) return;
      const motion = !reducedMotion() && typeof root.animate === 'function';
      if (motion) root.animate([{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 320, easing: 'ease-out' });
      hideTimer = setTimeout(() => {
        hideTimer = undefined;
        if (!motion) { root.hidden = true; return; }
        fade = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: 'ease-in', fill: 'forwards' });
        fade.onfinish = () => { root.hidden = true; fade = undefined; };
      }, VISIBLE_MS);
    },
    destroy() { clearTimeout(hideTimer); fade?.cancel(); root.remove(); },
  };
}
