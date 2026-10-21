import { flags } from '@gtasf/shared/flags';
import './art.css';

/** Decorative loading artwork never delays map readiness or replaces status/errors. */
export function installLoadingArt(element: HTMLElement, locationName: string): () => void {
  // The integrator adds/enables the switch in the same change as the main entry call.
  if (!('loadingArt' in flags) || !flags.loadingArt) return () => {};
  const key = /lombard|russian hill/i.test(locationName) ? 'lombard-title'
    : /golden gate/i.test(locationName) ? 'golden-gate-title' : 'ferry-title';
  const stopFlyover = installTitleFlyover(element, key);
  // index.html may already show this poster from first paint (plain landing URL): keep it rather than re-adding.
  const early = element.querySelector<HTMLImageElement>('.gt-loading-image');
  if (early && element.dataset.art === key) {
    if (early.complete && early.naturalWidth) element.classList.add('gt-loading-art-ready');
    else early.onload = () => element.classList.add('gt-loading-art-ready');
    return () => { stopFlyover(); early.onload = early.onerror = null; early.remove(); element.classList.remove('gt-loading-art', 'gt-loading-art-ready'); delete element.dataset.art; };
  }
  early?.remove();
  const image = new Image();
  image.className = 'gt-loading-image'; image.alt = ''; image.decoding = 'async';
  image.fetchPriority = 'low'; image.draggable = false;
  let disposed = false;
  image.onload = () => { if (!disposed) element.classList.add('gt-loading-art-ready'); };
  image.onerror = () => image.remove();
  element.classList.add('gt-loading-art');
  element.dataset.art = key;
  element.prepend(image);
  image.src = `/art/loading/${key}.webp`;
  return () => {
    stopFlyover(); disposed = true; image.onload = image.onerror = null; image.remove();
    element.classList.remove('gt-loading-art', 'gt-loading-art-ready');
    delete element.dataset.art;
  };
}

/** Reserved for the real funding-round toast; no synthetic achievement is emitted. */
export const ROUND_CLOSED_ART = '/art/loading/round-closed.webp';

/**
 * gtasf-1ky0: an 8 s muted fly-over of our own Ferry Building (tools/capture-cinematic.mjs ferry rail, 640x360 AV1,
 * 181 KB) behind the title card, under flags.titleFlyover. Plain landing URL only, and only if the page is still
 * loading 2.5 s after start, so fast loads never fetch it and it stays out of the first seconds' bytes. The poster stays
 * underneath: if the video can't play (no AV1, autoplay blocked) nothing changes.
 */
function installTitleFlyover(element: HTMLElement, key: string): () => void {
  if (!('titleFlyover' in flags) || !flags.titleFlyover || key !== 'ferry-title' || location.pathname !== '/' || /[?&]at=/.test(location.search)) return () => {};
  let video: HTMLVideoElement | undefined, stopped = false;
  const timer = window.setTimeout(() => {
    if (stopped || element.hidden) return;
    video = document.createElement('video');
    video.className = 'gt-loading-video'; video.muted = true; video.loop = true; video.playsInline = true; video.autoplay = true;
    video.setAttribute('aria-hidden', 'true'); video.preload = 'auto';
    video.addEventListener('playing', () => element.classList.add('gt-loading-video-ready'), { once: true });
    video.addEventListener('error', () => { video?.remove(); video = undefined; }, { once: true });
    element.querySelector('.gt-loading-image')?.after(video) ?? element.prepend(video);
    video.src = '/art/loading/flyover-ferry.webm';
    void video.play().catch(() => {});
  }, Math.max(0, 2500 - performance.now()));
  const stop = () => { stopped = true; clearTimeout(timer); hide.disconnect(); if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); video = undefined; } element.classList.remove('gt-loading-video-ready'); };
  // The loading art itself outlives READY (hidden), so stop decoding the moment the loading screen hides.
  const hide = new MutationObserver(() => { if (element.hidden) stop(); });
  hide.observe(element, { attributes: true, attributeFilter: ['hidden'] });
  return stop;
}

