import { afterEach, expect, test, vi } from 'vitest';
import { flags } from '@gtasf/shared/flags';
import { createFeedback, type FeedbackSnapshot } from './feedback';

vi.mock('@gtasf/shared/flags', () => ({ flags: { feedback: true } }));

// Minimal DOM with queued native close events; no browser or rendering process.
class Node extends EventTarget {
  children: Node[] = [];
  parent?: Node;
  className = '';
  textContent = '';
  value = '';
  src = '';
  type = '';
  open = false;
  hidden = false;
  checked = false;
  disabled = false;
  dataset: Record<string, string> = {};
  constructor(readonly tag: string) { super(); }
  append(...nodes: Node[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  get lastChild() { return this.children.at(-1); }
  setAttribute() {}
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; setTimeout(() => this.dispatchEvent(new Event('close')), 0); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  find(predicate: (node: Node) => boolean): Node | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) { const found = child.find(predicate); if (found) return found; }
    return undefined;
  }
  click() { this.dispatchEvent(new Event('click')); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

function setup(
  capture: () => Promise<string | null> | string | null = () => null,
  state: () => FeedbackSnapshot | null = () => ({ mode: 'foot', worldX: 12 }),
) {
  vi.useFakeTimers();
  const body = new Node('body');
  const images: Array<{ src: string; naturalWidth: number; naturalHeight: number; onload: () => void }> = [];
  const canvases: Array<{ width: number; height: number }> = [];
  vi.stubGlobal('Image', class {
    naturalWidth = 640;
    naturalHeight = 360;
    src = '';
    onload = () => {};
    constructor() { images.push(this); }
  });
  vi.stubGlobal('document', {
    body,
    createElement: (tag: string) => {
      if (tag !== 'canvas') return new Node(tag);
      let src = '';
      const canvas = {
        width: 0, height: 0,
        getContext: () => ({ drawImage: (image: { src: string }) => { src = image.src; } }),
        toDataURL: () => `jpeg:${src}`,
      };
      canvases.push(canvas);
      return canvas;
    },
    createTextNode: (text: string) => Object.assign(new Node('#text'), { textContent: text }),
  });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('location', { pathname: '/', search: '?at=37.7955,-122.3937' });
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  const modal = vi.fn();
  const panel = createFeedback({ capture, onModalChange: modal, state })!;
  const field = (className: string) => body.find(node => node.className === className)!;
  return {
    panel, body, images, canvases, fetchMock, modal,
    text: field('gt-feedback-text'), status: field('gt-feedback-status'), send: field('gt-feedback-send'),
    toggle: body.find(node => node.tag === 'input')!, image: body.find(node => node.tag === 'img')!,
    label: field('gt-feedback-shot-label'),
  };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test('late capture and image decode cannot replace the next opening; queued close preserves its modal', async () => {
  const oldCapture = deferred<string | null>(), currentCapture = deferred<string | null>();
  const capture = vi.fn<() => Promise<string | null> | string | null>()
    .mockReturnValueOnce(oldCapture.promise).mockReturnValueOnce(currentCapture.promise)
    .mockReturnValueOnce('old-decode').mockReturnValueOnce(null);
  const ui = setup(capture);
  const oldOpen = ui.panel.open();
  ui.panel.close();
  expect(ui.modal.mock.calls).toEqual([[true], [false]]);
  const currentOpen = ui.panel.open();
  currentCapture.resolve('current'); await flush();
  ui.images[0]!.onload(); await currentOpen;
  oldCapture.resolve('old'); await oldOpen;
  expect(ui.images).toHaveLength(1);
  expect(ui.image.src).toBe('jpeg:current');
  await vi.advanceTimersByTimeAsync(0);
  expect(ui.panel.isOpen).toBe(true);
  expect(ui.modal.mock.calls).toEqual([[true], [false], [true]]);

  ui.panel.close();
  const decodingOpen = ui.panel.open(); await flush();
  ui.panel.close(); await ui.panel.open();
  ui.images[1]!.onload(); await decodingOpen;
  expect(ui.image.hidden).toBe(true);
  expect(ui.label.lastChild!.textContent).toBe(' Screenshot unavailable');
  expect(ui.toggle.disabled).toBe(true);
  ui.panel.destroy(); await vi.runAllTimersAsync();
  expect(ui.body.children).toHaveLength(0);
  expect(ui.modal.mock.calls).toEqual([[true], [false], [true], [false], [true], [false], [true], [false]]);
});

test('a previous submission or JSON body cannot alter or close a new draft', async () => {
  const ui = setup();
  const pending = deferred<Response>();
  ui.fetchMock.mockReturnValueOnce(pending.promise);
  await ui.panel.open(); ui.text.value = 'old report'; ui.send.click();
  ui.panel.close(); await ui.panel.open(); ui.text.value = 'new draft';
  pending.resolve(Response.json({ screenshotStored: false }));
  await flush(); await vi.advanceTimersByTimeAsync(1200);
  expect(ui.panel.isOpen).toBe(true);
  expect(ui.text.value).toBe('new draft');
  expect(ui.status.textContent).toBe('');
  expect(ui.send.disabled).toBe(false);

  const body = deferred<{ error: string }>();
  const response = Response.json({}, { status: 503 });
  vi.spyOn(response, 'json').mockReturnValue(body.promise);
  ui.fetchMock.mockResolvedValueOnce(response);
  ui.send.click(); await flush();
  ui.panel.close(); await ui.panel.open(); ui.text.value = 'third draft';
  body.resolve({ error: 'old failure' }); await flush();
  expect(ui.status.textContent).toBe('');
  expect(ui.text.value).toBe('third draft');
  expect(ui.send.disabled).toBe(false);
  ui.panel.destroy();
});

test('a sent report timer cannot dismiss a newly opened draft', async () => {
  const ui = setup();
  ui.fetchMock.mockResolvedValue(Response.json({}));
  await ui.panel.open(); ui.text.value = 'first'; ui.send.click(); await flush();
  expect(ui.status.textContent).toBe('Thanks! Feedback sent.');
  ui.panel.close(); await ui.panel.open(); ui.text.value = 'next';
  await vi.advanceTimersByTimeAsync(1200);
  expect(ui.panel.isOpen).toBe(true);
  expect(ui.text.value).toBe('next');
  ui.panel.destroy();
});

test('current feedback validates, retries and sends the chosen attachment before closing', async () => {
  const ui = setup(() => 'frame');
  const opening = ui.panel.open(); await flush(); ui.images[0]!.onload(); await opening;
  ui.send.click();
  expect(ui.fetchMock).not.toHaveBeenCalled();
  ui.text.value = '  The hill is fun  ';
  ui.toggle.checked = false;
  ui.fetchMock.mockResolvedValueOnce(Response.json({ error: 'Try again later' }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ screenshotStored: false }));
  ui.send.click(); await flush();
  expect(ui.status.textContent).toBe('Try again later');
  expect(ui.send.disabled).toBe(false);
  ui.send.click(); ui.send.click(); await flush();
  expect(ui.fetchMock).toHaveBeenCalledTimes(2);
  expect(JSON.parse(ui.fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
    text: 'The hill is fun', screenshot: null, path: '/?at=37.7955,-122.3937', mode: 'foot', worldX: 12,
  });
  expect(ui.status.textContent).toBe('Thanks! Feedback sent.');
  await vi.advanceTimersByTimeAsync(1100);
  expect(ui.panel.isOpen).toBe(false);
  expect(ui.modal.mock.calls).toEqual([[true], [false]]);
  ui.panel.destroy();
});

test('destroy releases the modal once and ignores a pending response and future actions', async () => {
  const ui = setup();
  const pending = deferred<Response>(); ui.fetchMock.mockReturnValueOnce(pending.promise);
  await ui.panel.open(); ui.text.value = 'pending'; ui.send.click();
  ui.panel.destroy(); ui.panel.destroy();
  expect(ui.modal.mock.calls).toEqual([[true], [false]]);
  pending.resolve(Response.json({})); await flush(); await vi.runAllTimersAsync();
  await ui.panel.open(); ui.send.click();
  expect(ui.fetchMock).toHaveBeenCalledOnce();
  expect(ui.status.textContent).toBe('Sending…');
  expect(ui.body.children).toHaveLength(0);
});

test('feedback remains behind its existing flag', () => {
  const mutable = flags as { feedback: boolean };
  mutable.feedback = false;
  try { expect(createFeedback({})).toBeNull(); } finally { mutable.feedback = true; }
});

test('feedback retains the captured location through travel and retry, then refreshes on reopen', async () => {
  const player = { mode: 'robotaxi', worldX: 12, locationName: 'Ferry Building' };
  const state = vi.fn(() => player);
  const capture = deferred<string | null>();
  const captureFrame = vi.fn<() => Promise<string | null> | string | null>()
    .mockReturnValueOnce(capture.promise).mockReturnValueOnce('lombard');
  const ui = setup(captureFrame, state);
  const opening = ui.panel.open();
  player.worldX = 1800; player.locationName = 'Lombard Street';
  location.search = '?at=37.8021,-122.4188';
  capture.resolve('ferry'); await flush(); ui.images[0]!.onload(); await opening;
  ui.text.value = 'The pickup curb here is wrong';
  ui.fetchMock.mockResolvedValueOnce(Response.json({ error: 'Try again' }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({}));
  ui.send.click(); await flush();
  ui.send.click(); await flush();
  const submitted = () => ui.fetchMock.mock.calls.map(call => JSON.parse(call[1]!.body as string));
  expect(submitted()).toEqual([0, 1].map(() => ({
    text: 'The pickup curb here is wrong', screenshot: 'jpeg:ferry',
    path: '/?at=37.7955,-122.3937', mode: 'robotaxi', worldX: 12, locationName: 'Ferry Building',
  })));
  expect(state).toHaveBeenCalledTimes(1);

  ui.panel.close();
  const reopened = ui.panel.open(); await flush(); ui.images[1]!.onload(); await reopened;
  ui.text.value = 'A new report'; ui.send.click(); await flush();
  expect(submitted()[2]).toMatchObject({
    path: '/?at=37.8021,-122.4188', screenshot: 'jpeg:lombard', worldX: 1800, locationName: 'Lombard Street',
  });
  expect(state).toHaveBeenCalledTimes(2);
  ui.panel.destroy();
});

test.each([
  [1080, 2400, 432, 960],
  [3840, 2160, 960, 540],
  [2400, 2400, 960, 960],
  [640, 360, 640, 360],
])('feedback fits a %ix%i capture within the image budget without upscaling', async (width, height, expectedWidth, expectedHeight) => {
  const ui = setup(() => 'frame');
  const opening = ui.panel.open(); await flush();
  const image = ui.images[0]!;
  image.naturalWidth = width; image.naturalHeight = height; image.onload();
  await opening;
  expect(ui.canvases).toEqual([expect.objectContaining({ width: expectedWidth, height: expectedHeight })]);
  expect(ui.canvases[0]!.width * ui.canvases[0]!.height).toBeLessThanOrEqual(1_000_000);
  expect(ui.image.hidden).toBe(false);
  ui.panel.destroy();
});

test('capture and state failures still allow text feedback from the opening path', async () => {
  const ui = setup(() => { throw new Error('capture unavailable'); }, () => { throw new Error('state unavailable'); });
  await ui.panel.open();
  location.search = '?at=37.8021,-122.4188';
  ui.text.value = 'Text still works';
  ui.fetchMock.mockResolvedValueOnce(Response.json({}));
  ui.send.click(); await flush();
  expect(JSON.parse(ui.fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
    text: 'Text still works', screenshot: null, path: '/?at=37.7955,-122.3937',
  });
  expect(ui.status.textContent).toBe('Thanks! Feedback sent.');
  ui.panel.destroy();
});
