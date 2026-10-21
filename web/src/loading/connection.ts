const DELAYED_CONNECTION = 'Still connecting to the city… This page will continue when the connection is ready.';

/** The existing network client owns retries; a slow connection must not abandon boot. */
export async function waitForCityConnection(ready: Promise<void>, detail: HTMLElement): Promise<void> {
  let previous: string | null = null;
  let reload: HTMLButtonElement | undefined;
  const retry = () => detail.ownerDocument.defaultView?.location.reload();
  const timer = setTimeout(() => {
    previous = detail.textContent;
    detail.textContent = DELAYED_CONNECTION;
    reload = detail.ownerDocument.createElement('button');
    reload.type = 'button';
    reload.className = 'gt-loading-retry';
    reload.textContent = 'Reload city';
    reload.addEventListener('click', retry);
    detail.after(reload);
  }, 12_000);
  try {
    await ready;
  } finally {
    clearTimeout(timer);
    reload?.removeEventListener('click', retry);
    reload?.remove();
    if (detail.textContent === DELAYED_CONNECTION) detail.textContent = previous;
  }
}
